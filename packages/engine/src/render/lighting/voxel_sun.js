// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG2-SHAFT voxel sun-visibility — a VIEW-INDEPENDENT shadow volume for the froxel light shafts.
//
// The froxel scatter pass (froxels.js) currently fakes canopy/terrain occlusion with a 5-tap
// heightfield horizon march + a canopy coverage hook — smooth, but it can't see a HOLE in the
// canopy or the MOUTH of a cave, so shafts don't actually pierce real geometry. This module fixes
// that with two coupled 3D textures over the resident chunk ring:
//
//   1. OCCUPANCY  — a coarse 2 m-cell binary volume (0 empty / 255 solid), CPU-authored from the
//      resident ChunkRecords (class 'solid' only — LEAVES ARE SOLID here, they must occlude; that
//      is the whole point) and re-uploaded only when the camera crosses a hysteresis threshold.
//   2. VISIBILITY — a GPU-compute volume, same dims: per cell, DDA/raymarch toward the sun through
//      OCCUPANCY; 1 = open sky reached, 0 = hit terrain/canopy. The froxel scatter kernel samples
//      this (`sample_visibility_at`) instead of its heightfield march, so a shaft lands exactly
//      where the sky is actually visible through the voxels.
//
// Both textures are camera-centered and snapped to the 2 m grid. The occupancy rebuild is the only
// CPU cost and is gated behind the move-hysteresis; the visibility march re-runs each frame (cheap:
// a 128³-ish dispatch of ≤64 texture taps) so a moving sun updates shafts without a rebuild.
//
// Coordinate contract (verify at integration): WORLD units == METERS == BLOCKS (BLOCK_SIZE_METERS=1
// in world_config.js), y-up. Chunk (cx,cy,cz) is in CHUNK units; its voxel (lx,ly,lz) sits at world
// (cx*32+lx, cy*32+ly, cz*32+lz). `sun_direction` points FROM the surface TOWARD the sun.
//
// Pure helpers (`world_to_cell`, `build_occupancy`) are GPU-free and side-effect-free for `bun test`.

import {
  ClampToEdgeWrapping,
  Data3DTexture,
  HalfFloatType,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  Vector3,
} from 'three'
import { Storage3DTexture } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  Return,
  float,
  floor,
  instanceIndex,
  mix,
  smoothstep,
  texture3D,
  textureStore,
  uniform,
  uvec3,
  vec3,
  vec4,
} from 'three/tsl'

import { CHUNK_SIZE } from '../../config/world_config.js'
import { get_block_by_id } from '../../config/block_registry.js'
import { local_index } from '../../chunks/format.js'

/** Occupancy/visibility cell size, in meters (world == blocks). Two blocks per cell edge. */
export const CELL_M = 2
/** Default volume dimensions, in cells. 96×56×96 → 192 m × 112 m × 192 m; Uint8 occupancy ≈ 0.5 MB.
 *  Shafts + enclosure are a NEAR phenomenon (target: ~20 m under-canopy visibility, shafts within a
 *  chunk or two), so the volume is deliberately modest — smaller ⇒ far fewer chunks to CPU-scan on a
 *  re-center AND a cheaper GPU march. The vertical 112 m is biased UP (see the box snap) to cover canopy
 *  + a little below, not the deep column (which never contributes shafts). */
export const OCC_X = 96
export const OCC_Y = 56
export const OCC_Z = 96
/** Sun march: step ~= one cell, bounded step count. 40 × CELL_M = 80 m reach toward the sun — ample for
 *  NEAR canopy/cave-mouth shafts (the volume itself is only 96 cells wide), and 37% cheaper per march
 *  than 64. The march is event-gated (occupancy re-center / sun tick), never per-frame. */
export const MARCH_STEPS = 40
/** Re-center + CPU-rebuild the occupancy only after the camera moves this far (m) on any axis. One
 *  chunk-width (32 m) — the volume is 256 m across, so the camera stays well inside between rebuilds,
 *  and the rebuild (the only per-event CPU cost) fires ~4× less often than at 16 m during flight. */
export const RECENTER_M = 32
/** [2026-07-05 FROXEL REBUILD] BOUNDARY FEATHER (uvw units, 0..0.5) over which `sample_channel` blends
 *  the marched visibility toward the neutral open default at the box faces — kills the hard inside/outside
 *  step that painted the concentric static arcs. 0.12 ≈ the outer ~23 m rind of the 192 m box: wide enough
 *  that the transition is imperceptible, narrow enough that the deep interior (shafts/enclosure live there)
 *  keeps its true occlusion. Must stay < 0.5 (a full half-extent would feather away the whole volume). */
export const BOUNDARY_FEATHER = 0.12

/**
 * Whether a block id occludes the sun in the occupancy volume: class 'solid' ONLY (leaves included —
 * they are class 'solid' in the registry so canopy casts shafts). Air/liquid/foliage do NOT occlude.
 * Mirrors mesher.js's solid test op-for-op.
 * @param {number} id block id (0 = air)
 * @returns {boolean}
 */
export function is_solid_occluder(id) {
  return id !== 0 && get_block_by_id(id)?.class === 'solid'
}

/**
 * World point → integer occupancy-cell indices (pure, side-effect-free). `origin` is the volume's
 * world-space min corner (already grid-snapped). Cells outside the volume return out-of-range indices
 * — callers bounds-check before indexing.
 * @param {number} wx world x (m)
 * @param {number} wy world y (m)
 * @param {number} wz world z (m)
 * @param {readonly [number, number, number]} origin volume min-corner world position [x,y,z] (m)
 * @param {number} cell_m cell edge length (m)
 * @returns {[number, number, number]} integer [cx, cy, cz] cell indices
 */
export function world_to_cell(wx, wy, wz, origin, cell_m) {
  return [
    Math.floor((wx - origin[0]) / cell_m),
    Math.floor((wy - origin[1]) / cell_m),
    Math.floor((wz - origin[2]) / cell_m),
  ]
}

/**
 * CPU-builds the occupancy Uint8Array from resident chunk records: a cell is 255 iff ANY of the
 * 2×2×2 (= cell_m³) voxels it covers is a class-'solid' block, else 0. Pure + GPU-free so a test can
 * assert a hand-placed solid voxel marks exactly the covering cell and air/liquid/foliage do not.
 *
 * Iterates VOXELS of the chunks overlapping the volume (not cells) — each solid voxel stamps its one
 * covering cell — so cost is O(resident solid voxels), and the array is fully cleared first.
 * @param {import('../../chunks/format.js').ChunkRecord[]} records resident chunk records
 * @param {readonly [number, number, number]} origin volume min-corner world position (m), grid-snapped
 * @param {readonly [number, number, number]} dims volume size in cells [x,y,z]
 * @param {number} cell_m cell edge length (m)
 * @param {(id: number) => boolean} is_solid injected occluder predicate (id → occludes?)
 * @returns {Uint8Array} length dims[0]*dims[1]*dims[2]; 0 empty, 255 solid
 */
/**
 * Stamps ONE chunk's solid voxels into an occupancy array (255 per covered 2 m cell). The per-chunk
 * body of {@link build_occupancy}, factored out so the amortized rebuilder can process chunks one at a
 * time. Begins with a chunk-AABB reject (skip chunks not overlapping the volume). Does NOT clear `out`.
 * @param {Uint8Array} out occupancy array, length dims[0]*dims[1]*dims[2]
 * @param {import('../../chunks/format.js').ChunkRecord} rec
 * @param {readonly [number, number, number]} origin volume min-corner world position (m)
 * @param {readonly [number, number, number]} dims volume size in cells [x,y,z]
 * @param {number} cell_m cell edge (m)
 * @param {(id: number) => boolean} solid_of occluder predicate (should be LUT-backed by the caller)
 */
export function stamp_chunk(out, rec, origin, dims, cell_m, solid_of) {
  const [dx, dy, dz] = dims
  const [ox, oy, oz] = origin
  const base_x = rec.cx * CHUNK_SIZE
  const base_y = rec.cy * CHUNK_SIZE
  const base_z = rec.cz * CHUNK_SIZE
  // CHUNK AABB REJECT: skip chunks not overlapping the volume (the resident ring is much larger than the
  // box — especially the full-height column — so most chunks bail here, before the 32³ voxel scan).
  if (
    base_x + CHUNK_SIZE <= ox ||
    base_x >= ox + dx * cell_m ||
    base_y + CHUNK_SIZE <= oy ||
    base_y >= oy + dy * cell_m ||
    base_z + CHUNK_SIZE <= oz ||
    base_z >= oz + dz * cell_m
  )
    return
  const { ids } = rec
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const cy = Math.floor((base_y + ly - oy) / cell_m)
    if (cy < 0 || cy >= dy) continue
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const cz = Math.floor((base_z + lz - oz) / cell_m)
      if (cz < 0 || cz >= dz) continue
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = ids[local_index(lx, ly, lz)]
        if (id === 0 || !solid_of(id)) continue
        const cx = Math.floor((base_x + lx - ox) / cell_m)
        if (cx < 0 || cx >= dx) continue
        out[(cy * dz + cz) * dx + cx] = 255
      }
    }
  }
}

/**
 * CPU-builds the FULL occupancy Uint8Array from resident chunk records: a cell is 255 iff ANY covered
 * class-'solid' voxel exists, else 0. Pure + GPU-free (used by tests + a first synchronous build). The
 * live engine rebuilds INCREMENTALLY (a few chunks/frame) via {@link stamp_chunk} — see create_voxel_sun.
 * @param {import('../../chunks/format.js').ChunkRecord[]} records resident chunk records
 * @param {readonly [number, number, number]} origin volume min-corner world position (m), grid-snapped
 * @param {readonly [number, number, number]} dims volume size in cells [x,y,z]
 * @param {number} cell_m cell edge length (m)
 * @param {(id: number) => boolean} is_solid injected occluder predicate (id → occludes?)
 * @returns {Uint8Array} length dims[0]*dims[1]*dims[2]; 0 empty, 255 solid
 */
export function build_occupancy(records, origin, dims, cell_m, is_solid) {
  const out = new Uint8Array(dims[0] * dims[1] * dims[2])
  for (const rec of records) stamp_chunk(out, rec, origin, dims, cell_m, is_solid)
  return out
}

/**
 * @typedef {object} VoxelSunOptions
 * @property {*} [sun_direction] `uniform(vec3)` world sun direction (points toward the sun). SHARE the
 *   caller's / sky_node's uniform so a moving sun re-marches visibility. Auto-normalized in the kernel.
 * @property {number} [cell_m] cell edge (m), default {@link CELL_M}.
 * @property {number} [occ_x] volume width in cells, default {@link OCC_X}.
 * @property {number} [occ_y] volume height in cells, default {@link OCC_Y}.
 * @property {number} [occ_z] volume depth in cells, default {@link OCC_Z}.
 * @property {number} [march_steps] sun-march step count, default {@link MARCH_STEPS}.
 * @property {number} [recenter_m] re-center hysteresis (m), default {@link RECENTER_M}.
 */

/**
 * Build the voxel sun-visibility system: a CPU-authored occupancy Data3DTexture, a GPU-compute
 * visibility Storage3DTexture, the DDA march kernel, a per-frame `update`, and the `sample_visibility_at`
 * node the froxel scatter pass calls. Nothing is wired into froxels/engine here — that is the caller's job.
 * @param {VoxelSunOptions} [opts]
 */
export function create_voxel_sun(opts = {}) {
  const cell_m = opts.cell_m ?? CELL_M
  const dx = opts.occ_x ?? OCC_X
  const dy = opts.occ_y ?? OCC_Y
  const dz = opts.occ_z ?? OCC_Z
  const march_steps = opts.march_steps ?? MARCH_STEPS
  const recenter_m = opts.recenter_m ?? RECENTER_M
  const cell_count = dx * dy * dz

  const sun_direction = opts.sun_direction ?? uniform(new Vector3(0.3, 0.6, 0.2).normalize())

  // Volume world-space min corner (grid-snapped), shared by CPU build + GPU march + sampling.
  const box_origin = uniform(new Vector3())
  // Volume world-space size (m) — const per dims, used to normalize world → uvw.
  const box_size = uniform(new Vector3(dx * cell_m, dy * cell_m, dz * cell_m))

  // OCCUPANCY: CPU-authored, GPU-sampled. RedFormat / UnsignedByteType / Nearest / ClampToEdge, no mips.
  const occ_data = new Uint8Array(cell_count)
  const occ_tex = new Data3DTexture(occ_data, dx, dy, dz)
  occ_tex.format = RedFormat
  occ_tex.type = UnsignedByteType
  occ_tex.minFilter = NearestFilter
  occ_tex.magFilter = NearestFilter
  occ_tex.wrapS = ClampToEdgeWrapping
  occ_tex.wrapT = ClampToEdgeWrapping
  occ_tex.wrapR = ClampToEdgeWrapping
  occ_tex.generateMipmaps = false
  occ_tex.needsUpdate = true

  // VISIBILITY: GPU-written storage volume, same dims (mirror froxels' `mk`). HalfFloat holds 0..1.
  const vis_tex = new Storage3DTexture(dx, dy, dz)
  vis_tex.type = HalfFloatType

  // Hysteresis anchor — the camera position the current occupancy was built for. NaN forces a first build.
  let anchor_x = Number.NaN
  let anchor_y = Number.NaN
  let anchor_z = Number.NaN
  // Sun direction the visibility volume was last marched for — NaN forces a first march. The march
  // re-runs only when the occupancy re-centers OR the sun rotates past a threshold (see update()).
  let marched_sun_x = Number.NaN
  let marched_sun_y = Number.NaN
  let marched_sun_z = Number.NaN

  // INCREMENTAL (AMORTIZED) OCCUPANCY REBUILD state. A full rebuild scans ~250 chunks (~28 ms) — far
  // too much for one frame. So on a re-center we SNAPSHOT the resident records + target origin and fill
  // a SCRATCH buffer a few chunks per frame; the LIVE occ_data keeps the previous volume until the fill
  // completes, then we swap + re-upload + re-march. No pop, bounded per-frame cost (the p99 fix).
  const occ_scratch = new Uint8Array(cell_count)
  /** @type {import('../../chunks/format.js').ChunkRecord[] | null} */
  let pending_records = null
  let pending_cursor = 0
  const pending_origin = new Vector3()
  // Persistent solid-id LUT (id→0/1), lazily filled — shared across the incremental stamping so the
  // Map/registry lookup happens once per distinct id EVER, not per rebuild.
  const solid_lut = new Uint8Array(4096)
  const solid_seen = new Uint8Array(4096)
  /** @param {number} id @returns {boolean} */
  const solid_lut_of = (id) => {
    if (id >= 4096) return is_solid_occluder(id)
    if (solid_seen[id] === 0) {
      solid_seen[id] = 1
      solid_lut[id] = is_solid_occluder(id) ? 1 : 0
    }
    return solid_lut[id] === 1
  }
  /** Chunks stamped per update() frame while a rebuild is in flight — bounds the per-frame CPU cost. */
  const REBUILD_CHUNKS_PER_FRAME = 8

  // ---- DDA MARCH (one instance per cell) — TWO occlusion rays, packed into the vis texture ---------
  // .r = SUN visibility (toward `sun_direction`): drives the froxel light SHAFTS.
  // .g = SKY openness (straight UP): drives the froxel ENCLOSURE FOG — interior air (canopy/cave, low
  //      openness) reads THICK so you see only ~20 m, while open air (openness 1) stays clear long-range.
  // Both use the same OCCUPANCY volume + the same HARD rule: 1 until the first solid hit along the ray,
  // then 0 (latched). A ray that exits the box before a hit stays 1 (open sky). Nearest occupancy taps ⇒
  // no bleed; froxels' trilinear read softens the field for free.
  /**
   * Marches OCCUPANCY from `start` along `step_v` for `march_steps`, returning 1 (never hit → open) or
   * 0 (hit solid inside the box). Inlined at kernel build (TSL), zero call overhead.
   * @param {*} start vec3 node — first sample world position @param {*} step_v vec3 node — per-step delta
   * @returns {*} float node in {0,1}
   */
  const march_open = (start, step_v) => {
    const p = start.toVar()
    const blocked = float(0).toVar()
    Loop(march_steps, () => {
      const uvw = p.sub(box_origin).div(box_size).toVar()
      const inside = uvw.x
        .greaterThanEqual(0)
        .and(uvw.x.lessThanEqual(1))
        .and(uvw.y.greaterThanEqual(0))
        .and(uvw.y.lessThanEqual(1))
        .and(uvw.z.greaterThanEqual(0))
        .and(uvw.z.lessThanEqual(1))
      const occ = texture3D(occ_tex, uvw, 0).r
      const hit = inside.and(occ.greaterThan(0.5)).select(float(1), float(0))
      blocked.assign(blocked.max(hit))
      p.addAssign(step_v)
    })
    return blocked.oneMinus()
  }

  const march_k = Fn(() => {
    const i = instanceIndex
    If(i.greaterThanEqual(cell_count), () => {
      Return()
    })
    const cx = i.mod(dx)
    const cy = i.div(dx).mod(dy)
    const cz = i.div(dx * dy)

    // Cell center in world space: origin + (cell + 0.5) * cell_m.
    const p0 = vec3(float(cx).add(0.5).mul(cell_m), float(cy).add(0.5).mul(cell_m), float(cz).add(0.5).mul(cell_m)).add(
      box_origin
    )

    // SUN ray (start one cell up-sun so a cell never shadows itself on its own solid voxel).
    const sun_step = sun_direction.normalize().mul(cell_m).toVar()
    const sun_vis = march_open(p0.add(sun_step), sun_step)
    // SKY ray — straight up (enclosure). Same self-shadow guard: start one cell above.
    const up_step = vec3(0, cell_m, 0)
    const sky_open = march_open(p0.add(up_step), up_step)

    textureStore(vis_tex, uvec3(cx.toUint(), cy.toUint(), cz.toUint()), vec4(sun_vis, sky_open, 0, 1)).toWriteOnly()
  })().compute(cell_count)
  march_k.setName('voxelSunMarch')

  /**
   * Shared world-point → vis-texture channel read: trilinear tap, CLAMP-TO-EDGE, and — the 2026-07-05
   * FROXEL-REBUILD fix — a smooth BOUNDARY FEATHER instead of a hard `inside ? v : 1`. The old hard
   * select was THE static-arc source: a fog sample just inside a terrain-SHADOWED region read v≈0 while a
   * neighbour just outside read a hard 1 (open), and since the froxel depth slices are camera-concentric
   * shells that lit-vs-shadowed step painted as concentric arcs. Now the CLAMP-TO-EDGE sample is CONTINUED
   * smoothly across the boundary: within a feather band (BOUNDARY_FEATHER of the box half-extent) inside
   * the faces we lerp the marched value toward the neutral open-sky default (1), and outside we hold that
   * default — so the field is C0-continuous across the box edge (no step ⇒ no arc), while deep-interior
   * samples keep their true marched occlusion. `edge_t` = 0 at/beyond a face, 1 once fully inside the band.
   * @param {*} world_p_node vec3 world-position node (m) @param {'r'|'g'} chan @returns {*} float [0,1]
   */
  const sample_channel = (world_p_node, chan) => {
    const uvw = world_p_node.sub(box_origin).div(box_size).toVar()
    // distance (in uvw units, 0..0.5) from the nearest face along each axis, then the min over axes.
    const face_d = vec3(uvw.x.min(uvw.x.oneMinus()), uvw.y.min(uvw.y.oneMinus()), uvw.z.min(uvw.z.oneMinus()))
    const near_face = face_d.x.min(face_d.y).min(face_d.z)
    // 0 at/outside a face → 1 once ≥ BOUNDARY_FEATHER inside it. smoothstep so the blend is C1 as well.
    const edge_t = smoothstep(float(0), float(BOUNDARY_FEATHER), near_face)
    const v = texture3D(vis_tex, uvw.clamp(0, 1), 0)[chan]
    // Continue toward the neutral open default (1) at the boundary; true marched value deep inside.
    return mix(float(1), v, edge_t)
  }

  /**
   * Sample sun VISIBILITY at a world point → float node in [0,1] (1 = lit, 0 = shadowed). Reads the vis
   * texture's .r channel; points OUTSIDE the volume return 1 (open). This is the node the froxel scatter
   * kernel calls in place of its heightfield horizon march.
   * @param {*} world_p_node vec3 world-position node (m)
   * @returns {*} float node in [0,1]
   */
  const sample_visibility_at = (world_p_node) => sample_channel(world_p_node, 'r')

  /**
   * Sample SKY OPENNESS at a world point → float [0,1] (1 = open to sky above, 0 = fully enclosed under
   * canopy/rock). Reads the vis texture's .g channel. Outside the volume → 1 (open). The froxel
   * density_hook multiplies fog density by `(1 − openness)` so interiors get thick, mysterious air.
   * @param {*} world_p_node vec3 world-position node (m)
   * @returns {*} float node in [0,1]
   */
  const sample_sky_openness_at = (world_p_node) => sample_channel(world_p_node, 'g')

  /**
   * @typedef {object} VoxelSunFrame
   * @property {(cb: (rec: import('../../chunks/format.js').ChunkRecord) => void) => void} [for_each_resident]
   *   invokes `cb` for each resident chunk record (e.g. a wrapper over the store's `values()`).
   * @property {import('../../chunks/format.js').ChunkRecord[]} [records] alternative: the resident records array.
   */

  /**
   * Per-frame: (1) if the camera crossed the hysteresis, re-center the volume onto the 2 m grid,
   * CPU-rebuild occupancy from the resident records, and re-upload it; (2) dispatch the visibility march.
   *
   * Occupancy rebuild is gated by move-hysteresis; the march runs every call (cheap) so a moving sun
   * updates shafts without a rebuild.
   *
   * INCREMENTAL RE-MARCH BUDGET: a future version would, instead of re-marching all `cell_count` cells,
   * dispatch only the cells within a "dirty slab" — the union of the newly-shifted border planes when
   * the box re-centers plus the swept cone of the sun-direction delta — carrying a per-cell dirty bit /
   * generation stamp and a compacted index list, so steady-state cost is O(border), not O(volume).
   * Not implemented (YAGNI): the full-volume march is already a bounded, sub-millisecond dispatch.
   * @param {*} renderer WebGPURenderer
   * @param {*} camera camera with a `.position` Vector3 (world m)
   * @param {VoxelSunFrame} frame resident-record access
   */
  const update = (renderer, camera, frame) => {
    const px = camera.position.x
    const py = camera.position.y
    const pz = camera.position.z

    const moved =
      Number.isNaN(anchor_x) ||
      Math.abs(px - anchor_x) >= recenter_m ||
      Math.abs(py - anchor_y) >= recenter_m ||
      Math.abs(pz - anchor_z) >= recenter_m

    // On a re-center, START a new amortized rebuild: snapshot the target origin + resident records and
    // reset the cursor. We do NOT move box_origin yet — the LIVE volume keeps rendering at the old origin
    // until the scratch fill completes (below), so there is no half-filled pop.
    if (moved && pending_records === null) {
      const snap = (/** @type {number} */ c, /** @type {number} */ below) =>
        Math.floor((c - below * cell_m) / cell_m) * cell_m
      pending_origin.set(snap(px, dx / 2), snap(py, dy * 0.35), snap(pz, dz / 2))
      /** @type {import('../../chunks/format.js').ChunkRecord[]} */
      const records = []
      if (frame.records) records.push(...frame.records)
      else if (frame.for_each_resident) frame.for_each_resident((rec) => records.push(rec))
      pending_records = records
      pending_cursor = 0
      occ_scratch.fill(0)
      anchor_x = px
      anchor_y = py
      anchor_z = pz
    }

    // AMORTIZED FILL: stamp up to REBUILD_CHUNKS_PER_FRAME chunks/frame into the scratch buffer. When the
    // snapshot is fully processed, atomically swap it into the live occupancy + adopt the new origin +
    // re-upload + (via `filled`) re-march. Bounds the per-frame CPU to a handful of chunks (the p99 fix).
    let filled = false
    if (pending_records !== null) {
      const origin = /** @type {[number,number,number]} */ ([pending_origin.x, pending_origin.y, pending_origin.z])
      const dims_t = /** @type {[number,number,number]} */ ([dx, dy, dz])
      const end = Math.min(pending_cursor + REBUILD_CHUNKS_PER_FRAME, pending_records.length)
      for (; pending_cursor < end; pending_cursor++) {
        stamp_chunk(occ_scratch, pending_records[pending_cursor], origin, dims_t, cell_m, solid_lut_of)
      }
      if (pending_cursor >= pending_records.length) {
        occ_data.set(occ_scratch)
        box_origin.value.copy(pending_origin)
        occ_tex.needsUpdate = true
        pending_records = null
        filled = true
      }
    }

    // BUDGET: the DDA march is a heavy dispatch (dims × 2 rays × march_steps taps). Re-run it ONLY when
    // something it depends on changed — the occupancy just finished a rebuild (`filled`) OR the sun
    // rotated past a threshold — NOT every frame. Between updates the visibility volume stays valid, so
    // steady-state cost is ZERO. (This + the amortized fill are the practical incremental re-march budget.)
    const sd = sun_direction.value
    const sun_moved =
      Math.abs(sd.x - marched_sun_x) + Math.abs(sd.y - marched_sun_y) + Math.abs(sd.z - marched_sun_z) > 0.01
    if (filled || sun_moved) {
      renderer.compute(march_k)
      marched_sun_x = sd.x
      marched_sun_y = sd.y
      marched_sun_z = sd.z
    }
  }

  return {
    occ_tex,
    vis_tex,
    box_origin,
    box_size,
    sun_direction,
    march_k,
    sample_visibility_at,
    sample_sky_openness_at,
    update,
    // constants for wiring/tests
    cell_m,
    dims: /** @type {[number, number, number]} */ ([dx, dy, dz]),
    march_steps,
    recenter_m,
  }
}
