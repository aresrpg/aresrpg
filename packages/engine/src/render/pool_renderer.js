// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-MEGA terrain renderer (plan §11 PERF NORTH STAR) — THE GPU-driven terrain renderer. The legacy
// sector-bundled path (per-chunk InstancedMesh/material + BundleGroups + compileAsync-on-upload) was
// measured against this at the exit gate (2026-07-03, headed Metal 5K) and deleted: this path is ≥ the
// baseline on every metric (rotation-while-streaming p99 66.7→9.3 ms, zero freezes, zero WebGPU errors,
// zero pipeline compiles after boot vs ~880). Interface (upload_chunk / remove_chunk / update /
// get_stats / upload_epoch / shadow_epoch / set_shadow_box / dispose = the RENDER↔CORE seam):
//
//   • ONE mega quad pool per material class (quad_pool.js) — a chunk upload writes its quads into a
//     free slot and stamps that slot's indirect draw args; removal frees the slot. No InstancedMesh,
//     material, or pipeline is created per chunk (kills #29066 first-reveal compiles), and NO
//     BundleGroup is used at all (survey F1: three's static BundleGroup drops async-compiled objects).
//   • ONE material + ONE Mesh per class, built once at boot and added straight to the scene. The mesh
//     draws the whole class via per-slot drawIndirect (firstInstance addressing) — geometry.setIndirect.
//   • The per-frame cull is a GPU compute pass (gpu_cull.js) that writes each slot's instanceCount from
//     the camera frustum. Camera motion (pan/fly) = GPU-side arg writes: zero CPU re-records, zero
//     pipeline churn, zero per-frame material hashing (so the F8 shadow hash-storm cannot occur here).
//
// SLOT SIZING (node size_probe 2026-07-03: solid max ≈2200, foliage ≈290, liquid ≈30 quads/chunk).
// Powers of two so the vertex stage recovers the slot via a shift; sized so real chunks are single-slot
// (oversized/world-fork chunks split into extra independent slots, never dropped). ~21 MB total pool
// VRAM at the ~4 GB storage-binding limit — a non-issue.

import { Mesh } from 'three'
import * as THREE from 'three'

import { BLOCK_REGISTRY, is_leaf_sprite_block } from '../config/block_registry.js'
import { CHUNK_SIZE, TIER_LOAD_RADIUS } from '../config/world_config.js'
import { get_tier, TIER_ORDER } from '../core/quality/tiers.js'

import { create_gpu_cull } from './gpu_cull.js'
import { create_quad_pool } from './quad_pool.js'
import { foliage_cull_margin } from './terrain_flora.js'
import {
  atlas_layer_count,
  bake_block_textures,
  build_data_array_texture,
  upload_atlas_single_call,
} from './texture_baker.js'
import { create_terrain_material } from './terrain_material.js'
import { leaf_band_for, tier_view_distance_m } from './leaf_band.js'

/** @typedef {import('three/webgpu').WebGPURenderer} WebGPURenderer */
/** @typedef {import('three').Scene} Scene */
/** @typedef {import('three').Camera} Camera */
/** @typedef {import('../core/quality/tiers.js').TierName} TierName */
/** @typedef {'solid'|'foliage'|'cutout'|'canopy'|'liquid'} RenderClass — LEAVES-2X Rung 2 adds `canopy`:
 *   the OPAQUE far-leaf cube shell (leaf id + face<6), a discard-free material so it gets early-Z, split
 *   off from the alphaTest `cutout` leaf SPRITES (leaf id + face≥6). Near=cutout sprites, far=canopy cubes,
 *   crossfaded per-vertex by distance (terrain_material.js) — but BOTH always live in the mesh/pools. */

/** @typedef {[number, number, number]} ChunkCoord [cx, cy, cz] — matches the RENDER↔CORE seam's
 *   existing consumer (core/island_loader.js calls `upload_chunk([cx, cy, cz], ...)`). */

/**
 * @typedef {object} TerrainRendererStats
 * @property {number} draw_calls total indirect draws — one per occupied pool slot across all classes
 * @property {number} quads total live quads across uploaded chunks
 * @property {number} liquid_quads subset of `quads` in the translucent liquid class
 * @property {number} sector_count always 0 (kept for API compat; the pool has no sectors)
 * @property {number} chunk_count number of resident (uploaded) chunks
 * @property {number} dropped_uploads cumulative write_chunk→false events (each re-enqueued + retried on a free slot).
 * @property {number} permanent_drops exhausted-retry buckets = a stranded unrendered chunk; MUST stay 0 (else a LOUD signal).
 */

/**
 * @typedef {object} TerrainRenderer
 * @property {(chunk_coord: ChunkCoord, quad_buffer: Uint32Array, quad_count: number) => void} upload_chunk
 *   uploads (or replaces) one chunk's quads into the mega pool(s); a pure buffer write into free slot(s).
 * @property {(chunk_coord: ChunkCoord) => void} remove_chunk frees a chunk's slots (instanceCount→0).
 * @property {(camera?: Camera, queue_depth?: number) => void} update per-frame: dispatches the 3 GPU
 *   cull compute passes (one per class) that write each slot's indirect instanceCount from the camera
 *   frustum. No re-records, no compile queue. No-op when no renderer/camera (cube-gate injected renderer).
 * @property {() => TerrainRendererStats} get_stats current draw/quad/slot counters
 * @property {() => number} upload_epoch monotonic counter incremented on every chunk upload/removal —
 *   the general terrain-dirty signal. Unchanged between uploads, so steady frames re-render nothing.
 * @property {() => number} shadow_epoch monotonic counter incremented ONLY when an uploaded/removed
 *   chunk's XZ footprint intersects the current sun shadow box (set via `set_shadow_box`), so chunks
 *   streaming in/out beyond the box during flight don't force a shadow re-render.
 * @property {(min_x: number, min_z: number, max_x: number, max_z: number) => void} set_shadow_box
 *   pushes the sun shadow ortho box's world XZ extent so `shadow_epoch` can scope its bumps.
 * @property {(sun: import('three').Vector3) => void} [set_sun_direction] aims the liquid material's
 *   reflection sun (the water sun-road glint) — engine.js drives it on every time-of-day change with
 *   the same sun the sky/clouds/far-shell read (NG2-C handoff; frozen at build-time noon otherwise).
 *   Optional so seam mocks (ring_manager.test.js) stay minimal; the real renderer always provides it.
 * @property {() => Record<string, unknown>} [pool_stats] per-class pool utilization + fragmentation +
 *   dropped-upload counters for the perf report (bench-only, read via window.__terrain_renderer).
 * @property {(cls: RenderClass, visible: boolean) => void} [set_class_visible] bench-only A/B: show/
 *   hide a whole render class's pool mesh (measures the foliage marginal frame cost). No gameplay use.
 * @property {() => void} dispose full GPU teardown: disposes every class material + pool + cull, the
 *   block atlas texture, removes the pool meshes from the scene, and empties the resident set.
 */

/** block_id set for the liquid render class. Built once from the registry — currently just `water` —
 *  so a quad's water-ness is a Set.has() on its decoded block_id (word B bits 0-11). */
const LIQUID_BLOCK_IDS = new Set(BLOCK_REGISTRY.filter((block) => block.class === 'liquid').map((block) => block.id))
/** D164 block_id set for the LEAF render classes (broadleaf/conifer/dry/palm). Leaves are registry class
 *  'solid' (gen/collision keep exact 1 m cubes) but render as a leaf-atlas material. Matched via the shared
 *  `is_leaf_sprite_block` predicate (the single home) so registry id shifts + new leaf blocks follow both the
 *  mesher and the pool. LEAVES-2X Rung 2 splits a leaf's quads by FACE: sprite billboards (faces 6/7) → the
 *  alphaTest `cutout` pool (airy near); the opaque cube shell (faces 0-5) → the discard-free `canopy` pool
 *  (early-Z far). One id set, two classes keyed on the face bit — no new wire field. */
const LEAF_BLOCK_IDS = new Set(BLOCK_REGISTRY.filter(is_leaf_sprite_block).map((block) => block.id))
/** word A → face id (bits 28-30); word B → block_id (bits 0-11). Local masks so the partition loop
 *  doesn't re-derive them from terrain_material's private constants. */
const FACE_SHIFT = 28
const FACE_MASK = 0x7
const BLOCK_ID_MASK = 0xfff

/** Per-class GPU-frustum padding. Solid/cutout/canopy/liquid vertices stay within the generic 1 m
 *  greedy-face allowance; foliage's shader-displaced billboards need their larger owned envelope.
 *  @param {RenderClass} cls render-class key (solid|cutout|canopy|liquid|foliage) */
export function render_class_aabb_margin(cls) {
  return cls === 'foliage' ? foliage_cull_margin : 1
}

/**
 * @typedef {object} QuadPartition
 * @property {Uint32Array} solid packed u32 pairs for the opaque-solid render class
 * @property {Uint32Array} foliage packed u32 pairs for the cross/foliage render class (face>=6, non-leaf)
 * @property {Uint32Array} cutout packed u32 pairs for the alpha-cutout leaf SPRITE class (face>=6, leaf ids)
 * @property {Uint32Array} canopy packed u32 pairs for the opaque far-leaf CUBE class (face<6, leaf ids)
 * @property {Uint32Array} liquid packed u32 pairs for the translucent-liquid render class
 */

/**
 * Splits a combined quad buffer into the FIVE render classes by DECODED fields, copying u32 word PAIRS
 * together so every quad's [word_a, word_b] stays intact and correctly aligned. LEAVES-2X Rung 2: a leaf
 * quad routes by its FACE bit — the leaf id + the face together pick cutout (sprite) vs canopy (cube):
 *   leaf id & face≥6               → cutout (D164 alpha-cutout leaf SPRITES — the airy near canopy)
 *   leaf id & face<6               → canopy (opaque leaf CUBE shell — the early-Z far canopy)
 *   face≥6 (non-leaf)              → foliage (cross billboards: grass/flowers)
 *   block_id∈liquid ids            → liquid
 *   else                           → solid
 * Leaf/liquid/foliage id+face sets are disjoint in practice (a leaf is never water; grass billboards carry
 * a grass, not leaf, id). A pure function so it is word-level equality-tested against a reference filter
 * without a GPU (see pool_renderer.test.js). `quad_buffer` must hold `quad_count` quads (length ≥
 * quad_count*2); only the first `quad_count` quads are read. Bucket lengths sum to exactly `quad_count`.
 * @param {Uint32Array} quad_buffer packed u32 pairs (length ≥ quad_count*2)
 * @param {number} quad_count number of quads to partition
 * @returns {QuadPartition}
 */
export function partition_quads(quad_buffer, quad_count) {
  const is_leaf = /** @param {number} id */ (id) => LEAF_BLOCK_IDS.has(id)
  let foliage_count = 0
  let liquid_count = 0
  let cutout_count = 0
  let canopy_count = 0
  for (let i = 0; i < quad_count; i++) {
    const face = (quad_buffer[i * 2] >>> FACE_SHIFT) & FACE_MASK
    const id = quad_buffer[i * 2 + 1] & BLOCK_ID_MASK
    if (is_leaf(id)) face >= 6 ? cutout_count++ : canopy_count++
    else if (face >= 6) foliage_count++
    else if (LIQUID_BLOCK_IDS.has(id)) liquid_count++
  }
  const solid_count = quad_count - foliage_count - liquid_count - cutout_count - canopy_count

  const solid = new Uint32Array(solid_count * 2)
  const foliage = new Uint32Array(foliage_count * 2)
  const cutout = new Uint32Array(cutout_count * 2)
  const canopy = new Uint32Array(canopy_count * 2)
  const liquid = new Uint32Array(liquid_count * 2)
  let si = 0
  let fi = 0
  let ci = 0
  let cai = 0
  let li = 0
  for (let i = 0; i < quad_count; i++) {
    const a = quad_buffer[i * 2]
    const b = quad_buffer[i * 2 + 1]
    const id = b & BLOCK_ID_MASK
    const face = (a >>> FACE_SHIFT) & FACE_MASK
    if (is_leaf(id)) {
      if (face >= 6) {
        cutout[ci * 2] = a
        cutout[ci * 2 + 1] = b
        ci++
      } else {
        canopy[cai * 2] = a
        canopy[cai * 2 + 1] = b
        cai++
      }
    } else if (face >= 6) {
      foliage[fi * 2] = a
      foliage[fi * 2 + 1] = b
      fi++
    } else if (LIQUID_BLOCK_IDS.has(id)) {
      liquid[li * 2] = a
      liquid[li * 2 + 1] = b
      li++
    } else {
      solid[si * 2] = a
      solid[si * 2 + 1] = b
      si++
    }
  }
  return { solid, foliage, cutout, canopy, liquid }
}

/** UNLOAD_MARGIN mirrors ring_manager.js's `unload_margin` default (2): a chunk stays resident out to
 *  load_radius + margin before eviction, so the pool must cover that full footprint. Local copy (the ring
 *  does not export it); if the ring's margin ever changes, the D33 per-tier bench (dropped_uploads gate)
 *  catches the resulting starvation. */
const UNLOAD_MARGIN = 2

/** Quads per slot per class (S — a power of two; the vertex stage recovers the slot via a shift). This is
 *  TIER-INDEPENDENT: a dense chunk needs the same quads/slot at every view distance (mesh topology does
 *  not scale with tier — see the header note), so ONLY the slot COUNT (max_slots) is tier-driven, never S.
 *   • solid 2048   — a dense surface chunk ≈2200 q spans 2 slots (node size_probe 2026-07-03).
 *   • foliage 8192 — FLORA-CHAOS multi-plane grass ocean: the decorator places AT MOST ONE cross-plant per
 *     column emitting K billboard PAIRS (2·K q; K = registry `cross_pairs`), densest a K=3 carpet =
 *     32·32·6 = 6144 q ⇒ still ONE 8192-slot (every real foliage chunk single-slot, the pool invariant).
 *   • cutout 2048  — D164 alpha-cutout canopy leaves are CUBE faces greedy-meshed like solids, so a canopy
 *     chunk tracks the solid ceiling; 2048 keeps it single-slot (a big-tree chunk splits a 2nd, never drops).
 *   • liquid 512   — a water surface is ≈30 q/chunk; always single-slot. */
export const SLOT_QUADS = /** @type {Record<RenderClass, number>} */ ({
  solid: 2048,
  foliage: 8192,
  cutout: 2048,
  // canopy 2048 — LEAVES-2X Rung 2 opaque leaf CUBE shell. Same measured ceiling class as solid/cutout
  //   (avg 3675 q/forest-chunk ⇒ 2 slots; worst 11734 ⇒ 6 slots, split independently, never dropped).
  canopy: 2048,
  liquid: 512,
})

/** Per-class RESIDENT-COLUMN slot occupancy (slots per resident column) — the anchor for TIER-DRIVEN
 *  max_slots. Each tier's pool is a boot-time FIXED allocation sized to the columns ITS radius makes
 *  resident, so LOW/MEDIUM stop paying for HIGH's r8 headroom they can never fill. This is the GPU-CEILING
 *  fix: the fixed pool commits FULLY on cold boot regardless of live occupancy (measured 2026-07-11 — an
 *  r5 boot already committed ~731 MB GPU-process RSS with the flat r8-sized pool), so an r8-sized pool on
 *  the r7 MEDIUM tier crossed the tab's hard ~851–861 MB GPU-process ceiling on PLAIN boot
 *  (an Aw-Snap tab crash). Sizing to r7 for MEDIUM / r4 for LOW keeps the fixed commit well under it
 *  (measured: MEDIUM steady ≈550 MB, LOW ≈494 MB).
 *
 *  RATES = the measured peak (D33 headed sweep: solid r6 958 / r7 1193 / r8 1456 slots ≈ 3.3/col; and the
 *  2026-07-11 boot occupancy probe at the dense grass/forest spawn: solid 4.7, foliage 0.51, cutout 1.45,
 *  liquid 0.48 slots/col) plus safety headroom:
 *  [2026-07-12 GEN-V9 full resize] Triggered by a "cutout pool full" console storm and a frozen game. The
 *  GEN_VERSION 8/9 proc-tree default resized SOLID (5.8→18) but the canopy is CUTOUT-class (leaves), and
 *  cutout/foliage/liquid were never re-measured — cutout demand ran 2.3× its budget on EVERY forest column,
 *  a PERMANENTLY over-budget pool that turned tonight's fail-loud retry path into a per-chunk log + retry
 *  storm. ALL FOUR rates now come from the same measured probe (121-col forest ring around chunk 8,-7 at
 *  GEN v9 defaults — baked proctrees, leaf fins ON; cross-checked 49 cols at the freeze-repro locus 0,-11):
 *   • solid 20    — measured avg 11.5 / p95 16 / max 18 (v9 bake nudged the v8 max 17→18; the old 18 budget
 *     had ZERO margin) + 2 margin. [History: GEN_VERSION 8 quadrupled solid geometry past the 5.8 budget —
 *     write_chunk→false with no retry = a permanent "water where ground should be" hole.]
 *   • foliage 2.0 — measured p95 = max = 2 at BOTH sites (grass on a slope splits a column's surface across
 *     two layers more often than the old 0.51-avg estimate assumed; 1.0 stranded 16/121 forest columns).
 *   • cutout 10   — measured avg 5.6 / p95 7 / max 8 + 2 margin (was 2.5: over on 121/121 forest columns —
 *     THE storm). Proc-tree canopies are cutout cubes + fins, so cutout tracks tree density like solid does.
 *   • liquid 2.0  — measured max 2 at both sites: v9 stacks water layers in one column (lake/waterfall pool
 *     above sea-level water), so the old "one surface layer" physical-max assumption is dead.
 *  VRAM (fixed boot commit, slot = 16/64/16/4 KB): MEDIUM r7 pool 143→221 MB (GPU process ≈ 619→~700 MB,
 *  ceiling ~851); HIGH r8 156→266 MB; LOW r4 37→105 MB. FOLLOW-UP (perf report): tier-gated tree
 *  LOD/impostors would cut fill AND let solid+cutout shrink back.
 *  The D33 per-tier bench (dropped_uploads === 0 at each tier's radius over a real-terrain drive) is the
 *  empirical GATE — a rate too low for some biome surfaces there as a dropped upload, never a silent hole;
 *  render_hole.test.js's seam invariant now locks ALL FOUR classes to this measured demand. */
export const SLOTS_PER_COLUMN = /** @type {Record<RenderClass, number>} */ ({
  solid: 20,
  foliage: 2.0,
  cutout: 10,
  // canopy 13 — [LEAVES-2X Rung 2] MEASURED per-column demand of the opaque leaf-cube shell (dual-emit,
  //   real-occupancy cull) over a 4-center forest ring (484 cols / 226 with canopy): avg 5.34 / p95 9 /
  //   max 11 slots/col + 2 margin. Tracks tree density like cutout (10, max 8 sprites) — the cube shell is
  //   ~1.34× the sprite quad count. VRAM (MEDIUM r7, 16 KB/slot): +4736 slots ≈ +78 MB fixed boot commit
  //   (the design's "+40-80 MB" honest cost — the render_hole seam bench is the dropped_uploads=0 GATE).
  canopy: 13,
  liquid: 2.0,
})

/** @type {RenderClass[]} — class order used everywhere the pools are iterated (LEAVES-2X Rung 2: + canopy). */
const RENDER_CLASSES = ['solid', 'foliage', 'cutout', 'canopy', 'liquid']

/**
 * Semantic class order within Three's opaque/transparent queues: depth-writing terrain before the
 * non-writing foliage colour pass; then the colorless GRASS-DEPTH restore BEFORE water, so water
 * depth-tests against grass and stops painting over emergent blades (#675). Water never writes depth,
 * so grass depth still survives into the final scene depth for the post silhouettes (#454). Three
 * reverses both sorted queues for a reversed-Z camera, so mirror the raw order to preserve those
 * semantics on the live WebGPU path (the same gotcha as tactical/board_highlights.js).
 * @param {RenderClass|'foliage_depth'} cls @param {boolean} [reversed_depth]
 */
export function terrain_render_order(cls, reversed_depth = false) {
  // foliage_depth 0.75: after foliage colour (0.5), BEFORE water (1). Was 2 (after water) — leaving grass
  // out of the depth buffer at water's draw, so water painted over emergent grass blades (#675).
  const order = cls === 'foliage_depth' ? 0.75 : cls === 'liquid' ? 1 : cls === 'foliage' ? 0.5 : 0
  return reversed_depth ? -order : order
}

/**
 * Resolves the per-class quad-pool sizing for a tier — the boot-time FIXED allocation (POOL_CONFIG, now
 * TIER-DRIVEN). max_slots is DERIVED, never guessed: resident columns = (2·(radius + UNLOAD_MARGIN) + 1)²
 * for the tier's TIER_LOAD_RADIUS (LOW r4 / MEDIUM r7 / HIGH r8), × the class SLOTS_PER_COLUMN rate,
 * rounded UP to a tidy multiple of 64. slot_quads stays tier-independent (SLOT_QUADS). A tier CHANGE
 * re-sizes only through the existing engine reload path — the pool never regrows mid-session (the design).
 * Resolved sizes (GEN-V9 rates, max_slots · MB): LOW r4 solid 3392·53 foliage 384·24 cutout 1728·27
 * liquid 384·1.5 ≈ 105 MB; MEDIUM r7 solid 7232·113 foliage 768·48 cutout 3648·57 liquid 768·3 ≈ 221 MB;
 * HIGH r8 solid 8832·138 foliage 896·56 cutout 4416·69 liquid 896·3.5 ≈ 266 MB.
 * @param {TierName} [tier]
 * @returns {Record<RenderClass, { slot_quads: number, max_slots: number }>}
 */
export function resolve_pool_config(tier = 'medium') {
  const radius = TIER_LOAD_RADIUS[tier] ?? TIER_LOAD_RADIUS.medium
  const columns = (2 * (radius + UNLOAD_MARGIN) + 1) ** 2 // resident footprint incl. unload_margin
  const config = /** @type {Record<RenderClass, { slot_quads: number, max_slots: number }>} */ ({})
  for (const cls of RENDER_CLASSES) {
    const max_slots = Math.ceil((SLOTS_PER_COLUMN[cls] * columns) / 64) * 64
    config[cls] = { slot_quads: SLOT_QUADS[cls], max_slots }
  }
  return config
}

/** Bytes per pooled quad in a class mega-buffer = uvec2 (quad_pool.js `pool_attr` is a Uint32Array with
 *  2 u32 per quad). Single home for the "8 bytes/quad" fact both the buffer alloc and the device-limit
 *  request depend on — quad_pool.test.js locks the alloc to this shape. */
const QUAD_POOL_BYTES_PER_QUAD = 2 * Uint32Array.BYTES_PER_ELEMENT

/**
 * Byte size of the LARGEST single GPU storage buffer the terrain pools allocate at `tier` — the mega quad
 * buffer (quad_pool.js `pool_attr` = capacity_quads · uvec2) of the densest render class. core/renderer.js
 * sizes the WebGPU `maxStorageBufferBindingSize` device limit from this so that buffer BINDS: the spec
 * DEFAULT (128 MiB) is UNDER the HIGH r8 solid pool (8832 slots · 2048 quads · 8 B ≈ 138 MiB), so left at
 * the default the storage bind group is invalid → GPUValidationError → the tab CRASHES on a HIGH-tier
 * dense boot (QA F2/B2). Derived from the same resolve_pool_config the pools allocate from, so the
 * requested limit and the real buffer can never drift. Fixed at boot (the pool never regrows mid-session).
 * @param {TierName} [tier]
 * @returns {number} bytes of the largest per-class quad pool buffer
 */
export function max_pool_storage_bytes(tier = 'medium') {
  const config = resolve_pool_config(tier)
  let max_bytes = 0
  for (const cls of RENDER_CLASSES) {
    const bytes = config[cls].max_slots * config[cls].slot_quads * QUAD_POOL_BYTES_PER_QUAD
    if (bytes > max_bytes) max_bytes = bytes
  }
  return max_bytes
}

/**
 * The highest tier at or below `tier` whose terrain pool can BIND on an adapter with this
 * `max_storage_binding_bytes` — the ONE home for "which tier does this device actually boot at" (#1434).
 * A pool buffer larger than the granted binding limit is an invalid storage bind group, i.e. a
 * GPUValidationError on every terrain draw and a crashed tab, so the fit must be the SAME answer the
 * device-limit request (core/renderer.js) and the pool sizing (engine.js → create_terrain_renderer) both
 * read. It was two answers: renderer.js stepped a LOCAL copy down while the pool kept the unfitted tier,
 * which is precisely the crash the step-down was written to prevent. Only ever degrades — never promotes a
 * tier the caller did not ask for — and floors at the lowest rung (a device below even LOW degrades
 * loudly at the call site rather than silently booting an unbindable pool).
 * @param {TierName} tier the requested boot tier
 * @param {number} max_storage_binding_bytes adapter.limits.maxStorageBufferBindingSize
 * @returns {TierName}
 */
export function fit_tier_to_adapter(tier, max_storage_binding_bytes) {
  let i = TIER_ORDER.indexOf(tier)
  if (i === -1) return tier
  while (i > 0 && max_pool_storage_bytes(TIER_ORDER[i]) > max_storage_binding_bytes) i -= 1
  return TIER_ORDER[i]
}

/** @param {number} cx @param {number} cy @param {number} cz */
function chunk_key(cx, cy, cz) {
  return `${cx},${cy},${cz}`
}

/**
 * Creates the GPU-driven terrain renderer (the RENDER↔CORE seam's `create_terrain_renderer`).
 * @param {object} options
 * @param {import('three/webgpu').WebGPURenderer | null} options.renderer used to dispatch the cull
 *   compute pass; null (the cube-gate injected renderer) ⇒ no cull, every resident slot stays visible.
 * @param {import('three').Scene} options.scene
 * @param {import('three').Camera | null} options.camera
 * @param {import('../core/quality/tiers.js').TierName} [options.tier]
 * @param {import('../tactical/board_occlusion.js').BoardOcclusionUniforms} [options.board_occlusion]
 *   D167-B: the tactical feathered-occlusion uniforms, threaded into every class material so a mounted
 *   fight board can dissolve occluders between the camera and the arena. Omitted ⇒ no occlusion term.
 * @param {import('./texture_palette.js').TexturesConfig} [options.textures] per-world texture palette
 *   (FIVE-WORLDS config.textures) baked into the atlas; omitted ⇒ the default palette.
 * @param {import('./reveal_front.js').RevealFront} [options.reveal_front] [FIRST-LOAD] the radial
 *   materialization-front uniforms, threaded into every class material (inert until engine.js drives it).
 * @param {Record<RenderClass, { slot_quads: number, max_slots: number }>} [options.pool_config] explicit
 *   per-class pool sizing that overrides `resolve_pool_config(tier)` — only the drop-recovery test injects
 *   this (a tiny pool to exercise write_chunk→false); production omits it and takes the tier sizing.
 * @param {boolean} [options.gpu_cull] false skips only the per-class cull computes; indirect counts stay visible.
 * @param {() => void} [options.on_gpu_cull] hitch-probe hook immediately before each cull dispatch.
 * @param {(bytes: number) => void} [options.on_chunk_uploaded] hitch hook after successful pool writes,
 *   aggregated once per source chunk; includes deferred retry recovery writes.
 * @param {number} [options.retry_time_budget_ms] wall-clock cap for deferred recovery writes (default 3 ms).
 * @returns {TerrainRenderer}
 */
export function create_terrain_renderer({
  renderer,
  scene,
  camera: default_camera,
  tier = 'medium',
  board_occlusion,
  textures,
  reveal_front,
  pool_config: pool_config_override,
  gpu_cull = true,
  on_gpu_cull,
  on_chunk_uploaded,
  retry_time_budget_ms = 3,
}) {
  const tier_def = get_tier(tier)
  const reversed_depth = renderer?.reversedDepthBuffer === true
  // [FIRST-LOAD] the radial materialization front (?reveal=dissolve|rise|scan, default dissolve). Only the
  // chosen variant's TSL graph compiles (read ONCE here, baked into every class material). Absent location
  // (node/tests) ⇒ 'dissolve' — but with no reveal_front uniforms wired it folds to a no-op regardless.
  const reveal_variant = /** @type {'dissolve'|'rise'|'scan'} */ (
    typeof location !== 'undefined' &&
    ['dissolve', 'rise', 'scan'].includes(new URLSearchParams(location.search).get('reveal') ?? '')
      ? /** @type {string} */ (new URLSearchParams(location.search).get('reveal'))
      : 'dissolve'
  )
  // INTERIM foliage shadow gate (2026-07-03): whether the alpha-tested cross-flora class casts into the
  // sun shadow map (high+ only, per tiers.js.foliage_shadows). After LEAVES-2X Rung 1 this
  // gates BOTH the leaf-sprite (cutout) AND grass/flower (foliage) casters (see the castShadow line
  // below) — cast at HIGH only. (Tier still doesn't affect pool
  // topology.)
  const foliage_casts_shadow = tier_def.foliage_shadows
  // [SHADER DIET D8] LOW build-time-gates the whole sun shadow map off (no class casts, no class
  // receives) so the color fragments shed shadow sampling AND the solid depth-caster pipeline (the
  // measured 70 KB shadow variant) is never compiled. The BFS sun-leak gate keeps canopy floors / caves
  // dark — relocated into the direct-sun term of the simple lighting model (terrain_material.js), since
  // receivedShadowNode only fires when a shadow map is received. FALSE at MEDIUM/HIGH ⇒ shadows unchanged.
  const { simple_shaders } = tier_def

  // Bake the painterly atlas ONCE — shared by all three class materials (never re-baked per chunk).
  // FIVE-WORLDS: `textures` (config.textures) applies the world's per-family palette; absent ⇒ default atlas.
  // [S-85] Atlas texel size is TIER-DRIVEN (texture_resolution_px): LOW 32 (reduced textures for the
  // mobile ask), MEDIUM 64 (UNCHANGED — the shipped size, byte-identical), HIGH 128 (best textures). A
  // per-world `textures.size` (if any) still overrides inside bake_block_textures. Boot-only (baked once).
  // DEVICE TEXTURE-ARRAY BUDGET (spec-minimum adapters cap at 256). The renderer requested
  // min(adapter max, MAX_ATLAS_LAYERS) at device acquisition; read the GRANTED limit back off the WebGPU
  // device so a spec-minimum adapter (natural 357 > 256) bakes a REDUCED atlas that fits instead of throwing
  // GPUValidationError → black world (fit_layer_plan). Undefined (WebGL2 / no device) ⇒ ∞ (natural bake,
  // today's behavior). Byte-identical to the unconstrained atlas whenever the budget ≥ the natural total.
  const device_layer_limit =
    /** @type {{backend?: {device?: {limits?: {maxTextureArrayLayers?: number}}}}} */ (renderer)?.backend?.device
      ?.limits?.maxTextureArrayLayers ?? Infinity
  const bake = bake_block_textures({
    size: tier_def.texture_resolution_px,
    seed: 0,
    textures,
    max_layers: device_layer_limit,
  })
  // Boot-time provenance (loud in dev): baked atlas layers vs the device limit. `reduced` ⇒ this adapter
  // couldn't fit the natural atlas and we shed variants to fit — correct textures, mild tiling.
  const reduced = bake.layers < atlas_layer_count()
  console[reduced ? 'warn' : 'log'](
    `[pool] block atlas: ${bake.layers} layers baked · device limit ${device_layer_limit} · natural ${atlas_layer_count()}` +
      (reduced ? ' · REDUCED to fit a spec-minimum adapter' : '')
  )
  const block_texture = build_data_array_texture(THREE, bake)
  // [P0 balloon 2026-07-11] Upload the atlas in ONE writeTexture instead of three r185's per-LAYER loop
  // (each of the 339 layer calls stages the FULL 5.5 MB buffer ⇒ ~1.8 GB of renderer-native staging in one
  // synchronous boot burst — measured; half of the tab-killing OOM). WebGPU-only; WebGL2 keeps three's path.
  upload_atlas_single_call(renderer, block_texture)
  const { layer_of } = bake

  /** @type {Record<RenderClass, ReturnType<typeof create_quad_pool>>} */
  const pools = /** @type {any} */ ({})
  /** @type {Record<RenderClass, ReturnType<typeof create_gpu_cull>>} */
  const culls = /** @type {any} */ ({})
  /** @type {Mesh[]} */
  const meshes = []
  /** @type {Set<string>} */
  const resident = new Set()
  let dropped_uploads = 0 // pool-full soft misses (write_chunk→false events; reported for the pool-health stat)

  // ── FAIL-LOUD DROP RECOVERY (render-hole robustness, bug fix 2026-07-12; STORM-CONTROLLED same day) ─
  // A write_chunk→false (slot exhaustion) used to just bump dropped_uploads while the ring marked the chunk
  // uploaded — a RESIDENT (collidable) chunk rendering NO mesh = a permanent SILENT hole ("water where
  // ground should be"). A failed bucket is RE-ENQUEUED and retried when slots free — but the FIRST retry
  // design froze the game when a pool was PERMANENTLY over demand (cutout at 2.3× budget): a
  // console.error per chunk per strand + an O(pending) flush on EVERY slot-free + 16-attempts-then-
  // permanent-drop turned steady eviction into a per-frame log/retry/hole storm. The storm-controlled shape:
  //   • log ONCE per class (counters carry the detail: pool_stats().pending_retries / dropped_uploads),
  //   • retries drain BUDGETED — once per update() (one frame), only after a real slot-free, with a
  //     per-class still-full early-exit (a full class is skipped, not re-attempted per bucket),
  //   • NO retry cap: a stranded bucket stays pending until it fits / is superseded / its chunk unloads —
  //     leaving the dense area recovers every hole; permanent_drops fires ONLY on queue overflow,
  //   • a class pending with zero recoveries across UNDERSIZED_AFTER_FLUSHES drains degrades LOUDLY ONCE:
  //     the pool is undersized for this world — raise SLOTS_PER_COLUMN.<class>.
  const MAX_PENDING = 512 // cap on stored quad buffers (transient overflow only); a saturated queue is a loud drop
  /** Consecutive zero-recovery drains (with pending) before the one-shot UNDERSIZED verdict (~2 s of frames). */
  const UNDERSIZED_AFTER_FLUSHES = 120
  /** @type {Map<string, { key: string, cls: RenderClass, pairs: Uint32Array, count: number, origin: [number, number, number] }>} `${chunk_key}|${cls}` → bucket awaiting a free slot. */
  const pending_uploads = new Map()
  let permanent_drops = 0 // queue-overflow buckets = a LOUD (never silent) hole
  let flush_needed = false // latched on slot-frees; drained once per update() (budgeted, never per-free)
  /** @type {Set<RenderClass>} classes whose first-strand error already logged (once per class, never per chunk) */
  const strand_logged = new Set()
  /** @type {Set<RenderClass>} classes whose one-shot UNDERSIZED verdict already logged */
  const undersized_logged = new Set()
  /** @type {Record<RenderClass, number>} consecutive zero-recovery drains while that class had pending buckets */
  const stranded_drains = { solid: 0, foliage: 0, cutout: 0, canopy: 0, liquid: 0 }

  /** the liquid material's tod-sun hook (water_material.js stashes it on userData) — captured at
   *  class-material build so `set_sun_direction` below can aim the water's sun-road glint (NG2-C:
   *  frozen-at-noon otherwise, the dusk glint would point at the wrong sun).
   *  @type {((sun: import('three').Vector3) => void) | null} */
  let water_sun_hook = null
  /** the sun-direction hooks of the lit-foliage materials (terrain_material stashes `set_foliage_sun` on
   *  userData) — foliage's per-plane dispersion (round-3) AND D164 cutout-leaf backlight both read the
   *  same sun; `set_sun_direction` feeds every hook so both track tod. @type {((sun: import('three').Vector3) => void)[]} */
  const foliage_sun_hooks = []

  /** @type {RenderClass[]} */
  const CLASSES = RENDER_CLASSES
  // TIER-DRIVEN boot-time FIXED pool sizing (GPU-ceiling fix): LOW/MEDIUM size to their own r4/r7 footprint
  // instead of paying for HIGH's r8 headroom — the fixed pool commits fully on cold boot, so an r8 pool on
  // the r7 MEDIUM tier crossed the tab's ~851 MB GPU-process ceiling. Boot-only; a tier swap reloads.
  // `pool_config_override` (drop-recovery test only) forces a tiny pool to exercise write_chunk→false.
  const pool_config = pool_config_override ?? resolve_pool_config(tier)
  // [LEAVES-2X Rung 2 · tier band] the sprite→cube crossfade window for THIS tier — sprites dress the near
  // half of the tier's voxel ring, opaque cubes the far half (leaf_band.js). Boot-time constant (the pool
  // never re-tiers live), shared by all class materials; only the leaf classes (cutout/canopy) read it.
  const leaf_band = leaf_band_for(tier_view_distance_m(tier))
  for (const cls of CLASSES) {
    const { slot_quads, max_slots } = pool_config[cls]
    const pool = create_quad_pool({ slot_quads, max_slots })
    pools[cls] = pool
    culls[cls] = create_gpu_cull({
      meta_attr: pool.meta_attr,
      indirect_attr: pool.indirect_attr,
      slot_quads,
      max_slots,
      chunk_size: CHUNK_SIZE,
      aabb_margin: render_class_aabb_margin(cls),
    })
    const material = create_terrain_material({
      pool_attr: pool.pool_attr,
      meta_attr: pool.meta_attr,
      slot_quads,
      block_texture,
      layer_of,
      variant: cls,
      board_occlusion, // D167-B: per-class occlusion fade (dither on opaque solid/cutout, alpha on foliage/liquid)
      grass_sway: tier_def.grass_sway, // [S-85] false at LOW → flora wind is STATIC ("no grass moving")
      simple_shaders, // [SHADER DIET] build-time-gates the expensive terrain-fragment nodes off at LOW
      reveal_front, // [FIRST-LOAD] radial materialization front uniforms (inert until engine.js drives the radius)
      reveal_variant, // dissolve | rise | scan (only this variant's graph compiles)
      leaf_band, // [Rung 2] tier sprite→cube crossfade window (metres) — cutout/canopy vertex collapse
    })
    const mesh = new Mesh(pool.geometry, material)
    mesh.frustumCulled = false // culling is per-slot on the GPU, not three's object-level test
    mesh.matrixAutoUpdate = false // static at identity — chunk origin is applied in-shader
    mesh.renderOrder = terrain_render_order(cls, reversed_depth)
    // SHADOW CASTING — INTERIM directional term (VOXEL-SUN, a GPU-compute per-surface-voxel DDA
    // sun-visibility trace, will retire the whole terrain shadow map; keep this simple, no cascade
    // tuning). SOLID always casts + receives (tree TRUNKS + terrain self-shadow). The BFS sun-leak gate
    // in terrain_material (receivedShadowNode × smoothstep(0, SUN_FULL/15, v_sun)) is the view-independent
    // primary that dims canopy floors regardless of what the camera-frustum-culled shadow pass contains.
    // [LEAVES-2X Rung 1] CUTOUT (the alpha-cutout leaf SPRITE storm) + FOLIAGE (grass tufts/flowers) are
    // the sub-texel/priciest casters (F8 survey): thousands of DoubleSide alpha-tested billboards
    // rasterized into the depth map on EVERY shadow re-render (camera-chunk crossing / streaming) — a big
    // slice of the canopy-facing FREEZES, paid TWICE (main pass + shadow pass). Both now gate on
    // tiers.foliage_shadows → cast only at HIGH; LOW/MEDIUM (the common perf tiers) skip the
    // storm and let the BFS sun-leak gate own the (softer, opacity-2) canopy-floor darkening. Was
    // `cls === 'cutout'` unconditionally — leaves cast at every tier, the freeze source. LIQUID never
    // casts (depthWrite-off). NO F8 hash-storm: each class has ONE static material (zero per-frame
    // material-graph churn), so toggling the alpha-tested casters cannot trigger F8's per-frame hashing.
    // [LEAVES-2X Rung 2] CANOPY (the opaque far-leaf cubes) casts on the SAME HIGH gate as its cutout
    // sprites — so a canopy's shadow behaviour is CONTINUOUS across the near→far band (both cast at HIGH,
    // neither at MEDIUM). The near cubes are vertex-collapsed to degenerate, so this only feeds the FAR
    // cube shell into the depth pass (opaque, early-Z, cheap) — never the near-player floor.
    // [SHADER DIET D8] at LOW nothing casts (kills the 70 KB solid-shadow pipeline) and nothing receives
    // (sheds shadow sampling from every color fragment); cave/canopy-floor darkening moves to the sun-leak
    // gate folded into the simple lighting model's direct term. MEDIUM/HIGH unchanged (simple_shaders false).
    mesh.castShadow =
      !simple_shaders &&
      (cls === 'solid' || ((cls === 'cutout' || cls === 'foliage' || cls === 'canopy') && foliage_casts_shadow))
    mesh.receiveShadow = !simple_shaders
    if (cls === 'liquid') {
      // Transparent-queue order 1: after opaque terrain/foliage colour AND after the grass-depth restore
      // (#675) — so water depth-tests against grass and never paints over emergent blades.
      mesh.userData.is_liquid = true
      water_sun_hook = material.userData.set_water_sun ?? null
    } else if (cls === 'foliage' || cls === 'cutout' || cls === 'canopy') {
      // foliage dispersion (grass) + D164 cutout-leaf backlight + Rung-2 canopy-leaf backlight all read the
      // same tod sun uniform (terrain_material stashes set_foliage_sun) — feed every hook so all track dusk.
      const hook = material.userData.set_foliage_sun
      if (hook) foliage_sun_hooks.push(hook)
    }
    mesh.userData.render_class = cls // bench A/B hook (set_class_visible) — see the perf gate
    scene.add(mesh) // NO BundleGroup — the pool mesh is a plain scene child (survey F1)
    meshes.push(mesh)
    if (cls === 'foliage') {
      // GRASS DEPTH (#675): the foliage COLOUR pass above is depthWrite:false, so grass leaves no depth for
      // water to test against — water (transparent) then painted straight over emergent blades. This colorless
      // clone writes the alpha-tested grass silhouette into depth BEFORE water (renderOrder 0.75 < liquid 1),
      // so water is correctly occluded by grass. Water never writes depth, so the same silhouette still stands
      // in the final scene depth for the depth-composited clouds/fog (#454). Tradeoff vs the old after-water
      // placement (#303): where grass is fully submerged water now samples the nearer grass depth (reads
      // slightly clearer there) — accepted, the emergent-over-water case is the visible defect. The clone
      // shares the pool, atlas and TSL nodes; it is colorless and allocated once at boot (no per-frame work).
      const scene_depth_material = material.clone()
      scene_depth_material.transparent = true
      scene_depth_material.alphaTest = material.alphaTest
      scene_depth_material.colorWrite = false
      scene_depth_material.depthWrite = true
      const scene_depth_mesh = new Mesh(pool.geometry, scene_depth_material)
      scene_depth_mesh.frustumCulled = false
      scene_depth_mesh.matrixAutoUpdate = false
      scene_depth_mesh.renderOrder = terrain_render_order('foliage_depth', reversed_depth)
      scene_depth_mesh.userData.render_class = 'foliage_depth'
      scene_depth_mesh.userData.scene_depth_restore = true
      scene.add(scene_depth_mesh)
      meshes.push(scene_depth_mesh)
    }
  }

  // ── SHADOW-SCOPE EPOCHS — a chunk change bumps the general upload_epoch
  // always, and the scoped shadow_epoch ONLY when its XZ footprint touches the sun shadow box, so
  // chunks streaming in/out beyond the box during flight don't force a shadow re-render). ──────────
  let upload_epoch = 0
  let shadow_epoch = 0
  /** @type {[number, number, number, number] | null} */
  let shadow_box = null
  /** @param {number} cx @param {number} cz */
  function bump_shadow_if_in_box(cx, cz) {
    if (shadow_box === null) {
      shadow_epoch += 1
      return
    }
    const min_x = cx * CHUNK_SIZE
    const min_z = cz * CHUNK_SIZE
    const [bx0, bz0, bx1, bz1] = shadow_box
    if (min_x + CHUNK_SIZE >= bx0 && min_x <= bx1 && min_z + CHUNK_SIZE >= bz0 && min_z <= bz1) {
      shadow_epoch += 1
    }
  }

  /** Store a bucket whose write_chunk failed (pool full) for retry when a slot frees; log ONCE PER CLASS
   *  (an unlogged freeze storm was dozens of per-chunk errors per frame), and treat a saturated queue as a
   *  permanent (never silent) drop.
   *  @param {string} key @param {RenderClass} cls @param {Uint32Array} pairs @param {number} count
   *  @param {[number, number, number]} origin */
  function enqueue_retry(key, cls, pairs, count, origin) {
    const pkey = `${key}|${cls}`
    if (!pending_uploads.has(pkey) && pending_uploads.size >= MAX_PENDING)
      return drop_permanently(key, cls, `full and retry queue saturated (${MAX_PENDING})`)
    if (!strand_logged.has(cls)) {
      strand_logged.add(cls)
      console.error(
        `[pool_renderer] ${cls} pool full: chunk uploads are being DROPPED + re-enqueued (resident/collidable ` +
          `but unrendered until slots free). Logged once per class — live counts: pool_stats().pending_retries.`
      )
    }
    pending_uploads.set(pkey, { key, cls, pairs, count, origin })
  }

  /** The loudest, never-silent failure: a bucket that can never be placed. @param {string} key @param {RenderClass} cls @param {string} why */
  function drop_permanently(key, cls, why) {
    permanent_drops += 1
    console.error(
      `[pool_renderer] ${cls} pool ${why}; chunk ${key} dropped PERMANENTLY — collidable but UNRENDERED (a hole). ` +
        `Raise SLOTS_PER_COLUMN.${cls} or lower world density.`
    )
  }

  /** BUDGETED drain (once per update() after a real slot-free): retry stranded buckets nearest-full-stop —
   *  a class that answers still-full is skipped for the rest of the drain (its state can't improve mid-drain;
   *  writes only consume slots). A class pending with ZERO recoveries across UNDERSIZED_AFTER_FLUSHES drains
   *  degrades LOUDLY once — the pool is undersized for this world's density — then keeps waiting quietly
   *  (leaving the dense area frees slots and recovers every bucket; no thrash, no permanent hole). */
  function flush_pending() {
    flush_needed = false
    if (pending_uploads.size === 0) return
    const start = performance.now()
    let attempts = 0
    let budget_exhausted = false
    /** @type {Set<RenderClass>} */
    const still_full = new Set()
    /** @type {Set<RenderClass>} */
    const recovered = new Set()
    /** Debug-only aggregation by source chunk; absent when no hitch hook is installed. @type {Map<string, number> | null} */
    const recovered_uploads = on_chunk_uploaded ? new Map() : null
    for (const [pkey, e] of pending_uploads) {
      if (still_full.has(e.cls)) continue
      if (attempts > 0 && performance.now() - start >= retry_time_budget_ms) {
        budget_exhausted = true
        break
      }
      attempts += 1
      if (pools[e.cls].write_chunk(e.key, e.pairs, e.count, e.origin)) {
        pending_uploads.delete(pkey)
        recovered.add(e.cls)
        recovered_uploads?.set(e.key, (recovered_uploads.get(e.key) ?? 0) + e.count * QUAD_POOL_BYTES_PER_QUAD)
      } else still_full.add(e.cls)
    }
    if (budget_exhausted && pending_uploads.size > 0) flush_needed = true
    if (recovered_uploads) for (const bytes of recovered_uploads.values()) on_chunk_uploaded?.(bytes)
    for (const cls of CLASSES) {
      if (still_full.has(cls) && !recovered.has(cls)) {
        stranded_drains[cls] += 1
        if (stranded_drains[cls] >= UNDERSIZED_AFTER_FLUSHES && !undersized_logged.has(cls)) {
          undersized_logged.add(cls)
          console.error(
            `[pool_renderer] ${cls} pool UNDERSIZED for this world: ${pending_uploads.size} pending buckets ` +
              `saw zero recoveries over ${UNDERSIZED_AFTER_FLUSHES} drains — demand exceeds the boot-time budget. ` +
              `Raise SLOTS_PER_COLUMN.${cls} (logged once).`
          )
        }
      } else stranded_drains[cls] = 0
    }
  }

  return {
    upload_chunk([cx, cy, cz], quad_buffer, quad_count) {
      upload_epoch += 1
      bump_shadow_if_in_box(cx, cz)
      const key = chunk_key(cx, cy, cz)
      const origin = /** @type {[number,number,number]} */ ([cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE])

      if (quad_count === 0) {
        // A now-empty chunk: drop any previous residency across every class.
        if (resident.has(key)) {
          for (const cls of CLASSES) pools[cls].remove_chunk(key)
          for (const cls of CLASSES) pending_uploads.delete(`${key}|${cls}`) // an empty chunk supersedes any pending retry
          resident.delete(key)
          flush_needed = true // slots freed — stranded buckets retry on the next update() drain (budgeted)
        }
        return
      }

      // Partition into the three classes (same decode as sector-mode) and write each non-empty bucket
      // into its pool. write_chunk replaces in place, so re-upload of a resident key is handled.
      const { solid, foliage, cutout, canopy, liquid } = partition_quads(quad_buffer, quad_count)
      /** @type {[RenderClass, Uint32Array][]} */
      const buckets = [
        ['solid', solid],
        ['foliage', foliage],
        ['cutout', cutout],
        ['canopy', canopy], // [LEAVES-2X Rung 2] opaque far-leaf cube shell → its own early-Z pool
        ['liquid', liquid],
      ]
      let uploaded_bytes = 0
      for (const [cls, pairs] of buckets) {
        const count = pairs.length / 2
        const pkey = `${key}|${cls}`
        // 0 frees any prior slot; a success/empty supersedes a pending retry; a write→false is re-enqueued (never a silent hole).
        if (count === 0) {
          pools[cls].remove_chunk(key)
          pending_uploads.delete(pkey)
        } else if (pools[cls].write_chunk(key, pairs, count, origin)) {
          pending_uploads.delete(pkey)
          uploaded_bytes += count * QUAD_POOL_BYTES_PER_QUAD
        } else {
          dropped_uploads += 1
          enqueue_retry(key, cls, pairs, count, origin)
        }
      }
      if (uploaded_bytes > 0) on_chunk_uploaded?.(uploaded_bytes)
      resident.add(key)
    },

    remove_chunk([cx, cy, cz]) {
      const key = chunk_key(cx, cy, cz)
      if (!resident.has(key)) return
      upload_epoch += 1
      bump_shadow_if_in_box(cx, cz)
      for (const cls of CLASSES) pools[cls].remove_chunk(key)
      for (const cls of CLASSES) pending_uploads.delete(`${key}|${cls}`) // removed key: drop any pending retry for it
      resident.delete(key)
      flush_needed = true // slots freed — stranded buckets retry on the next update() drain (budgeted)
    },

    update(active_camera, _queue_depth = 0) {
      // Budgeted drop-recovery drain FIRST (once per frame, only after a real slot-free) — before the
      // cull early-return so headless/test renderers (renderer:null) still recover stranded buckets.
      if (flush_needed) flush_pending()
      // The ONLY other per-frame work: dispatch the 5 GPU cull passes (one per class), which frustum-cull
      // every slot and write its indirect instanceCount. No sectors, no re-records, no compile queue.
      // Skipped when no renderer/camera (cube-gate injected renderer) — pools then draw all-visible.
      const cam = active_camera ?? default_camera
      if (!renderer || !cam || !gpu_cull) return
      for (const cls of CLASSES) {
        on_gpu_cull?.()
        culls[cls].run(renderer, cam)
      }
    },

    get_stats() {
      let draw_calls = 0
      let quads = 0
      let liquid_quads = 0
      for (const cls of CLASSES) {
        const s = pools[cls].stats()
        draw_calls += s.slots // one indirect draw per occupied slot
        quads += s.quads
        if (cls === 'liquid') liquid_quads = s.quads
      }
      return {
        draw_calls,
        quads,
        liquid_quads,
        sector_count: 0,
        chunk_count: resident.size,
        dropped_uploads, // dropped_uploads/permanent_drops = HUD drop-health (permanent_drops non-zero = a stranded/unrendered chunk)
        permanent_drops,
      }
    },

    /** Bench-only A/B: show/hide a whole render class's pool mesh (e.g. hide 'foliage' to measure its
     * marginal frame cost = the DIVERGENCE-WAVE +1 ms gate). No gameplay path calls this.
     * @param {RenderClass} cls @param {boolean} visible */
    set_class_visible(cls, visible) {
      for (const mesh of meshes)
        if (mesh.userData.render_class === cls || (cls === 'foliage' && mesh.userData.render_class === 'foliage_depth'))
          mesh.visible = visible
    },

    /** Pool-health snapshot for the perf report (utilization + fragmentation + soft misses + drop recovery). */
    pool_stats() {
      /** @type {Record<string, unknown>} */
      const out = { dropped_uploads, permanent_drops, pending_retries: pending_uploads.size }
      // [P0 leak probe 2026-07-12] Retained-bytes accounting so a bench can NAME a JS-heap climber:
      // (a) pending_bytes = the quad buffers held by stranded retry buckets (≈0 when the pool isn't full —
      //     a climb here convicts the drop-recovery pending path); (b) gpu = three's LIVE GPU-object counts
      //     — geometries/textures climbing monotonically with flat pending_bytes localises the leak to
      //     undisposed GPU objects (the far shell's per-section geometries), not this pool's fixed buffers.
      let pending_bytes = 0
      for (const e of pending_uploads.values()) pending_bytes += e.pairs.byteLength
      out.pending_bytes = pending_bytes
      const info = /** @type {any} */ (renderer)?.info
      if (info)
        out.gpu = {
          geometries: info.memory?.geometries ?? 0,
          textures: info.memory?.textures ?? 0,
          calls: info.render?.calls ?? 0,
        }
      for (const cls of CLASSES) out[cls] = pools[cls].stats()
      return out
    },

    upload_epoch() {
      return upload_epoch
    },
    shadow_epoch() {
      return shadow_epoch
    },
    set_shadow_box(min_x, min_z, max_x, max_z) {
      shadow_box = [min_x, min_z, max_x, max_z]
    },
    /**
     * Aim the water's reflection sun (the sun-road glint) — engine.js drives this on every
     * time-of-day change with the SAME sun the sky/clouds/far-shell read, so the glint tracks
     * dusk instead of staying frozen at the material's build-time noon (NG2-C water handoff).
     * @param {import('three').Vector3} sun unit sun direction
     */
    set_sun_direction(sun) {
      water_sun_hook?.(sun)
      // per-plane grass dispersion (round-3) + D164 cutout-leaf backlight both track the same sun
      for (const hook of foliage_sun_hooks) hook(sun)
    },

    dispose() {
      for (const mesh of meshes) {
        const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of material) m.dispose()
        mesh.removeFromParent()
      }
      for (const cls of CLASSES) {
        pools[cls].dispose()
        culls[cls].dispose()
      }
      block_texture.dispose()
      resident.clear()
      pending_uploads.clear()
    },
  }
}
