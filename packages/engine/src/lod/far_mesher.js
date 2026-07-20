// Far-section SMOOTH-HEIGHTFIELD mesher (§11 NG-LOD, design pivot 2026-07-03) — turns one
// downsampled Section (section_builder.js) into a CONTINUOUS interpolated terrain surface, replacing
// the earlier DH box-columns. The verdict on box-columns at distance: distant L3/L4 columns
// read as "weird tan skyscrapers"; a smooth heightfield reads as a natural terrain silhouette that
// sits soft in the aerial haze (the CDLOD / fable5-demo answer).
//
// GEOMETRY (continuous surface): a section's 32×32 CELLS become a 33×33 grid of CORNER vertices. Each
// corner height is the AVERAGE of the ≤4 cells that touch it (so adjacent cells share corner vertices →
// one continuous surface, no per-cell steps, and smooth shared normals). far_field triangulates the
// grid (2 tris per cell) into an indexed BufferGeometry and computes smooth vertex normals. A SKIRT
// ring drops the section's border corners down to `min_height` so a 1-level LOD seam between adjacent
// sections never shows a crack (the smooth-mesh replacement for box-column side walls).
//
// COLOR: each corner carries an RGB blended from the map colors (colors.js) of the cells touching it —
// so the surface color interpolates smoothly across the mesh (per-vertex, gouraud). The map color is
// the single source of truth (alpha-weighted mean of the near texture; propagates on any recipe
// retune). Colors are baked into the FarMesh here (CPU) rather than resolved in-shader, because the
// smooth mesh interpolates per-vertex color for free.
//
// SKY LAYER: sky-island cells (Section.sky_*) become a SECOND corner grid at their own heights, meshed
// only over the island footprint (a corner participates iff any touching cell has a sky height) — the
// floating island reads as a smooth slab, not a pillar to the ground.
//
// PURE: a function of the Section only ⇒ deterministic. No three.js, no GPU.

import { CELLS_PER_SECTION } from './section_builder.js'
import { get_map_color } from './colors.js'
import { far_tint_color } from './far_tint.js'
import {
  build_voxel_mesh,
  build_terrace_mesh,
  voxel_mesh_bytes,
  FAR_VOXEL_MAX_LEVEL,
  TERRACE_LAYER_M,
} from './far_voxel_mesher.js'

/** Corner grid edge = cells + 1 (shared corners → continuous surface). */
export const CORNERS_PER_EDGE = CELLS_PER_SECTION + 1
/** Sky-island slab skirt depth (blocks): a floating island's border skirt drops at most this far below
 *  the island, so it reads as a thin slab hanging in the sky — never a tall curtain to a far-below min
 *  (the "gray monolith"). Islands are shallow crusts; ~16 blocks covers the visible edge. */
export const SKY_SLAB_DEPTH = 16

/**
 * @typedef {object} FarLayer one continuous surface layer (ground or sky) as a corner grid.
 * @property {Float32Array} corner_h corner heights, row-major (row·CORNERS_PER_EDGE + col), length
 *   CORNERS_PER_EDGE². World-Y of each corner vertex.
 * @property {Uint8Array} corner_c corner RGB (3 bytes/corner), length CORNERS_PER_EDGE²·3.
 * @property {Float32Array} corner_n smooth per-corner normal (3 floats/corner), from the central
 *   difference of neighbor corner heights — PRECOMPUTED here (in the worker) so far_field skips
 *   computeVertexNormals on the main thread (a per-upload cost avoided during flight).
 * @property {Uint8Array} corner_mask 1 where the corner participates (a touching cell exists), else 0 —
 *   length CORNERS_PER_EDGE². For ground every corner participates; for sky only island corners do, so a
 *   cell is triangulated only when all 4 of its corners participate.
 * @property {number} min_height lowest participating corner height (the skirt floor for this layer).
 */

/**
 * @typedef {object} FarMesh a section's smooth far geometry.
 * @property {'smooth'} kind discriminates from the blocky VoxelMesh (far_voxel_mesher.js).
 * @property {number} level LOD level of the source section
 * @property {number} lod_scale 2-bit scale = log2(cell_meters) = level (kept for the future mega-pool
 *   unification; unused by the dedicated smooth far pipeline)
 * @property {number} origin_x section min-corner world-x (meters)
 * @property {number} origin_z section min-corner world-z (meters)
 * @property {number} block_size cell edge in meters (2^level) — the corner grid spacing
 * @property {FarLayer} ground the continuous ground surface (always present)
 * @property {FarLayer|null} sky the sky-island surface, or null when the section has no sky cells
 */

/** @typedef {import('./section_builder.js').Section} Section */

/**
 * Builds the far mesh for one section, dispatching by LOD level:
 *   • L1/L2 (level ≤ FAR_VOXEL_MAX_LEVEL) → the BLOCKY voxel mesh (far_voxel_mesher.js) — the near/mid
 *     band that gets inspected, hard-stepped block terrain (ENG-21 D206-C: "voxel-look everywhere").
 *   • L3/L4 → the SMOOTH corner-grid mesh below — the hazed horizon (1.4-4 km) where a hard step is
 *     sub-pixel under 55-70 % aerial haze, so the cheap smooth surface reads identically and keeps the
 *     resident-section geometry well under the 64 MB cap (all-levels-voxel would blow it).
 * The two share the FarMesh contract via a `kind` discriminator consumed by far_field / far_mesh_bytes /
 * the far worker's transfer list. Pure + deterministic either way.
 * @param {Section} section
 * @param {number} [voxel_max] blocky-LOD ceiling; sections at level ≤ this mesh blocky, above it
 *   smooth. Defaults to the safe shipped FAR_VOXEL_MAX_LEVEL; the far worker overrides it from the
 *   engine's `?farvoxel=N` boot flag (trailer/close-radius shots at L3 accept the ~98% far-mem cap).
 * @param {number} [terrace_max] TERRACE band ceiling (S-27 round 2): levels in (voxel_max, terrace_max]
 *   mesh as y-quantized greedy-merged contour terraces (`?farterrace=1` ⇒ 3); default 0 ⇒ no terrace
 *   band (byte-identical to today).
 * @param {number} [terrace_layer_m] terrace y-quantization layer height (m); defaults to TERRACE_LAYER_M.
 * @returns {FarMesh | import('./far_voxel_mesher.js').VoxelMesh}
 */
export function build_far_mesh(
  section,
  voxel_max = FAR_VOXEL_MAX_LEVEL,
  terrace_max = 0,
  terrace_layer_m = TERRACE_LAYER_M
) {
  if (section.level <= voxel_max) return build_voxel_mesh(section)
  if (section.level <= terrace_max) return build_terrace_mesh(section, terrace_layer_m)
  const { height, block, level, block_size, origin_x, origin_z } = section
  // [D183 re-application — the terrain and its LOD shell must never read as visibly different materials]
  // The NEAR shell rings (level ≤ 1: 1-2 m cells) carry the per-vertex MACRO TINT (far_tint.js — the
  // same amplitudes/classes as the voxel terrain's shader tint) so sand/grass read as the SAME material
  // family across the seam. Coarse rings keep flat map colour (they live under the distance haze).
  // (First landed by D162-A; erased by D162-B's over-broad revert; re-applied here.)
  const tint = level <= 1 ? { origin_x, origin_z, block_size } : null
  const ground = build_layer(height, block, /* mask */ null, block_size, 0, tint)
  /** @type {FarLayer|null} */
  const sky = null
  // [2026-07-05 THE FINAL GHOST] The far SKY-ISLAND layer is DISABLED for release. Rendered, the coarse island
  // slabs + their border skirts read as huge white hazed voxel-ghost DOMES/ARCS around the camera with
  // vertical curtain streaks (the skirts) — quadtree-following (reads as a box following the camera),
  // async-built (a ~10-second materialization delay), absent at low (no far shell), sun-bright (ndl
  // shading): every descriptor of the observed "white circle static texture" symptom family. D142 fixes the game to a
  // 300×300 ground zone, so far-rendered sky islands are invisible-in-game content — they return
  // post-release only if they can be made beautiful. Near-ring islands still render as REAL voxels.
  // The old mesh path (kept for that return):
  //   sky = build_layer(section.sky_height, section.sky_block, section.sky_height, block_size, SKY_SLAB_DEPTH)

  return {
    kind: 'smooth',
    level,
    lod_scale: level & 0x3,
    origin_x,
    origin_z,
    block_size,
    ground,
    sky,
  }
}

/**
 * Averages the ≤4 cells touching each corner into a corner height + color grid. When `cell_present` is
 * given (sky layer), a cell only contributes where its value is > 0, and a corner participates only if
 * at least one contributing cell touches it.
 * @param {Uint16Array} cell_h per-cell height (length CELLS²)
 * @param {Uint16Array} cell_block per-cell dominant block id (length CELLS²)
 * @param {Uint16Array|null} cell_present optional per-cell presence gate (sky: same as cell_h); null ⇒
 *   every cell contributes (ground)
 * @param {number} block_size cell edge in meters (horizontal spacing, for the normal central difference)
 * @param {number} slab_depth if > 0, clamp the skirt-floor (min_height) to `max_height − slab_depth` so
 *   the border skirt is a THIN slab (the sky layer — a floating island is a shallow crust, not a
 *   ground-anchored column); 0 ⇒ min_height is the true lowest corner (the ground layer).
 * @returns {FarLayer}
 */
function build_layer(
  cell_h,
  cell_block,
  cell_present,
  block_size,
  slab_depth,
  /** @type {{origin_x:number,origin_z:number,block_size:number}|null} */ tint = null
) {
  const N = CELLS_PER_SECTION
  const C = CORNERS_PER_EDGE
  const corner_h = new Float32Array(C * C)
  const corner_c = new Uint8Array(C * C * 3)
  const corner_n = new Float32Array(C * C * 3)
  const corner_mask = new Uint8Array(C * C)
  // Accumulators per corner: summed height, summed color, count of contributing cells.
  const sum_h = new Float32Array(C * C)
  const sum_r = new Float32Array(C * C)
  const sum_g = new Float32Array(C * C)
  const sum_b = new Float32Array(C * C)
  const count = new Int32Array(C * C)

  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const ci = cz * N + cx
      if (cell_present && cell_present[ci] === 0) continue
      const h = cell_h[ci]
      const [r, g, b] = get_map_color(cell_block[ci])
      // This cell touches its 4 corners: (cx,cz), (cx+1,cz), (cx,cz+1), (cx+1,cz+1).
      for (let dz = 0; dz <= 1; dz += 1) {
        for (let dx = 0; dx <= 1; dx += 1) {
          const k = (cz + dz) * C + (cx + dx)
          sum_h[k] += h
          sum_r[k] += r
          sum_g[k] += g
          sum_b[k] += b
          count[k] += 1
        }
      }
    }
  }

  let min_height = Infinity
  let max_height = -Infinity
  for (let k = 0; k < C * C; k += 1) {
    const n = count[k]
    if (n === 0) continue
    corner_mask[k] = 1
    const hh = sum_h[k] / n
    // [D206-B — target: a fake voxel appearance that reads as real blocks] NEAR shell rings quantize corner heights to WHOLE BLOCKS — the sheet terraces into
    // 1 m steps that read as voxels; far rings (tint === null ⇒ level ≥ 2) keep smooth heights for
    // clean mountain silhouettes under the haze.
    corner_h[k] = tint ? Math.round(hh) : hh
    let cr = sum_r[k] / n
    let cg = sum_g[k] / n
    let cb = sum_b[k] / n
    if (tint) {
      // corner world XZ from the grid index; dominant block of the nearest cell for the tint class.
      const rx0 = k % C
      const rz0 = (k / C) | 0
      const wx = tint.origin_x + rx0 * tint.block_size
      const wz = tint.origin_z + rz0 * tint.block_size
      const cx = Math.min(N - 1, rx0)
      const cz = Math.min(N - 1, rz0)
      ;[cr, cg, cb] = far_tint_color(cell_block[cz * N + cx], wx, wz, [cr, cg, cb])
    }
    corner_c[k * 3] = Math.round(cr)
    corner_c[k * 3 + 1] = Math.round(cg)
    corner_c[k * 3 + 2] = Math.round(cb)
    if (hh < min_height) min_height = hh
    if (hh > max_height) max_height = hh
  }
  if (min_height === Infinity) min_height = 0
  // Thin-slab clamp (sky layer): keep the skirt a shallow crust below the island, not a tall curtain.
  if (slab_depth > 0 && max_height - min_height > slab_depth) min_height = max_height - slab_depth

  // Smooth per-corner normals from the central difference of neighbor corner heights (clamped at
  // edges). n = normalize(−dh/dx, 1, −dh/dz) with world spacing `block_size`. Cheap (one pass), and it
  // moves the normal work off the render thread (far_field skips computeVertexNormals).
  for (let rz = 0; rz < C; rz += 1) {
    for (let rx = 0; rx < C; rx += 1) {
      const k = rz * C + rx
      if (!corner_mask[k]) continue
      const hl = corner_h[participating(corner_mask, rx - 1, rz) ? rz * C + (rx - 1) : k]
      const hr = corner_h[participating(corner_mask, rx + 1, rz) ? rz * C + (rx + 1) : k]
      const hd = corner_h[participating(corner_mask, rx, rz - 1) ? (rz - 1) * C + rx : k]
      const hu = corner_h[participating(corner_mask, rx, rz + 1) ? (rz + 1) * C + rx : k]
      const nx = hl - hr
      const nz = hd - hu
      const ny = 2 * block_size
      const inv = 1 / Math.hypot(nx, ny, nz)
      corner_n[k * 3] = nx * inv
      corner_n[k * 3 + 1] = ny * inv
      corner_n[k * 3 + 2] = nz * inv
    }
  }

  return { corner_h, corner_c, corner_n, corner_mask, min_height }
}

/** Whether corner (rx,rz) is in-grid and participating. @param {Uint8Array} mask @param {number} rx
 *  @param {number} rz @returns {boolean} */
function participating(mask, rx, rz) {
  const C = CORNERS_PER_EDGE
  if (rx < 0 || rz < 0 || rx >= C || rz >= C) return false
  return mask[rz * C + rx] === 1
}

/** Resident bytes of a built far mesh — for the perf report. Handles both the smooth corner-grid mesh
 *  and the blocky VoxelMesh (dispatched by `kind`).
 *  @param {FarMesh | import('./far_voxel_mesher.js').VoxelMesh} m */
export function far_mesh_bytes(m) {
  if (m.kind === 'voxel') return voxel_mesh_bytes(m)
  const layer_bytes = (/** @type {FarLayer} */ l) =>
    l.corner_h.byteLength + l.corner_c.byteLength + l.corner_n.byteLength + l.corner_mask.byteLength
  return layer_bytes(m.ground) + (m.sky ? layer_bytes(m.sky) : 0)
}
