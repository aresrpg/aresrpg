// Far-shell CPU geometry builders (§11 NG-LOD) — the PURE main-thread expansion of a built far mesh into
// an indexed three BufferGeometry, split out of far_field.js so the renderer handle keeps only scene/
// material/mask duties (≤600-LoC law). Two mesh kinds:
//   • 'voxel' (ENG-21 L1/L2 blocky) — the far worker already built the FINAL geometry arrays
//     (far_voxel_mesher.js), so this only WRAPS them into BufferAttributes + bakes the per-vertex spawn.
//   • 'smooth' (L3/L4 corner grid) — expands the 33×33 corner grids (ground + optional sky) into an
//     indexed surface + a border skirt (crack cover for a 1-level LOD seam), as the far shell always did.
// Both carry the per-vertex `spawn_seconds` attribute driving far_field's fade dither; no three-render
// state here (no GPU) — a plain geometry factory the far_field handle + its unit tests both call.

import { BufferAttribute, BufferGeometry } from 'three'

import { CORNERS_PER_EDGE } from '../lod/far_mesher.js'
import { CELLS_PER_SECTION } from '../lod/section_builder.js'
import { SEA_LEVEL } from '../config/world_config.js'

/** [ENG-21 LOD-TRIM #2, design ruling 2026-07-07: no big holes between layer levels] Absolute world-Y the GROUND
 *  skirt drops to. The old skirt floored at each section's OWN min_height, so a section sitting on a high
 *  massif shoulder next to a deep valley/ocean section left an UNSEALED CLIFF to the sky at the LOD seam
 *  (the reported "big holes between layer levels"). Dropping every ground skirt to one absolute floor BELOW
 *  every shown far surface guarantees the taller section's curtain always reaches under its lower
 *  neighbour → the seam is sealed as a cliff face, never a hole. Below SEA_LEVEL by a wide margin so even
 *  exposed dry basins are covered; the curtain is border-ring only (no extra vertices, just taller) and is
 *  occluded by the lower surface in front of it (or hazed to sky at the shell's outer edge). */
export const FAR_SKIRT_FLOOR_Y = SEA_LEVEL - 112

/** [D221-FAR pre-warm] One degenerate zero-area triangle per far-section VERTEX LAYOUT — 'smooth'
 *  (all float32) and 'voxel' (snorm8 normals / unorm8 colors, far_voxel_mesher.js). WebGPU render
 *  pipelines key on the vertex layout, so a warm-up with the wrong layout compiles a pipeline no real
 *  section ever reuses; these match the two builders below exactly. Zero-area ⇒ compiles the exact
 *  pipelines without drawing a pixel.
 *  @returns {BufferGeometry[]} */
export function build_warm_geometries() {
  const smooth = new BufferGeometry()
  smooth.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  smooth.setAttribute('color', new BufferAttribute(new Float32Array(9), 3))
  smooth.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  smooth.setAttribute('spawn_seconds', new BufferAttribute(new Float32Array(3), 1))
  smooth.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  const voxel = new BufferGeometry()
  voxel.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  voxel.setAttribute('normal', new BufferAttribute(new Int8Array(9), 3, /* normalized */ true))
  voxel.setAttribute('color', new BufferAttribute(new Uint8Array(9), 3, /* normalized */ true))
  voxel.setAttribute('spawn_seconds', new BufferAttribute(new Float32Array(3), 1))
  voxel.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  return [smooth, voxel]
}

/** @typedef {import('../lod/far_mesher.js').FarMesh} FarMesh */
/** @typedef {import('../lod/far_mesher.js').FarLayer} FarLayer */

/**
 * Builds one section's indexed BufferGeometry, dispatching by mesh kind:
 *   • 'voxel' (ENG-21 L1/L2 blocky) — the far worker already built the FINAL geometry arrays
 *     (positions/normals/colors/indices), so the main thread only WRAPS them into BufferAttributes +
 *     bakes the per-vertex spawn time. Normals are snorm8 (axis-aligned, exact) and colors unorm8 —
 *     normalized byte attributes three auto-pads to snorm8x4/unorm8x4, a big geometry-memory saving. The
 *     shared far material reads them via `attribute('normal'|'color','vec3')` unchanged.
 *   • 'smooth' (L3/L4 corner grid) — expanded here from the corner grids (ground + optional sky) with a
 *     border skirt, as before.
 * Returns null when nothing participates.
 * @param {FarMesh | import('../lod/far_voxel_mesher.js').VoxelMesh} mesh
 * @param {number} spawn_seconds the fade clock value at upload (baked per vertex)
 * @returns {{ geometry: BufferGeometry, bytes: number } | null}
 */
export function build_section_geometry(mesh, spawn_seconds) {
  if (mesh.kind === 'voxel') return build_voxel_geometry(mesh, spawn_seconds)
  /** @type {number[]} */
  const positions = []
  /** @type {number[]} */
  const colors = []
  /** @type {number[]} */
  const normals = []
  /** @type {number[]} */
  const indices = []

  // GROUND skirt drops to the ABSOLUTE floor (sealed inter-level seams — see FAR_SKIRT_FLOOR_Y); a section
  // already below it keeps its own (lower) min. SKY skirt keeps the layer's slab min_height (a thin crust,
  // never a curtain to the ground — the "gray monolith" the sky-slab clamp exists to prevent).
  const ground_floor = Math.min(mesh.ground.min_height, FAR_SKIRT_FLOOR_Y)
  append_layer(
    mesh.ground,
    mesh.origin_x,
    mesh.origin_z,
    mesh.block_size,
    ground_floor,
    positions,
    colors,
    normals,
    indices
  )
  if (mesh.sky) {
    append_layer(
      mesh.sky,
      mesh.origin_x,
      mesh.origin_z,
      mesh.block_size,
      mesh.sky.min_height,
      positions,
      colors,
      normals,
      indices
    )
  }
  if (indices.length === 0) return null

  const pos = new Float32Array(positions)
  const col = new Float32Array(colors)
  const nrm = new Float32Array(normals)
  const idx = new Uint32Array(indices)
  const spawn = new Float32Array(pos.length / 3).fill(spawn_seconds)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(pos, 3))
  geometry.setAttribute('color', new BufferAttribute(col, 3))
  geometry.setAttribute('normal', new BufferAttribute(nrm, 3)) // SMOOTH normals precomputed in far_mesher
  geometry.setAttribute('spawn_seconds', new BufferAttribute(spawn, 1))
  geometry.setIndex(new BufferAttribute(idx, 1))

  const bytes = pos.byteLength + col.byteLength + nrm.byteLength + spawn.byteLength + idx.byteLength
  return { geometry, bytes }
}

/**
 * Wraps a pre-built blocky VoxelMesh (worker-built FINAL arrays) into a BufferGeometry: the position/
 * normal/color/index buffers are used directly (the heavy meshing already ran off-thread), and only the
 * per-vertex `spawn_seconds` fade attribute is allocated here. Normals (snorm8) + colors (unorm8) are
 * flagged `normalized` so three reads them as unit floats (auto-padded to the snorm8x4/unorm8x4 WebGPU
 * formats). Returns null when the section produced no triangles (a fully-flat below-sea void, say).
 * @param {import('../lod/far_voxel_mesher.js').VoxelMesh} mesh
 * @param {number} spawn_seconds
 * @returns {{ geometry: BufferGeometry, bytes: number } | null}
 */
function build_voxel_geometry(mesh, spawn_seconds) {
  if (mesh.indices.length === 0) return null
  const spawn = new Float32Array(mesh.positions.length / 3).fill(spawn_seconds)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3, /* normalized */ true))
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3, /* normalized */ true))
  geometry.setAttribute('spawn_seconds', new BufferAttribute(spawn, 1))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  const bytes =
    mesh.positions.byteLength +
    mesh.normals.byteLength +
    mesh.colors.byteLength +
    spawn.byteLength +
    mesh.indices.byteLength
  return { geometry, bytes }
}

/**
 * Appends one continuous layer (ground or sky) to the shared vertex/index arrays: emits the 33×33
 * corner vertices, triangulates every cell whose 4 corners participate (2 tris), and adds a border
 * skirt ring down to the layer's min_height. Vertices are appended, so `indices` are offset by the
 * layer's base vertex.
 * @param {FarLayer} layer @param {number} origin_x @param {number} origin_z @param {number} block_size
 * @param {number} skirt_floor world-Y the border skirt drops to (ground: the absolute seal floor; sky: the
 *   layer's slab min) — decoupled from min_height so the ground seam seals without dragging the sky slab down
 * @param {number[]} positions @param {number[]} colors @param {number[]} normals @param {number[]} indices
 * @returns {void}
 */
function append_layer(layer, origin_x, origin_z, block_size, skirt_floor, positions, colors, normals, indices) {
  const N = CELLS_PER_SECTION
  const C = CORNERS_PER_EDGE
  const { corner_h, corner_c, corner_n, corner_mask, min_height } = layer
  const base = positions.length / 3

  // Corner vertices (world space) with their precomputed smooth normal. A non-participating corner
  // still gets a slot (unused by any triangle) so grid index math stays simple.
  for (let rz = 0; rz < C; rz += 1) {
    for (let rx = 0; rx < C; rx += 1) {
      const k = rz * C + rx
      const wx = origin_x + rx * block_size
      const wz = origin_z + rz * block_size
      positions.push(wx, corner_mask[k] ? corner_h[k] : min_height, wz)
      colors.push(corner_c[k * 3] / 255, corner_c[k * 3 + 1] / 255, corner_c[k * 3 + 2] / 255)
      normals.push(corner_n[k * 3], corner_mask[k] ? corner_n[k * 3 + 1] : 1, corner_n[k * 3 + 2])
    }
  }

  const vi = (/** @type {number} */ rx, /** @type {number} */ rz) => base + rz * C + rx
  // Triangulate cells whose 4 corners all participate.
  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const k00 = cz * C + cx
      const k10 = cz * C + (cx + 1)
      const k01 = (cz + 1) * C + cx
      const k11 = (cz + 1) * C + (cx + 1)
      if (!corner_mask[k00] || !corner_mask[k10] || !corner_mask[k01] || !corner_mask[k11]) continue
      // Two tris, CCW seen from +y (front faces up); DoubleSide covers grazing/underside anyway.
      indices.push(vi(cx, cz), vi(cx, cz + 1), vi(cx + 1, cz + 1))
      indices.push(vi(cx, cz), vi(cx + 1, cz + 1), vi(cx + 1, cz))
    }
  }

  append_border_skirt(layer, base, origin_x, origin_z, block_size, skirt_floor, positions, colors, normals, indices)
}

/**
 * Appends a skirt along the section's outer border: for each participating border corner, a wall vertex
 * at `min_height` directly below it, and quads between consecutive border corners → a curtain that
 * covers a 1-level LOD seam with the (lower-resolution) neighbor section. Only the 4 grid edges.
 * @param {FarLayer} layer @param {number} layer_base first vertex index of this layer's corner grid
 * @param {number} origin_x @param {number} origin_z @param {number} block_size
 * @param {number} floor world-Y the skirt drops to (the caller's seal floor; see append_layer)
 * @param {number[]} positions @param {number[]} colors @param {number[]} normals @param {number[]} indices
 * @returns {void}
 */
function append_border_skirt(
  layer,
  layer_base,
  origin_x,
  origin_z,
  block_size,
  floor,
  positions,
  colors,
  normals,
  indices
) {
  const C = CORNERS_PER_EDGE
  const { corner_h, corner_c, corner_n, corner_mask } = layer
  // Map a border corner grid index → its skirt (floor) vertex index, created lazily.
  /** @type {Map<number, number>} */
  const skirt_of = new Map()
  const skirt_vertex = (/** @type {number} */ k, /** @type {number} */ rx, /** @type {number} */ rz) => {
    let s = skirt_of.get(k)
    if (s === undefined) {
      s = positions.length / 3
      positions.push(origin_x + rx * block_size, floor, origin_z + rz * block_size)
      colors.push(corner_c[k * 3] / 255, corner_c[k * 3 + 1] / 255, corner_c[k * 3 + 2] / 255)
      // Skirt normal = the corner's own normal (a curtain hanging from the surface — reusing the top
      // normal keeps the wall shaded consistently with the surface above it; it's a seam cover, not lit
      // detail).
      normals.push(corner_n[k * 3], corner_n[k * 3 + 1], corner_n[k * 3 + 2])
      skirt_of.set(k, s)
    }
    return s
  }

  // Walk the 4 edges as (rx,rz) sequences; between two consecutive PARTICIPATING corners emit a wall quad.
  /** @type {[number,number][][]} */
  const edges = [
    seq(0, 0, 1, 0), // top: z=0, x 0..N
    seq(0, C - 1, 1, 0), // bottom: z=N
    seq(0, 0, 0, 1), // left: x=0, z 0..N
    seq(C - 1, 0, 0, 1), // right: x=N
  ]
  for (const edge of edges) {
    for (let i = 0; i + 1 < edge.length; i += 1) {
      const [ax, az] = edge[i]
      const [bx, bz] = edge[i + 1]
      const ka = az * C + ax
      const kb = bz * C + bx
      if (!corner_mask[ka] || !corner_mask[kb]) continue
      const ta = layer_base + ka
      const tb = layer_base + kb
      const sa = skirt_vertex(ka, ax, az)
      const sb = skirt_vertex(kb, bx, bz)
      // Two tris of the wall quad (top edge ta→tb, floor edge sa→sb). Wound both ways is fine (DoubleSide).
      indices.push(ta, sa, sb)
      indices.push(ta, sb, tb)
      void corner_h // heights already baked into the top vertices
    }
  }
}

/** Builds an ordered (rx,rz) corner sequence along one grid edge. @param {number} rx0 @param {number} rz0
 *  @param {number} dx @param {number} dz @returns {[number,number][]} */
function seq(rx0, rz0, dx, dz) {
  const C = CORNERS_PER_EDGE
  /** @type {[number,number][]} */
  const out = []
  for (let i = 0; i < C; i += 1) out.push([rx0 + dx * i, rz0 + dz * i])
  return out
}
