// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Far-section VOXEL mesher (ENG-21 D206-C — the LOD read as ugly and undetailed even at close range;
// target: a voxel look EVERYWHERE). Turns one downsampled Section (section_builder.js) into a BLOCKY,
// hard-stepped terrain surface — the antidote to the smooth-heightfield "melted sheet" (far_mesher.js's
// corner-average path) that was rejected. Each CELL is a flat-topped plateau at its own integer height
// with VERTICAL RISER walls to lower neighbours (Minecraft-style heightmap mesh), so cliffs read as
// stepped block walls and hills terrace instead of dissolving. The horizontal cell grid IS the "block
// grid" (the target): 2 m at L1, 4 m at L2 (blocks growing with distance via the quadtree level),
// meeting the real near-ring voxels at a calm seam (matched integer heights + the SAME bake palette).
//
// WHY ONLY THE NEAR/MID BAND (L1/L2): a section is always 32×32 cells (~8 k blocky verts), and the far
// shell keeps ~hundreds of sections resident — all-levels-voxel would blow the 64 MB geometry cap. So
// this path meshes the levels the eye can INSPECT (L1 ≈ 224-350 m, L2 ≈ 350-700 m); the coarse L3/L4
// horizon (1.4-4 km) sits under 55-70 % aerial haze + desaturation (far_field), where a hard block
// step is sub-pixel and invisible, and stays on the cheap smooth path (far_mesher.build_far_mesh).
//
// SHADING (reuses far_field's material UNCHANGED): the blocky mesh carries FLAT per-face normals — top
// faces (0,1,0), riser/skirt faces horizontal — so the material's own sun-diffuse (ndl = max(0, n·sun))
// paints tops bright and walls dark for free, the fake-AO voxel read consistent with the near ring. No
// material change; only the geometry differs from the smooth path.
//
// COLOR: per-CELL FLAT colour (never the smooth path's 4-cell corner average → the muddy blur that was
// seen), from the SAME map-colour bake (colors.js SSOT) + the macro tint (far_tint.js) on these near
// levels so the palette matches the near voxel terrain across the seam, plus a subtle per-cell brightness
// jitter (stable world-cell hash) so a large same-block field doesn't pool into one flat sheet.
//
// PURE + deterministic (a function of the Section only): no three.js, no GPU — safe in the far worker.
// Emits FINAL geometry arrays (positions/normals/colors/indices) so the main thread only wraps them into
// a BufferGeometry (far_field), keeping the per-upload render-thread cost minimal.

import { CELLS_PER_SECTION } from './section_builder.js'
import { get_map_color } from './colors.js'
import { far_tint_color } from './far_tint.js'

const N = CELLS_PER_SECTION // 32 cells per section edge

/** DEFAULT far-LOD blocky ceiling — sections at level ≤ this mesh as REAL blocky voxels (build_voxel_mesh
 *  below); coarser sections stay on the cheap smooth heightfield. [S-27 pivot, 2026-07-08 — small
 *  voxels become bigger voxels, 1×1 becomes 2×2 then 4×4, and only then a flat vertices plane, always
 *  reading as a visible heightmap: Distant-Horizons PROGRESSIVE VOXEL DOUBLING.] The near ring is
 *  real 1 m voxels (1×1); the far shell continues the doubling with REAL hard-stepped cubes L1 (2 m = 2×2)
 *  and L2 (4 m = 4×4), then the coarse L3/L4 horizon (≥ 512 m, under aerial haze) becomes the smooth "flat
 *  vertices plane" the design names. This REPLACES the old all-smooth + shader-illusion path
 *  (FAR_VOXEL_MAX_LEVEL=0 + camera-distance vertex Y-quantize) whose radial terracing was the source of the
 *  moving concentric dark rings (S-27 D1). Ceiling is 2 (not 3): real voxels are ~8× the smooth verts, and
 *  ?farvoxel warns that L3-blocky reaches ~98 % of the 64 MB far cap — L1/L2-blocky keeps a safe margin
 *  while covering the whole near/mid band the eye actually inspects. Overridable per-boot via `?farvoxel=N`. */
export const FAR_VOXEL_MAX_LEVEL = 2

/** TERRACE layer height (m) — the y-quantization step of the terrace far band [S-27 round 2 —
 *  layered planes give the impression of a voxel look; some distance blocks read as too big].
 *  2 m ≈ two near-ring voxels per silhouette step: fine horizontal strata, never mega-cubes.
 *  Overridable per-boot via `?terracem=N` (engine.js). */
export const TERRACE_LAYER_M = 2

/** Per-cell brightness jitter amplitude (±fraction) — breaks large same-block areas out of one flat
 *  sheet (design req 3c) without reading as noise. Stable per world-cell so it never shimmers. */
const CELL_JITTER = 0.06

/** Deterministic uint32 hash of two ints (FNV-1a + avalanche) — mirrors far_tint.hash32's structure so
 *  the jitter is engine-stable and world-continuous across section borders. @param {number} a @param {number} b */
function hash2(a, b) {
  let h = 0x811c9dc5
  for (const v of [a, b]) {
    h = (h ^ (v | 0)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
    h = (h ^ (h >>> 15)) >>> 0
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h = (h ^ (h >>> 13)) >>> 0
  }
  return h >>> 0
}

/** @typedef {import('./section_builder.js').Section} Section */

/**
 * @typedef {object} VoxelMesh a section's blocky far geometry — FINAL arrays ready for a BufferGeometry.
 * @property {'voxel'} kind discriminates from the smooth FarMesh in far_field / far_mesh_bytes / worker.
 * @property {boolean} [terraced] TERRACE-mesher provenance (S-27 round 2)
 * @property {number} level LOD level of the source section (1 or 2)
 * @property {number} lod_scale 2-bit scale = level & 3 (parity with the smooth mesh / future mega-pool)
 * @property {number} origin_x section min-corner world-x (meters) — for the depth-bias / mask math
 * @property {number} origin_z section min-corner world-z (meters)
 * @property {number} block_size cell edge in meters (2^level)
 * @property {number} min_height lowest cell height (the skirt floor)
 * @property {Float32Array} positions world-space xyz per vertex
 * @property {Int8Array} normals snorm8 xyz per vertex (axis-aligned → exact) — flat per-face
 * @property {Uint8Array} colors unorm8 rgb per vertex (0-255)
 * @property {Uint32Array} indices triangle indices
 */

/**
 * Builds the blocky far mesh (flat tops + vertical risers + border skirt) for one section. Pure.
 * @param {Section} section
 * @returns {VoxelMesh}
 */
export function build_voxel_mesh(section) {
  const { height, block, level, block_size, origin_x, origin_z, sx, sz } = section

  // Growable scratch (final typed arrays built once at the end — avoids per-push typed-array churn).
  /** @type {number[]} */ const positions = []
  /** @type {number[]} */ const normals = []
  /** @type {number[]} */ const colors = []
  /** @type {number[]} */ const indices = []

  let min_height = 0xffff
  for (let i = 0; i < N * N; i += 1) if (height[i] < min_height) min_height = height[i]
  if (min_height === 0xffff) min_height = 0

  // Per-cell flat colour: bake map colour → macro tint (palette-match the near ring at the seam) →
  // subtle per-cell brightness jitter. Cached per section-cell (each cell colour is read by its top +
  // up to 2 risers + a possible skirt, so compute once). Colours are 0-255 bytes.
  const cell_r = new Uint8Array(N * N)
  const cell_g = new Uint8Array(N * N)
  const cell_b = new Uint8Array(N * N)
  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const ci = cz * N + cx
      const base = get_map_color(block[ci])
      let [r, g, b] = base
      // World XZ of the cell centre — the macro tint + jitter key on world coords so both are continuous
      // across section borders (no per-section seam in the tint or the jitter pattern).
      const wx = origin_x + (cx + 0.5) * block_size
      const wz = origin_z + (cz + 0.5) * block_size
      const tinted = far_tint_color(block[ci], wx, wz, [r, g, b])
      ;[r, g, b] = tinted
      // Per world-cell brightness jitter in [1-J, 1+J]. Global cell coords ⇒ seamless across sections.
      const j01 = hash2(sx * N + cx, sz * N + cz) / 4294967296
      const jf = 1 + (j01 - 0.5) * 2 * CELL_JITTER
      cell_r[ci] = clamp255(r * jf)
      cell_g[ci] = clamp255(g * jf)
      cell_b[ci] = clamp255(b * jf)
    }
  }

  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const ci = cz * N + cx
      const h = height[ci]
      const r = cell_r[ci]
      const g = cell_g[ci]
      const b = cell_b[ci]
      const x0 = origin_x + cx * block_size
      const x1 = x0 + block_size
      const z0 = origin_z + cz * block_size
      const z1 = z0 + block_size

      // TOP quad — flat plateau at the cell's own integer height, up-normal (bright under the sun).
      push_quad(
        positions,
        normals,
        colors,
        indices,
        [x0, h, z0],
        [x0, h, z1],
        [x1, h, z1],
        [x1, h, z0],
        0,
        1,
        0,
        r,
        g,
        b
      )

      // INTERNAL RISER to the +x neighbour (each internal vertical face emitted once, from this cell).
      if (cx < N - 1) {
        const hb = height[ci + 1]
        if (hb !== h)
          emit_riser_x(positions, normals, colors, indices, x1, z0, z1, h, hb, ci, ci + 1, cell_r, cell_g, cell_b)
      }
      // INTERNAL RISER to the +z neighbour.
      if (cz < N - 1) {
        const hb = height[ci + N]
        if (hb !== h)
          emit_riser_z(positions, normals, colors, indices, z1, x0, x1, h, hb, ci, ci + N, cell_r, cell_g, cell_b)
      }

      // BORDER SKIRT — drop the section's outer edges to min_height so a 1-level LOD seam with the
      // (coarser) neighbour section never shows a crack. Outward-facing walls; the section-min floor
      // guarantees coverage regardless of the neighbour's height. (Same role as the smooth path's skirt.)
      if (h > min_height) {
        if (cx === 0) push_wall_x(positions, normals, colors, indices, x0, z0, z1, min_height, h, -1, r, g, b)
        if (cx === N - 1) push_wall_x(positions, normals, colors, indices, x1, z0, z1, min_height, h, 1, r, g, b)
        if (cz === 0) push_wall_z(positions, normals, colors, indices, z0, x0, x1, min_height, h, -1, r, g, b)
        if (cz === N - 1) push_wall_z(positions, normals, colors, indices, z1, x0, x1, min_height, h, 1, r, g, b)
      }
    }
  }

  return {
    kind: 'voxel',
    level,
    lod_scale: level & 0x3,
    origin_x,
    origin_z,
    block_size,
    min_height,
    positions: new Float32Array(positions),
    normals: to_snorm8(normals),
    colors: Uint8Array.from(colors),
    indices: Uint32Array.from(indices),
  }
}

/** Resident bytes of a VoxelMesh (the geometry arrays) — for the perf report. @param {VoxelMesh} m */
export function voxel_mesh_bytes(m) {
  return m.positions.byteLength + m.normals.byteLength + m.colors.byteLength + m.indices.byteLength
}

/**
 * Builds the TERRACE far mesh for one section [S-27 round 2 — layered planes give the impression of a
 * voxel look; some distance blocks read as too big]. The y-quantization is the load-bearing
 * voxel impression; the XZ mega-cells were variant A's defect. So: cell heights SNAP to whole
 * `layer_m` layers (flat tops + vertical risers — the contour-terrace silhouette), then equal-height
 * runs GREEDY-MERGE in XZ into large planes: maximal rectangles for the tops, maximal runs for the
 * riser walls and border skirt. Fine 2 m silhouette steps, no 8 m cubes — and FAR FEWER quads than
 * per-cell meshing (flat/gentle terrain collapses to a handful of rectangles; the flag capture
 * measures it). Quantization keys on ABSOLUTE world height, so contour bands continue seamlessly
 * across section borders. Colour: FLAT map colour per face (same policy as the smooth L3/L4 this
 * replaces — no CPU tint/jitter at these hazed distances; merging erases per-cell identity and the
 * material's 10 m FAR_GRAIN mottles large sheets). Sky cells ignored (far sky layer is disabled —
 * far_mesher.js). Same VoxelMesh contract (kind 'voxel', + `terraced: true` provenance marker) so
 * far_geometry / far_field / the worker transfer list consume it unchanged. Pure + deterministic.
 * @param {Section} section
 * @param {number} [layer_m] y-quantization step in meters (default TERRACE_LAYER_M)
 * @returns {VoxelMesh}
 */
export function build_terrace_mesh(section, layer_m = TERRACE_LAYER_M) {
  const { height, block, level, block_size, origin_x, origin_z } = section

  /** @type {number[]} */ const positions = []
  /** @type {number[]} */ const normals = []
  /** @type {number[]} */ const colors = []
  /** @type {number[]} */ const indices = []

  // Quantize to whole terrace layers (nearest — keeps the mean surface level; world-anchored).
  const hq = new Int32Array(N * N)
  let min_height = Infinity
  for (let i = 0; i < N * N; i += 1) {
    hq[i] = Math.round(height[i] / layer_m) * layer_m
    if (hq[i] < min_height) min_height = hq[i]
  }
  if (!Number.isFinite(min_height)) min_height = 0

  // ── TOPS — greedy maximal rectangles of equal (quantized height, block id) ──────────────────────
  // Row-scan greedy: grow a run along +x, then grow whole matching rows along +z. Deterministic.
  const visited = new Uint8Array(N * N)
  const key = (/** @type {number} */ i) => hq[i] * 65536 + block[i] // block ids are Uint16
  const row_matches = (/** @type {number} */ row0, /** @type {number} */ w, /** @type {number} */ k) => {
    for (let i = 0; i < w; i += 1) if (visited[row0 + i] || key(row0 + i) !== k) return false
    return true
  }
  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const ci = cz * N + cx
      if (visited[ci]) continue
      const k = key(ci)
      let w = 1
      while (cx + w < N && !visited[ci + w] && key(ci + w) === k) w += 1
      let d = 1
      while (cz + d < N && row_matches((cz + d) * N + cx, w, k)) d += 1
      for (let z = 0; z < d; z += 1) visited.fill(1, (cz + z) * N + cx, (cz + z) * N + cx + w)
      const [r, g, b] = get_map_color(block[ci])
      const x0 = origin_x + cx * block_size
      const x1 = x0 + w * block_size
      const z0 = origin_z + cz * block_size
      const z1 = z0 + d * block_size
      const h = hq[ci]
      push_quad(
        positions,
        normals,
        colors,
        indices,
        [x0, h, z0],
        [x0, h, z1],
        [x1, h, z1],
        [x1, h, z0],
        0,
        1,
        0,
        r,
        g,
        b
      )
    }
  }

  // ── RISERS — one merged wall per maximal equal run along each internal grid line ─────────────────
  // +x faces (wall on the x = origin_x + (cx+1)·bs plane), runs merged along z. The run key packs
  // (lo, hi, src block, normal sign); key equality across consecutive slots ⇒ one wall quad. hi > lo
  // for any face ⇒ the packed key is never 0 (0 = "no face" sentinel in merge_runs).
  for (let cx = 0; cx < N - 1; cx += 1) {
    const face_key = (/** @type {number} */ cz) => {
      const a = cz * N + cx
      const b = a + 1
      if (hq[a] === hq[b]) return 0
      const lo = hq[a] < hq[b] ? hq[a] : hq[b]
      const hi = hq[a] < hq[b] ? hq[b] : hq[a]
      const src = hq[a] > hq[b] ? block[a] : block[b] // higher cell owns the face colour
      return ((lo * 2048 + hi) * 65536 + src) * 2 + (hq[a] > hq[b] ? 1 : 0)
    }
    merge_runs(N, face_key, (start, len) => {
      const a = start * N + cx
      const b = a + 1
      const lo = hq[a] < hq[b] ? hq[a] : hq[b]
      const hi = hq[a] < hq[b] ? hq[b] : hq[a]
      const src = hq[a] > hq[b] ? a : b
      const dir = hq[a] > hq[b] ? 1 : -1 // outward from the higher cell toward the lower
      const [r, g, bl] = get_map_color(block[src])
      const x = origin_x + (cx + 1) * block_size
      const z0 = origin_z + start * block_size
      const z1 = z0 + len * block_size
      push_quad(
        positions,
        normals,
        colors,
        indices,
        [x, lo, z0],
        [x, hi, z0],
        [x, hi, z1],
        [x, lo, z1],
        dir,
        0,
        0,
        r,
        g,
        bl
      )
    })
  }
  // +z faces (wall on the z = origin_z + (cz+1)·bs plane), runs merged along x.
  for (let cz = 0; cz < N - 1; cz += 1) {
    const face_key = (/** @type {number} */ cx) => {
      const a = cz * N + cx
      const b = a + N
      if (hq[a] === hq[b]) return 0
      const lo = hq[a] < hq[b] ? hq[a] : hq[b]
      const hi = hq[a] < hq[b] ? hq[b] : hq[a]
      const src = hq[a] > hq[b] ? block[a] : block[b]
      return ((lo * 2048 + hi) * 65536 + src) * 2 + (hq[a] > hq[b] ? 1 : 0)
    }
    merge_runs(N, face_key, (start, len) => {
      const a = cz * N + start
      const b = a + N
      const lo = hq[a] < hq[b] ? hq[a] : hq[b]
      const hi = hq[a] < hq[b] ? hq[b] : hq[a]
      const src = hq[a] > hq[b] ? a : b
      const dir = hq[a] > hq[b] ? 1 : -1
      const [r, g, bl] = get_map_color(block[src])
      const z = origin_z + (cz + 1) * block_size
      const x0 = origin_x + start * block_size
      const x1 = x0 + len * block_size
      push_quad(
        positions,
        normals,
        colors,
        indices,
        [x0, lo, z],
        [x0, hi, z],
        [x1, hi, z],
        [x1, lo, z],
        0,
        0,
        dir,
        r,
        g,
        bl
      )
    })
  }

  // ── BORDER SKIRT — merged runs of the outer-edge walls down to the section's quantized min (crack
  // cover at LOD seams, exactly the per-cell voxel path's skirt but one quad per equal run). ─────────
  const skirt_key = (/** @type {number} */ ci) => (hq[ci] > min_height ? (hq[ci] * 65536 + block[ci]) * 2 + 1 : 0)
  const skirt = (
    /** @type {(cz:number)=>number} */ slot_ci,
    /** @type {'x'|'z'} */ axis,
    /** @type {number} */ plane,
    /** @type {number} */ dir
  ) => {
    merge_runs(
      N,
      (/** @type {number} */ s) => skirt_key(slot_ci(s)),
      (start, len) => {
        const ci = slot_ci(start)
        const [r, g, b] = get_map_color(block[ci])
        const a0 = (axis === 'x' ? origin_z : origin_x) + start * block_size
        const a1 = a0 + len * block_size
        if (axis === 'x')
          push_wall_x(positions, normals, colors, indices, plane, a0, a1, min_height, hq[ci], dir, r, g, b)
        else push_wall_z(positions, normals, colors, indices, plane, a0, a1, min_height, hq[ci], dir, r, g, b)
      }
    )
  }
  skirt((cz) => cz * N, 'x', origin_x, -1) // west edge (cx = 0)
  skirt((cz) => cz * N + (N - 1), 'x', origin_x + N * block_size, 1) // east edge
  skirt((cx) => cx, 'z', origin_z, -1) // north edge (cz = 0)
  skirt((cx) => (N - 1) * N + cx, 'z', origin_z + N * block_size, 1) // south edge

  return {
    kind: 'voxel',
    terraced: true, // provenance marker (tests/debug) — inert downstream, VoxelMesh contract otherwise identical
    level,
    lod_scale: level & 0x3,
    origin_x,
    origin_z,
    block_size,
    min_height,
    positions: new Float32Array(positions),
    normals: to_snorm8(normals),
    colors: Uint8Array.from(colors),
    indices: Uint32Array.from(indices),
  }
}

/**
 * Emits one call per MAXIMAL run of equal non-zero keys: scans slots i ∈ [0, n) via `key_fn` (0 ⇒ no
 * face at this slot) and calls `emit(start, len)` for each merged run. The XZ-merge workhorse shared by
 * the terrace risers + skirts. @param {number} n @param {(i:number)=>number} key_fn
 * @param {(start:number, len:number)=>void} emit
 */
function merge_runs(n, key_fn, emit) {
  let start = -1
  let cur = 0
  for (let i = 0; i <= n; i += 1) {
    const k = i < n ? key_fn(i) : 0
    if (k === cur) continue
    if (cur !== 0) emit(start, i - start)
    start = i
    cur = k
  }
}

// ---- geometry helpers -----------------------------------------------------------------------------

/** @param {number} v @returns {number} 0-255 rounded byte */
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/** number[] normals (−1..1) → Int8Array snorm8 (×127; axis-aligned components are exact). @param {number[]} arr */
function to_snorm8(arr) {
  const out = new Int8Array(arr.length)
  for (let i = 0; i < arr.length; i += 1) out[i] = Math.round(arr[i] * 127)
  return out
}

/**
 * Pushes one quad (4 corners a→b→c→d, 2 tris) with a single flat normal + flat colour. Winding is a
 * fixed a-b-c / a-c-d fan; the far material renders DoubleSide and shades from the baked normal, so the
 * winding never gates visibility or lighting.
 * @param {number[]} P @param {number[]} Nn @param {number[]} Co @param {number[]} I
 * @param {number[]} a @param {number[]} b @param {number[]} c @param {number[]} d each [x,y,z]
 * @param {number} nx @param {number} ny @param {number} nz @param {number} r @param {number} g @param {number} bl
 */
function push_quad(P, Nn, Co, I, a, b, c, d, nx, ny, nz, r, g, bl) {
  const base = P.length / 3
  for (const p of [a, b, c, d]) {
    P.push(p[0], p[1], p[2])
    Nn.push(nx, ny, nz)
    Co.push(r, g, bl)
  }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/**
 * Emits the vertical riser between a cell and its +x neighbour: a wall on the x=x1 plane spanning
 * z∈[z0,z1] and y∈[min(h,hb),max(h,hb)], coloured by the HIGHER cell (the exposed cliff face is the
 * taller block's side) and normalled OUTWARD from that cliff (toward the lower cell) so the sun-diffuse
 * shades a sun-facing step lit and a sun-away step in shade.
 * @param {number[]} P @param {number[]} Nn @param {number[]} Co @param {number[]} I
 * @param {number} x1 @param {number} z0 @param {number} z1 @param {number} h @param {number} hb
 * @param {number} ci @param {number} cin @param {Uint8Array} cr @param {Uint8Array} cg @param {Uint8Array} cb
 */
function emit_riser_x(P, Nn, Co, I, x1, z0, z1, h, hb, ci, cin, cr, cg, cb) {
  const ylo = h < hb ? h : hb
  const yhi = h < hb ? hb : h
  const src = h > hb ? ci : cin // the higher cell owns the face colour
  const nx = h > hb ? 1 : -1 // outward from the higher cell toward the lower
  push_quad(
    P,
    Nn,
    Co,
    I,
    [x1, ylo, z0],
    [x1, yhi, z0],
    [x1, yhi, z1],
    [x1, ylo, z1],
    nx,
    0,
    0,
    cr[src],
    cg[src],
    cb[src]
  )
}

/** Vertical riser between a cell and its +z neighbour (wall on the z=z1 plane). See emit_riser_x.
 * @param {number[]} P @param {number[]} Nn @param {number[]} Co @param {number[]} I
 * @param {number} z1 @param {number} x0 @param {number} x1 @param {number} h @param {number} hb
 * @param {number} ci @param {number} cin @param {Uint8Array} cr @param {Uint8Array} cg @param {Uint8Array} cb */
function emit_riser_z(P, Nn, Co, I, z1, x0, x1, h, hb, ci, cin, cr, cg, cb) {
  const ylo = h < hb ? h : hb
  const yhi = h < hb ? hb : h
  const src = h > hb ? ci : cin
  const nz = h > hb ? 1 : -1
  push_quad(
    P,
    Nn,
    Co,
    I,
    [x0, ylo, z1],
    [x0, yhi, z1],
    [x1, yhi, z1],
    [x1, ylo, z1],
    0,
    0,
    nz,
    cr[src],
    cg[src],
    cb[src]
  )
}

/** Border skirt wall on an x-plane (dir = −1 left edge, +1 right edge), from floor up to h.
 * @param {number[]} P @param {number[]} Nn @param {number[]} Co @param {number[]} I @param {number} x
 * @param {number} z0 @param {number} z1 @param {number} floor @param {number} h @param {number} dir
 * @param {number} r @param {number} g @param {number} b */
function push_wall_x(P, Nn, Co, I, x, z0, z1, floor, h, dir, r, g, b) {
  push_quad(P, Nn, Co, I, [x, floor, z0], [x, h, z0], [x, h, z1], [x, floor, z1], dir, 0, 0, r, g, b)
}

/** Border skirt wall on a z-plane (dir = −1 top edge, +1 bottom edge), from floor up to h.
 * @param {number[]} P @param {number[]} Nn @param {number[]} Co @param {number[]} I @param {number} z
 * @param {number} x0 @param {number} x1 @param {number} floor @param {number} h @param {number} dir
 * @param {number} r @param {number} g @param {number} b */
function push_wall_z(P, Nn, Co, I, z, x0, x1, floor, h, dir, r, g, b) {
  push_quad(P, Nn, Co, I, [x0, floor, z], [x0, h, z], [x1, h, z], [x1, floor, z], 0, 0, dir, r, g, b)
}
