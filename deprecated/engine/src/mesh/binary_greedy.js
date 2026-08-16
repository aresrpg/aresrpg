// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Binary greedy mesher core (§3.5) — per-axis u32 occupancy masks, 32-at-a-time face culling via
// bit ops, then greedy merge of same-class faces into maximal quads. Ported concepts from
// cgerikj/binary-greedy-meshing and TanTanDev's binary_greedy_mesher_demo (0fps background).
//
// This module is axis/geometry-only: it walks a chunk's frozen `occupancy` bitmasks (format.js)
// to find visible faces, then merges them. Per-face classification (block_id/ao/light) and quad
// encoding are the caller's job (mesher.js) — kept separate so this file has zero knowledge of
// the quad_buffer wire format.
//
// ALLOCATION DIET (playbook #4): the hot path is now object-free. `cull_faces` EMITS each visible
// face as a PACKED int (x | y<<6 | z<<12) through a callback — no `{x,y,z,face}` object per face —
// and iterates only the SET bits of each occupancy word via a count-trailing-zeros walk (was a full
// 0..31 per-bit scan). `greedy_merge` consumes those packed ints, merges into maximal quads, and
// EMITS each merged quad through a callback (no MergedQuad object array), reusing a single module
// scratch grid across planes. Output order is byte-identical to the previous object-based path.

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_occupancy_bit, local_index } from '../chunks/format.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('./quad_buffer.js').QuadFace} QuadFace */

/**
 * @callback FaceEmit a visible face, as a packed local position `x | (y<<6) | (z<<12)` (each 0..31).
 *   The face DIRECTION is fixed per `cull_faces` call, so it is not re-encoded here.
 * @param {number} packed_pos
 * @returns {void}
 */

/**
 * @callback QuadEmit one merged quad: origin local voxel (ox,oy,oz) + merged size (w,h).
 * @param {number} ox @param {number} oy @param {number} oz
 * @param {number} w merged width, 1-32 (along the face's u axis)
 * @param {number} h merged height, 1-32 (along the face's v axis)
 * @returns {void}
 */

/**
 * Inverse of the packed layout: (x,y,z) → (row, bit) for a given axis's occupancy mask.
 * @param {0|1|2} axis
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {[number, number]} [row, bit]
 */
function row_bit_from_coord(axis, x, y, z) {
  if (axis === 0) return [y * CHUNK_SIZE + z, x]
  if (axis === 1) return [x * CHUNK_SIZE + z, y]
  return [x * CHUNK_SIZE + y, z]
}

/**
 * Reads the opaque-occupancy bit at world-adjacent local coordinates, treating anything
 * outside the 32³ chunk as reaching into `neighbor_solid` (a caller-supplied lookup for the
 * six neighbor-chunk halo faces) or as empty (air) when no neighbor info is supplied.
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {(x: number, y: number, z: number) => boolean} [neighbor_solid]
 * @returns {boolean}
 */
function is_solid_at(chunk, x, y, z, neighbor_solid) {
  if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
    return neighbor_solid ? neighbor_solid(x, y, z) : false
  }
  const [row, bit] = row_bit_from_coord(0, x, y, z)
  return get_occupancy_bit(chunk, 0, row, bit)
}

/**
 * Emits all visible (culled) faces for one axis direction by comparing each occupancy row against
 * itself shifted by one bit — a face is visible where a solid bit has an empty neighbor bit along
 * the axis. Processes all 32 bits of a row with word ops (the "32-at-a-time" bit-op culling, §3.5),
 * visiting ONLY the set bits via a count-trailing-zeros walk (`bits & -bits` isolates the lowest set
 * bit; `bits &= bits - 1` clears it) so sparse rows cost O(popcount), not O(32). Each visible face is
 * handed to `emit` as a packed position in the SAME (row ascending, set-bit ascending) order the old
 * object-returning version produced — so downstream bucketing + merge output stays byte-identical.
 *
 * @param {ChunkRecord} chunk
 * @param {0|1|2} axis
 * @param {boolean} positive_direction true = the "+axis" face (e.g. +x), false = "-axis" (-x)
 * @param {((x: number, y: number, z: number) => boolean) | undefined} neighbor_solid halo lookup for
 *   the chunk-boundary faces (x/y/z at -1 or 32); undefined in isolation (no cross-chunk halo)
 * @param {FaceEmit} emit called once per visible face with its packed local position
 * @returns {void}
 */
export function cull_faces(chunk, axis, positive_direction, neighbor_solid, emit) {
  const occupancy = chunk.occupancy[axis]

  for (let row = 0; row < occupancy.length; row += 1) {
    const word = occupancy[row]
    if (word === 0) continue

    // Perpendicular-plane coords packed into `row` (see format.js occupancy layout): row = hi*32 + lo.
    const r_hi = row >> 5
    const r_lo = row & (CHUNK_SIZE - 1)

    let bits = word
    while (bits !== 0) {
      const bit = 31 - Math.clz32(bits & -bits) // index of the lowest set bit
      bits &= bits - 1 // clear it

      // Neighbor along the axis (one step in the face direction): in-word test, or halo at boundary.
      let neighbor_solid_flag
      const neighbor_bit = positive_direction ? bit + 1 : bit - 1
      if (neighbor_bit >= 0 && neighbor_bit < CHUNK_SIZE) {
        neighbor_solid_flag = ((word >>> neighbor_bit) & 1) === 1
      } else {
        // Crosses the chunk boundary — the neighbor voxel's axis coord is 32 (positive) or -1.
        const out = positive_direction ? CHUNK_SIZE : -1
        const nx = axis === 0 ? out : r_hi
        const ny = axis === 1 ? out : axis === 0 ? r_hi : r_lo
        const nz = axis === 2 ? out : r_lo
        neighbor_solid_flag = is_solid_at(chunk, nx, ny, nz, neighbor_solid)
      }

      if (!neighbor_solid_flag) {
        // Reconstruct (x,y,z) from (axis, row, bit) and emit the packed position.
        const x = axis === 0 ? bit : r_hi
        const y = axis === 1 ? bit : axis === 0 ? r_hi : r_lo
        const z = axis === 2 ? bit : r_lo
        emit(x | (y << 6) | (z << 12))
      }
    }
  }
}

/** Reused merge grid — a single 32×32 "used" mask shared across every plane of every greedy_merge
 *  call (cleared per plane). Meshing is single-threaded and greedy_merge never re-enters, so one
 *  scratch is safe and saves a Uint8Array allocation per plane. */
const merge_used = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)

/**
 * Greedy-merges a set of same-class visible faces (all sharing one `face` direction and one
 * classification key already filtered by the caller) into maximal rectangular quads, emitting each
 * through `emit`. Faces arrive as PACKED positions (`x | y<<6 | z<<12`).
 *
 * Classic 2D greedy meshing on the face's plane: faces project to (u, v) on their plane, a boolean
 * "used" grid tracks merged cells, and for each unused cell we grow a rectangle first along u (while
 * the row matches), then along v (while the whole u-run matches) — see 0fps meshing / TanTanDev demo.
 * Plane iteration order (first-seen depth) and the (v, u) scan order are preserved from the previous
 * implementation, so emitted quad order is byte-identical.
 *
 * @param {number[]} faces packed positions, all for exactly one `face` direction + one class
 * @param {QuadFace} face_id the shared face direction (needed to know the plane axes)
 * @param {QuadEmit} emit called once per merged quad with (ox, oy, oz, w, h)
 * @returns {void}
 */
export function greedy_merge(faces, face_id, emit) {
  if (faces.length === 0) return

  // Which world axis is "depth" (constant across the plane) vs the two in-plane axes (u, v).
  const axis = Math.floor(face_id / 2)

  // Bucket faces by depth-plane coordinate (all faces at the same depth share one grid). Each plane
  // is a Set of packed (v*32 + u) cells — presence is all greedy needs. First-seen depth ordering is
  // preserved by Map insertion order.
  /** @type {Map<number, Set<number>>} */
  const planes = new Map()
  for (let i = 0; i < faces.length; i += 1) {
    const p = faces[i]
    const x = p & 0x3f
    const y = (p >> 6) & 0x3f
    const z = (p >> 12) & 0x3f
    // depth / u / v per axis (u→width, v→height): axis0 (x-faces) u=y v=z; axis1 (y) u=x v=z; axis2 (z) u=x v=y.
    const depth = axis === 0 ? x : axis === 1 ? y : z
    const u = axis === 0 ? y : x
    const v = axis === 2 ? y : z
    let plane = planes.get(depth)
    if (!plane) {
      plane = new Set()
      planes.set(depth, plane)
    }
    plane.add(v * CHUNK_SIZE + u)
  }

  for (const [depth, plane] of planes) {
    merge_used.fill(0)

    for (let v = 0; v < CHUNK_SIZE; v += 1) {
      for (let u = 0; u < CHUNK_SIZE; u += 1) {
        const key = v * CHUNK_SIZE + u
        if (merge_used[key] || !plane.has(key)) continue

        // Grow width along u.
        let w = 1
        while (u + w < CHUNK_SIZE) {
          const next_key = v * CHUNK_SIZE + (u + w)
          if (merge_used[next_key] || !plane.has(next_key)) break
          w += 1
        }

        // Grow height along v, requiring the full [u, u+w) row to match at each step.
        let h = 1
        outer: while (v + h < CHUNK_SIZE) {
          for (let du = 0; du < w; du += 1) {
            const row_key = (v + h) * CHUNK_SIZE + (u + du)
            if (merge_used[row_key] || !plane.has(row_key)) break outer
          }
          h += 1
        }

        // Mark the merged rectangle used.
        for (let dv = 0; dv < h; dv += 1) {
          for (let du = 0; du < w; du += 1) {
            merge_used[(v + dv) * CHUNK_SIZE + (u + du)] = 1
          }
        }

        // Rebuild the origin voxel (ox,oy,oz) from (u, v, depth) for this axis and emit.
        const ox = axis === 0 ? depth : u
        const oy = axis === 0 ? u : axis === 1 ? depth : v
        const oz = axis === 2 ? depth : v
        emit(ox, oy, oz, w, h)
      }
    }
  }
}

/** Local index re-export for callers that classify faces by block id (mesher.js). */
export { local_index }
