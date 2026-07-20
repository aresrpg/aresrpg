// Far-section worker entry (NG-LOD phase B) — runs the PURE, expensive far-LOD build off the main
// thread so the render thread never stalls on it. A section build downsamples up to 256 chunk-column
// profiles through the real generator (phase-A report: cold L4 ≈ 550 ms/section) — far too heavy for a
// main-thread idle slice, so it lives here. Speaks the frozen rpc.js envelope: receives
// MSG_FAR_SECTION_REQUEST {level,sx,sz,seed}, runs build_section → build_far_mesh, and posts back
// MSG_FAR_SECTION_RESULT carrying a TIGHT copy of the FarMesh (its interleaved `data` buffer is handed
// to the transfer list — zero-copy move; the section is thrown away after posting).
//
// Each worker owns ONE gen context + ONE reused column sampler (built on first request for the job's
// seed), so the generator's region/lake memos stay warm across the many sections one worker builds.
// The sampler taps SPARSE per-column fills (section_builder.js) — no per-chunk profile cache exists.

import {
  MSG_ERROR,
  MSG_FAR_SECTION_REQUEST,
  MSG_FAR_SECTION_RESULT,
  MSG_GEN_CONFIG,
  decode_message,
} from '../workers/rpc.js'
import { create_gen_context } from '../gen/column_gen.js'
import { derive_section_trees, IMPOSTOR_MAX_LEVEL } from '../render/far_trees_gen.js'

import { build_far_mesh } from './far_mesher.js'
import { build_section, create_world_column_sampler, section_span_meters } from './section_builder.js'

/** @typedef {import('../gen/column_gen.js').GenContext} GenContext */

// tsconfig omits "webworker" from lib (shared config), so ambient `self` resolves to the DOM Window
// overloads that reject the (message, transferList) worker signature. Narrow locally (same pattern as
// gen_worker.js / mesh_worker.js).
const worker_self =
  /** @type {{ postMessage: (message: unknown, transfer?: Transferable[]) => void, addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void }} */ (
    /** @type {unknown} */ (self)
  )

/** The world config delivered by the pool's one-shot init (MSG_GEN_CONFIG) — the SAME full recipe the
 *  near gen pool receives, so the far shell's surface/strata/biomes match the near ring (not the DEFAULT
 *  recipe). Null until the init arrives; then the sampler is built from it, and the per-request `seed` is
 *  only a fallback for the bare (no-init) path + tests. @type {import('../config/world_gen_config.js').WorldGenConfig | undefined} */
let world_config
/** Cache key of the built sampler/context: the world_config object (when set) else the seed string. */
let cached_key = /** @type {object | string | undefined} */ (undefined)
/** @type {((world_x:number, world_z:number) => import('./section_builder.js').ColumnSample) | null} */
let cached_sampler = null
/** @type {import('../gen/column_gen.js').GenContext | null} */
let cached_ctx = null

/**
 * The gen context for the current world, built once per worker (its region/lake memos — via the sampler
 * — stay warm across builds). Prefers the init world_config (full recipe — SSOT with the near ring);
 * falls back to a bare seed string when no config was delivered (create_gen_context resolves DEFAULT + seed).
 * @param {string | undefined} seed @returns {import('../gen/column_gen.js').GenContext}
 */
function context_for(seed) {
  const key = world_config ?? seed
  if (!cached_ctx || cached_key !== key) {
    cached_key = key
    cached_ctx = create_gen_context(world_config ?? seed)
    cached_sampler = create_world_column_sampler(cached_ctx)
  }
  return cached_ctx
}

/** The column sampler for the current world (shares the context's gen memos). @param {string | undefined} seed
 *  @returns {(world_x:number, world_z:number) => import('./section_builder.js').ColumnSample} */
function sampler_for(seed) {
  context_for(seed)
  return /** @type {(world_x:number, world_z:number) => import('./section_builder.js').ColumnSample} */ (cached_sampler)
}

/** Backing ArrayBuffers of one FarLayer's typed arrays (for the transfer list).
 *  @param {import('./far_mesher.js').FarLayer} layer @returns {Transferable[]} */
function layer_buffers(layer) {
  return /** @type {Transferable[]} */ ([
    layer.corner_h.buffer,
    layer.corner_c.buffer,
    layer.corner_n.buffer,
    layer.corner_mask.buffer,
  ])
}

/** @param {MessageEvent} event */
function handle_message(event) {
  let envelope
  try {
    envelope = decode_message(event.data)
  } catch {
    return // malformed — nothing to correlate a response to (rpc.js "never throw across the boundary")
  }
  // Pool init (SSOT): adopt the full world recipe so the far shell's surface/strata/biomes match the near
  // ring — same message the near gen pool receives. Drop the cached sampler so the next build rebuilds it.
  if (envelope.type === MSG_GEN_CONFIG) {
    world_config = /** @type {import('../config/world_gen_config.js').WorldGenConfig} */ (envelope.payload)
    cached_sampler = null
    cached_key = undefined
    return
  }
  if (envelope.type !== MSG_FAR_SECTION_REQUEST) return

  try {
    const { level, sx, sz, seed, voxel_max, terrace_max, terrace_layer_m, impostors } =
      /** @type {{ level: number, sx: number, sz: number, seed?: string, voxel_max?: number, terrace_max?: number, terrace_layer_m?: number, impostors?: boolean }} */ (
        envelope.payload
      )
    const sampler = sampler_for(seed)
    // voxel_max = the engine's ?farvoxel boot override (undefined ⇒ build_far_mesh's safe default cap).
    const section = build_section(sampler, level, sx, sz)
    const mesh = build_far_mesh(section, voxel_max, terrace_max, terrace_layer_m)
    // Hand every backing buffer to the transfer list for a zero-copy move (the mesh is thrown away after
    // posting). A blocky VoxelMesh (L1/L2) carries FINAL geometry arrays; the smooth FarMesh (L3/L4)
    // carries corner-grid typed arrays (ground + optional sky).
    const transfer =
      mesh.kind === 'voxel'
        ? /** @type {Transferable[]} */ ([
            mesh.positions.buffer,
            mesh.normals.buffer,
            mesh.colors.buffer,
            mesh.indices.buffer,
          ])
        : mesh.sky
          ? [...layer_buffers(mesh.ground), ...layer_buffers(mesh.sky)]
          : layer_buffers(mesh.ground)

    // [B3 FAR-TREE IMPOSTORS] When ?impostors=1, re-derive this section's procedural-tree instances via
    // the decorator's own placement fn (far_trees_gen — the §3.6 seam) and ship them alongside the mesh
    // for far_trees.js to billboard. Level-capped inside derive_section_trees; OFF ⇒ never runs ⇒ the far
    // shell payload is byte-identical. The tight Float32 buffer is transferred zero-copy.
    if (impostors && level <= IMPOSTOR_MAX_LEVEL) {
      const trees = derive_section_trees(context_for(seed), {
        level,
        origin_x: section.origin_x,
        origin_z: section.origin_z,
        span: section_span_meters(level),
      })
      if (trees.count > 0) {
        ;/** @type {*} */ (mesh).trees = trees
        transfer.push(trees.data.buffer)
      }
    }
    worker_self.postMessage(
      { type: MSG_FAR_SECTION_RESULT, job_id: envelope.job_id, mode: 'transfer', payload: mesh },
      transfer
    )
  } catch (error) {
    worker_self.postMessage({
      type: MSG_ERROR,
      job_id: envelope.job_id,
      mode: 'transfer',
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

worker_self.addEventListener('message', handle_message)
