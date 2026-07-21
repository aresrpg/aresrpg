// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Golden mesher tests. Three suites:
//  1. 2×2×1 exposed box → exactly 6 merged quads (one per face) with exact size/pos/block/AO/light.
//  2. Height-step side faces (sky-leak regression): two columns of heights 5 vs 3 → the taller
//     column's exposed vertical +x side faces at the step (y=3,4) ARE emitted; buried ones are
//     culled. Disproves the "missed side-face at a vertical discontinuity" hypothesis.
//  3. Test-island watertightness: exhaustive per-unit-face check on the real generate_test_chunk
//     island — zero missing interior faces (no sky gaps) and zero buried faces (no overdraw).

import { test, expect, describe } from 'bun:test'

import { create_chunk_record, local_index, pack_light, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../config/block_registry.js'
import { CHUNK_SIZE } from '../config/world_config.js'
import { generate_test_chunk } from '../chunks/test_gen.js'
import { build_neighbor_halos, coord_key } from '../chunks/store.js'

import { mesh_chunk } from './mesher.js'
import { decode_quad } from './quad_buffer.js'
import { set_leaf_cubes_debug, LEAF_SPRITE_IDS, leaf_normal_index } from './leaf_sprites.js'

const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
const GRASS_TUFT = /** @type {number} */ (get_block_by_name('grass_tuft')?.id)

/**
 * Places a solid block and sets all three occupancy-axis bits, mirroring what gen/decorators do.
 * @param {import('../chunks/format.js').ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} block_id
 */
function place_solid(chunk, x, y, z, block_id) {
  chunk.ids[local_index(x, y, z)] = block_id
  set_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x, true)
  set_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, y, true)
  set_occupancy_bit(chunk, 2, x * CHUNK_SIZE + y, z, true)
}

/**
 * Expands every merged quad back into the set of unit (voxel, face) keys it covers — used to
 * assert per-unit-face presence independent of how greedy merging grouped them.
 * @param {Uint32Array} quad_buffer
 * @param {number} quad_count
 * @returns {Set<string>} keys "x,y,z,face"
 */
function emitted_unit_faces(quad_buffer, quad_count) {
  const emitted = new Set()
  for (let i = 0; i < quad_count; i += 1) {
    const q = decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]])
    const axis = Math.floor(q.face / 2)
    const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
    for (let du = 0; du < q.w; du += 1) {
      for (let dv = 0; dv < q.h; dv += 1) {
        const c = [q.x, q.y, q.z]
        c[u_axis] += du
        c[v_axis] += dv
        emitted.add(`${c[0]},${c[1]},${c[2]},${q.face}`)
      }
    }
  }
  return emitted
}

/**
 * Builds a chunk containing exactly one 2×2×1 solid stone box at local origin (0,0,0)-(1,1,0),
 * fully surrounded by air (chunk boundaries count as air in M0 — no neighbor halos supplied).
 * @returns {import('../chunks/format.js').ChunkRecord}
 */
function build_2x2x1_test_chunk() {
  const chunk = create_chunk_record(0, 0, 0)

  const box_voxels = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ]

  for (const [x, y, z] of box_voxels) {
    chunk.ids[local_index(x, y, z)] = STONE
    set_occupancy_bit(chunk, 0, y * 32 + z, x, true)
    set_occupancy_bit(chunk, 1, x * 32 + z, y, true)
    set_occupancy_bit(chunk, 2, x * 32 + y, z, true)
  }

  // Faces sample the light of the AIR cell they open into (mesher.js's face_light), not the
  // solid voxel itself — fill the whole chunk with uniform full-bright so every face (regardless
  // of direction) reads the same (sun=15, block=0) value and classifies into one bucket per side.
  chunk.light.fill(0xf0)

  return chunk
}

describe('mesh_chunk golden: 2x2x1 exposed stone box', () => {
  const chunk = build_2x2x1_test_chunk()
  const { quad_buffer, quad_count } = mesh_chunk(chunk)

  test('produces exactly 6 merged quads (one per face direction)', () => {
    expect(quad_count).toBe(6)
    expect(quad_buffer.length).toBe(quad_count * 2)
  })

  test('every quad is stone with full AO (no self-occlusion) and full sun light', () => {
    for (let i = 0; i < quad_count; i += 1) {
      const quad = decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]])
      expect(quad.block_id).toBe(STONE)
      // SMOOTH LIGHTING (ENG-10 phase 1): open-sky box, every neighbor air cell sun=15 → all four
      // corners average to 7 (max, ÷7 → 1.0 in-shader, brightness-identical to the old flat sun=15).
      expect(quad.sun_corners).toEqual([7, 7, 7, 7])
      expect(quad.ao).toEqual([3, 3, 3, 3])
    }
  })

  test('faces are maximally merged to the expected size per direction', () => {
    /** @type {Map<number, {w: number, h: number, x: number, y: number, z: number}>} */
    const by_face = new Map()
    for (let i = 0; i < quad_count; i += 1) {
      const quad = decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]])
      by_face.set(quad.face, quad)
    }

    expect([...by_face.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5])

    // +x (face 0): only the x=1 voxel column has an exposed +x face (x=0's +x neighbor is the
    // box's own x=1 voxel — occluded). Plane is (y,z): u=y (w=2), v=z (h=1).
    const px = by_face.get(0)
    expect(px).toMatchObject({ x: 1, w: 2, h: 1 })

    // -x (face 1): only x=0 has an exposed -x face.
    const nx = by_face.get(1)
    expect(nx).toMatchObject({ x: 0, w: 2, h: 1 })

    // +y (face 2): only y=1 has an exposed +y face. Plane (x,z): u=x (w=2), v=z (h=1).
    const py = by_face.get(2)
    expect(py).toMatchObject({ y: 1, w: 2, h: 1 })

    // -y (face 3): only y=0 has an exposed -y face.
    const ny = by_face.get(3)
    expect(ny).toMatchObject({ y: 0, w: 2, h: 1 })

    // +z (face 4) and -z (face 5): the box is a single layer at z=0, so BOTH directions are
    // exposed at that same z (z=1 is air above, z=-1 is air/chunk-boundary below). Plane (x,y):
    // u=x (w=2), v=y (h=2).
    const pz = by_face.get(4)
    expect(pz).toMatchObject({ z: 0, w: 2, h: 2 })

    const nz = by_face.get(5)
    expect(nz).toMatchObject({ z: 0, w: 2, h: 2 })
  })
})

describe('mesh_chunk: exposed vertical side faces at a height step (sky-leak regression)', () => {
  // Coordinator report: faint sky-background specks on stepped dome tops => hypothesis of a
  // missed vertical side face at a column height-step. Hand-build the exact minimal case: two
  // adjacent columns of heights 5 and 3 (a 2-voxel step) and assert the taller column's exposed
  // side faces at the step (y=3, y=4) are emitted. (Disproves the missed-side-face hypothesis —
  // documents that the mesher IS watertight at vertical discontinuities.)
  const chunk = create_chunk_record(0, 0, 0)
  for (let y = 0; y < 5; y += 1) place_solid(chunk, 0, y, 0, STONE) // tall column x=0, height 5
  for (let y = 0; y < 3; y += 1) place_solid(chunk, 1, y, 0, STONE) // short column x=1, height 3
  chunk.light.fill(0xf0)
  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  const emitted = emitted_unit_faces(quad_buffer, quad_count)

  test('taller column emits its +x side faces over the full exposed step (y=3 and y=4)', () => {
    // +x = face 0; the step exposes x=0 toward the shorter x=1 neighbor at the top 2 voxels.
    expect(emitted.has('0,3,0,0')).toBe(true)
    expect(emitted.has('0,4,0,0')).toBe(true)
    // Below the step (y<3) x=0's +x neighbor is solid (x=1) → those faces must be culled.
    expect(emitted.has('0,0,0,0')).toBe(false)
    expect(emitted.has('0,2,0,0')).toBe(false)
  })

  test('short column top and both tops are capped (+y faces present)', () => {
    expect(emitted.has('0,4,0,2')).toBe(true) // tall column top cap
    expect(emitted.has('1,2,0,2')).toBe(true) // short column top cap
  })
})

describe('mesh_chunk: test-island watertightness (no interior sky gaps)', () => {
  // Exhaustive check on the real M0 test-gen island chunk: every solid-class voxel face with a
  // non-solid INTERIOR neighbor must be emitted (boundary faces are M0-omitted by design and
  // excluded), and no fully-buried face may be emitted. A single missing interior face is a
  // sky-leak; a buried face is wasted overdraw. Both must be zero.
  const chunk = generate_test_chunk(0, 0, 0)

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {boolean}
   */
  function solid_class(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) return false
    const id = chunk.ids[local_index(x, y, z)]
    return id !== AIR && get_block_by_id(id)?.class === 'solid'
  }

  const DIRS = [
    [1, 0, 0, 0],
    [-1, 0, 0, 1],
    [0, 1, 0, 2],
    [0, -1, 0, 3],
    [0, 0, 1, 4],
    [0, 0, -1, 5],
  ]

  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  const emitted = emitted_unit_faces(quad_buffer, quad_count)

  test('every interior solid/non-solid boundary face is emitted (zero gaps)', () => {
    let missing = 0
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let y = 0; y < CHUNK_SIZE; y += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          if (!solid_class(x, y, z)) continue
          for (const [dx, dy, dz, f] of DIRS) {
            const nx = x + dx
            const ny = y + dy
            const nz = z + dz
            const outside = nx < 0 || ny < 0 || nz < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE || nz >= CHUNK_SIZE
            if (outside) continue // boundary faces omitted in M0 (no neighbor halos)
            if (!solid_class(nx, ny, nz) && !emitted.has(`${x},${y},${z},${f}`)) missing += 1
          }
        }
      }
    }
    expect(missing).toBe(0)
  })

  test('no buried (fully-occluded) faces are emitted (zero overdraw)', () => {
    let buried = 0
    for (const key of emitted) {
      const [x, y, z, f] = key.split(',').map(Number)
      const [dx, dy, dz] = /** @type {number[]} */ (DIRS.find((d) => d[3] === f))
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz
      const outside = nx < 0 || ny < 0 || nz < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE || nz >= CHUNK_SIZE
      if (!outside && solid_class(nx, ny, nz)) buried += 1
    }
    expect(buried).toBe(0)
  })
})

describe('mesh_chunk: cross-shape foliage (grass_tuft) emits faces 6/7 without culling below', () => {
  // One grass_tuft (registry shape:'cross', class foliage) resting on a single grass block. The
  // tuft carries NO occupancy bit and is non-solid, so it must (a) NOT cull the grass block's +y
  // top face beneath it, and (b) emit exactly two billboard quads (faces 6 and 7) that bypass
  // greedy meshing + face culling: unit size (w=h=1) at the tuft's own origin, full AO, and
  // carrying the tuft cell's OWN light byte (not the surrounding fill).
  const chunk = create_chunk_record(0, 0, 0)
  place_solid(chunk, 5, 0, 5, GRASS) // grass floor block (solid, occupancy set)
  chunk.ids[local_index(5, 1, 5)] = GRASS_TUFT // tuft on top: id only, NO occupancy (non-solid)
  chunk.light.fill(0xf0)
  chunk.light[local_index(5, 1, 5)] = pack_light(12, 3) // distinct light in the tuft's OWN cell

  const { quad_buffer, quad_count } = mesh_chunk(chunk)

  /** @type {import('./quad_buffer.js').QuadFields[]} */
  const quads = []
  for (let i = 0; i < quad_count; i += 1) {
    quads.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))
  }
  const cross = quads.filter((q) => q.face >= 6)
  const solid = quads.filter((q) => q.face < 6)

  // [D182] grass_tuft has cross_pairs 2 → 2 independent billboard PAIRS = 4 quads (2× face 6,
  // 3× face 7). Each pair carries an ORDINAL 0..2 in the freed cross AO byte (bits 20-22 → ao[0]|ao[1]<<2).
  const ord = (/** @type {import('./quad_buffer.js').QuadFields} */ q) => q.ao[0] | (q.ao[1] << 2)

  test('grass_tuft emits cross_pairs (2) crossed pairs = 4 quads (2× face 6, 2× face 7)', () => {
    expect(cross.length).toBe(4)
    expect(cross.map((q) => q.face).sort()).toEqual([6, 6, 7, 7])
  })

  test('every cross quad: tuft origin, w=1 h=2 (waist-high carpet), and the tuft cell OWN light', () => {
    for (const q of cross) {
      expect(q).toMatchObject({ x: 5, y: 1, z: 5, w: 1, h: 2, block_id: GRASS_TUFT })
      // SMOOTH LIGHTING: cross carries the tuft cell's OWN sun, flat across all 4 corners. pack_light(12,3)
      // high nibble 12 → 12>>1 = 6 (0-7 corner scale) — NOT the 0xf0 (sun=15) fill. block_light retired.
      expect(q.sun_corners).toEqual([6, 6, 6, 6])
    }
  })

  test('the 2 pairs carry ordinals 0,1 in the AO byte — each on exactly one face-6 and one face-7', () => {
    for (const face of [6, 7]) {
      expect(
        cross
          .filter((q) => q.face === face)
          .map(ord)
          .sort()
      ).toEqual([0, 1])
    }
  })

  test('the grass block +y top face beneath the tuft is still emitted (foliage never culls)', () => {
    const emitted = emitted_unit_faces(quad_buffer, quad_count)
    expect(emitted.has('5,0,5,2')).toBe(true) // grass at (5,0,5), +y = face 2, points at the tuft
  })

  test('no solid-pass (face<6) quad references the cross block id', () => {
    expect(solid.some((q) => q.block_id === GRASS_TUFT)).toBe(false)
  })
})

describe('mesh_chunk: cross blocks never greedy-merge', () => {
  // Two grass_tufts adjacent along +x. If cross quads merged like solid faces we'd see wider runs;
  // instead each tuft stays its own K=2 pairs of unit quads → 2×4 = 8 quads total, all w=1 (h=2). [D182]
  const chunk = create_chunk_record(0, 0, 0)
  chunk.ids[local_index(3, 4, 3)] = GRASS_TUFT
  chunk.ids[local_index(4, 4, 3)] = GRASS_TUFT
  chunk.light.fill(0xf0)

  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  /** @type {import('./quad_buffer.js').QuadFields[]} */
  const quads = []
  for (let i = 0; i < quad_count; i += 1) {
    quads.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))
  }
  const cross = quads.filter((q) => q.face >= 6)

  test('two adjacent tufts stay 2×4 = 8 quads (never merged into a wider run); each w=1 h=2', () => {
    expect(cross.length).toBe(8)
    for (const q of cross) {
      expect(q.w).toBe(1)
      expect(q.h).toBe(2) // grass_tuft cross_height 2 (waist-high carpet)
    }
  })

  test('each tuft origin carries its 2 pairs — 2 face-6 + 2 face-7, ordinals 0,1 per face', () => {
    const ord = (/** @type {import('./quad_buffer.js').QuadFields} */ q) => q.ao[0] | (q.ao[1] << 2)
    for (const [x, y, z] of [
      [3, 4, 3],
      [4, 4, 3],
    ]) {
      const at = cross.filter((q) => q.x === x && q.y === y && q.z === z)
      expect(at.map((q) => q.face).sort()).toEqual([6, 6, 7, 7])
      for (const face of [6, 7])
        expect(
          at
            .filter((q) => q.face === face)
            .map(ord)
            .sort()
        ).toEqual([0, 1])
    }
  })
})

describe('mesh_chunk: tall cross-flora emits quad_h = registry cross_height (DIVERGENCE WAVE)', () => {
  // tall_grass (cross_height 3) and reed (3) are each ONE voxel whose X-billboard is 3 blocks tall: every
  // cross quad (faces 6/7) must carry that h (not 1) at w=1, so the material stretches the sprite chest-/
  // marsh-high. Both have cross_pairs 2 → 2 pairs = 4 quads. grass_tuft (cross_height 2, cross_pairs 3) is
  // pinned h=2 / 6 quads by the suite above.
  const TALL_GRASS = /** @type {number} */ (get_block_by_name('tall_grass')?.id)
  const REED = /** @type {number} */ (get_block_by_name('reed')?.id)
  const chunk = create_chunk_record(0, 0, 0)
  chunk.ids[local_index(5, 1, 5)] = TALL_GRASS
  chunk.ids[local_index(8, 1, 8)] = REED
  chunk.light.fill(0xf0)
  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  /** @type {import('./quad_buffer.js').QuadFields[]} */
  const quads = []
  for (let i = 0; i < quad_count; i += 1) quads.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))

  test('tall_grass emits cross_pairs (2) pairs = 4 quads at h=3, w=1 (chest-high billboard)', () => {
    const t = quads.filter((q) => q.block_id === TALL_GRASS)
    expect(t.length).toBe(4)
    expect(t.map((q) => q.face).sort()).toEqual([6, 6, 7, 7])
    for (const q of t) {
      expect(q.w).toBe(1)
      expect(q.h).toBe(3) // cross_height 3
      expect(q).toMatchObject({ x: 5, y: 1, z: 5 })
    }
  })

  test('reed emits cross_pairs (2) pairs = 4 quads at h=3 (tallest marsh flora)', () => {
    const r = quads.filter((q) => q.block_id === REED)
    expect(r.length).toBe(4)
    for (const q of r) {
      expect(q.w).toBe(1)
      expect(q.h).toBe(3) // cross_height 3
    }
  })
})

/**
 * Finds the merged quad covering the unit face (x,y,z,face) among decoded quads. AO is uniform per
 * merged quad, so the covering quad yields that unit face's AO. Undefined if nothing covers it.
 * @param {import('./quad_buffer.js').QuadFields[]} quads
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} face
 * @returns {import('./quad_buffer.js').QuadFields | undefined}
 */
function quad_covering(quads, x, y, z, face) {
  const axis = Math.floor(face / 2)
  const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
  const target = [x, y, z]
  for (const q of quads) {
    if (q.face !== face) continue
    const origin = [q.x, q.y, q.z]
    if (origin[axis] !== target[axis]) continue
    const du = target[u_axis] - origin[u_axis]
    const dv = target[v_axis] - origin[v_axis]
    if (du >= 0 && du < q.w && dv >= 0 && dv < q.h) return q
  }
  return undefined
}

/** @param {Uint32Array} quad_buffer @param {number} quad_count */
function decode_all(quad_buffer, quad_count) {
  /** @type {import('./quad_buffer.js').QuadFields[]} */
  const quads = []
  for (let i = 0; i < quad_count; i += 1) quads.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))
  return quads
}

describe('mesh_chunk: neighbor halos cull the flat seam and give boundary AO parity', () => {
  // Adjacent chunks A(0,0,0)/B(1,0,0), FLAT seam (both a solid y=0 ground layer). A has an interior
  // occluder one step +x-and-up from ref cell A(5,0,5) → A(6,1,5); B has the MIRROR occluder across
  // the seam → B(0,1,5), one step +x-and-up from A's edge cell (31,0,5). With halos the +x seam
  // walls cull and A(31,0,5)'s top AO reads B's occluder — matching interior A(5,0,5) exactly.
  const chunk_a = create_chunk_record(0, 0, 0)
  const chunk_b = create_chunk_record(1, 0, 0)
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      place_solid(chunk_a, x, 0, z, GRASS)
      place_solid(chunk_b, x, 0, z, GRASS)
    }
  }
  place_solid(chunk_a, 6, 1, 5, STONE) // interior occluder above the ground
  place_solid(chunk_b, 0, 1, 5, STONE) // mirror occluder across the seam from A(31,0,5)
  chunk_a.light.fill(0xf0)
  chunk_b.light.fill(0xf0)

  const records = new Map([
    [coord_key(0, 0, 0), chunk_a],
    [coord_key(1, 0, 0), chunk_b],
  ])
  const halos_a = build_neighbor_halos((cx, cy, cz) => records.get(coord_key(cx, cy, cz)), 0, 0, 0)

  const with_halos = mesh_chunk(chunk_a, halos_a)
  const without_halos = mesh_chunk(chunk_a)
  const quads_with = decode_all(with_halos.quad_buffer, with_halos.quad_count)
  const quads_without = decode_all(without_halos.quad_buffer, without_halos.quad_count)
  const emitted_with = emitted_unit_faces(with_halos.quad_buffer, with_halos.quad_count)
  const emitted_without = emitted_unit_faces(without_halos.quad_buffer, without_halos.quad_count)

  test('the +x seam wall is culled with halos (present without)', () => {
    // A's whole x=31 ground column faces B's solid x=0 column → every +x seam face is culled.
    for (let z = 0; z < CHUNK_SIZE; z += 1) expect(emitted_with.has(`31,0,${z},0`)).toBe(false)
    expect(emitted_without.has('31,0,5,0')).toBe(true) // isolation renders it against air → wall
  })

  test('a pure flat seam (no occluder) strictly drops the quad count with halos', () => {
    // Isolate the culling win from AO fragmentation: two fully-flat single-layer chunks, B solid
    // across A's +x seam. Halos cull A's +x wall and — with a uniform surface — change no AO, so
    // the count strictly drops. (On the demo island the same culling removes ~23 walls/chunk.)
    const flat_a = create_chunk_record(0, 0, 0)
    const flat_b = create_chunk_record(1, 0, 0)
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        place_solid(flat_a, x, 0, z, GRASS)
        place_solid(flat_b, x, 0, z, GRASS)
      }
    }
    flat_a.light.fill(0xf0)
    flat_b.light.fill(0xf0)
    const flat_records = new Map([
      [coord_key(0, 0, 0), flat_a],
      [coord_key(1, 0, 0), flat_b],
    ])
    const flat_halos = build_neighbor_halos((cx, cy, cz) => flat_records.get(coord_key(cx, cy, cz)), 0, 0, 0)
    expect(mesh_chunk(flat_a, flat_halos).quad_count).toBeLessThan(mesh_chunk(flat_a).quad_count)
  })

  test('boundary top-face AO equals the interior top-face AO (no bright/dark seam line)', () => {
    const interior = quad_covering(quads_with, 5, 0, 5, 2)
    const boundary = quad_covering(quads_with, 31, 0, 5, 2)
    expect(interior).toBeDefined()
    expect(boundary).toBeDefined()
    expect(interior?.ao).not.toEqual([3, 3, 3, 3]) // the occluder actually lowered AO — meaningful
    expect(boundary?.ao).toEqual(interior?.ao)
  })

  test('without halos the boundary reverts to full AO (documents the seam bug halos fix)', () => {
    const boundary = quad_covering(quads_without, 31, 0, 5, 2)
    expect(boundary?.ao).toEqual([3, 3, 3, 3]) // across-seam occluder invisible in isolation
  })
})

// ── [LEAVES-2X Rung 2] DUAL-EMIT leaf CUBE shell ────────────────────────────────────────────────────
// The mesher now emits BOTH the D164 leaf SPRITES (faces 6/7) AND an opaque leaf-CUBE shell (faces 0-5,
// leaf ids) so the render band can crossfade near-sprites → far-opaque-cubes (early-Z). The invariant:
// the ship-mode dual-emit shell must COVER the leaf_cubes_debug baseline shell EXACTLY (same unit faces,
// culled over the same real occupancy) — [LEAF-SEAM fix] quad COUNTS may differ now that the canopy pass
// merge-keys on the baked bent-normal bucket instead of face AO (the byte it repurposed), so the honest
// pool-demand measurement is render_hole.test.js's seam invariant, which meshes SHIP mode directly. The
// sprites stay untouched (they still emit, and the cube A/B stays pure).
describe('dual-emit leaf cube shell (Rung 2)', () => {
  const LEAVES = /** @type {number} */ (get_block_by_name('leaves')?.id)
  const LOG = /** @type {number} */ (get_block_by_name('log')?.id)

  /** A 6×6×6 leaf crown on a 2-tall trunk — a canopy with a real interior + surface shell + trunk contact. */
  function build_canopy_chunk() {
    const chunk = create_chunk_record(0, 0, 0)
    for (let y = 0; y < 2; y += 1) place_solid(chunk, 12, y, 12, LOG) // trunk into the crown
    for (let y = 2; y < 8; y += 1)
      for (let z = 10; z < 16; z += 1) for (let x = 10; x < 16; x += 1) place_solid(chunk, x, y, z, LEAVES)
    chunk.light.fill(0xf0)
    return chunk
  }

  /** Count leaf cube faces (0-5) and leaf sprite faces (6/7) in a mesh. @param {ReturnType<typeof mesh_chunk>} m */
  function leaf_counts(m) {
    let cube = 0
    let sprite = 0
    for (let i = 0; i < m.quad_count; i += 1) {
      const face = (m.quad_buffer[i * 2] >>> 28) & 0x7
      const id = m.quad_buffer[i * 2 + 1] & 0xfff
      if (!LEAF_SPRITE_IDS.has(id)) continue
      if (face < 6) cube += 1
      else sprite += 1
    }
    return { cube, sprite }
  }

  /** Unit-face coverage of the LEAF CUBE quads only (faces 0-5, leaf ids) — merge-key-agnostic, so the
   *  shell comparison survives the canopy pass keying on the bent-normal bucket instead of AO.
   *  @param {ReturnType<typeof mesh_chunk>} m @returns {Set<string>} keys "x,y,z,face" */
  function leaf_cube_unit_faces(m) {
    const covered = new Set()
    for (let i = 0; i < m.quad_count; i += 1) {
      const q = decode_quad([m.quad_buffer[i * 2], m.quad_buffer[i * 2 + 1]])
      if (!LEAF_SPRITE_IDS.has(q.block_id) || q.face >= 6) continue
      const axis = Math.floor(q.face / 2)
      const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
      for (let du = 0; du < q.w; du += 1)
        for (let dv = 0; dv < q.h; dv += 1) {
          const c = [q.x, q.y, q.z]
          c[u_axis] += du
          c[v_axis] += dv
          covered.add(`${c[0]},${c[1]},${c[2]},${q.face}`)
        }
    }
    return covered
  }

  test('ship-mode dual-emit shell COVERS the cube-mode baseline shell exactly (unit faces, merge-agnostic)', () => {
    const chunk = build_canopy_chunk()
    set_leaf_cubes_debug(false)
    const ship_mesh = mesh_chunk(chunk, undefined, true)
    const ship = leaf_counts(ship_mesh)
    set_leaf_cubes_debug(true)
    const baseline_mesh = mesh_chunk(chunk, undefined, true)
    const baseline = leaf_counts(baseline_mesh)
    set_leaf_cubes_debug(false) // never leak the A/B flag to sibling tests

    expect(ship.cube).toBeGreaterThan(0) // dual-emit actually produced the opaque shell
    // [LEAF-SEAM fix] the canopy pass merge-keys on the baked bucket, the baseline (solid pass) on real
    // AO — quad COUNTS legitimately differ, but the covered unit faces must be the IDENTICAL shell.
    expect(leaf_cube_unit_faces(ship_mesh)).toEqual(leaf_cube_unit_faces(baseline_mesh))
    expect(ship.sprite).toBeGreaterThan(0) // sprites still emitted alongside (the near representation)
    expect(baseline.sprite).toBe(0) // the cube A/B stays PURE cubes (no sprites) — A/B integrity
  })

  test('[LEAF-SEAM fix] every canopy quad bakes the bent-normal bucket: ordinal bits 0, bucket == recomputed, homogeneous across the merge', () => {
    const chunk = build_canopy_chunk()
    set_leaf_cubes_debug(false)
    const m = mesh_chunk(chunk, undefined, true)
    set_leaf_cubes_debug(false)
    /** The mesher's halo-less solid probe (out-of-range = air) — leaves are class 'solid'. */
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) return false
      const id = chunk.ids[local_index(x, y, z)]
      return id !== 0 && get_block_by_id(id)?.class === 'solid'
    }
    const open = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => !solid(x, y, z)
    let checked = 0
    for (let i = 0; i < m.quad_count; i += 1) {
      const word_b = m.quad_buffer[i * 2 + 1]
      const q = decode_quad([m.quad_buffer[i * 2], word_b])
      if (!LEAF_SPRITE_IDS.has(q.block_id) || q.face >= 6) continue
      expect((word_b >>> 20) & 0x7).toBe(0) // sprite-ordinal bits stay 0 on cubes (wire contract)
      const baked = (word_b >>> 23) & 0x1f
      const axis = Math.floor(q.face / 2)
      const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
      // EVERY covered cell must recompute to the baked bucket — proves both the bake (right probes,
      // right shift) and merge homogeneity (the bucket rode the merge key, so no cell was averaged).
      for (let du = 0; du < q.w; du += 1)
        for (let dv = 0; dv < q.h; dv += 1) {
          const c = [q.x, q.y, q.z]
          c[u_axis] += du
          c[v_axis] += dv
          const [x, y, z] = c
          const expected = leaf_normal_index(
            open(x + 1, y, z),
            open(x - 1, y, z),
            open(x, y + 1, z),
            open(x, y - 1, z),
            open(x, y, z + 1),
            open(x, y, z - 1)
          )
          expect(baked).toBe(expected)
          checked += 1
        }
    }
    expect(checked).toBeGreaterThan(0) // the crown actually produced canopy quads to check
  })

  test('the shell is the hollow surface, not the solid interior (interior leaf faces stay culled)', () => {
    const chunk = build_canopy_chunk()
    set_leaf_cubes_debug(false)
    const { cube } = leaf_counts(mesh_chunk(chunk, undefined, true))
    set_leaf_cubes_debug(false)
    // A 6×6×6 solid crown's OUTER shell is 6 faces × 36 = 216 unit faces MAX (minus the trunk-contact cells);
    // if interior faces leaked in it would balloon far past that. Greedy merge only lowers the quad count.
    expect(cube).toBeLessThanOrEqual(216)
  })
})

describe('leaf_normal_index: bent-normal outward bucket (the shader-decode wire contract)', () => {
  // JS MIRROR of the terrain_material.js TSL decode — MUST match bit-for-bit (gx=idx%3−1, etc.). This is
  // the tested twin that locks the cross-file contract: a silent change here or there would flatten the
  // canopy shading with no other alarm. Also asserts the index fits the free 5-bit AO slice (bits 23-27).
  /** @param {number} idx */
  const decode = (idx) => [(idx % 3) - 1, (Math.floor(idx / 3) % 3) - 1, (Math.floor(idx / 9) % 3) - 1]

  test('round-trips every 3³ open-neighbour combo, and the index stays in 0..26 (5-bit)', () => {
    for (const px of [false, true])
      for (const nx of [false, true])
        for (const py of [false, true])
          for (const ny of [false, true])
            for (const pz of [false, true])
              for (const nz of [false, true]) {
                const idx = leaf_normal_index(px, nx, py, ny, pz, nz)
                expect(idx).toBeGreaterThanOrEqual(0)
                expect(idx).toBeLessThanOrEqual(26) // fits the free AO bits 23-27 (idx<<3 never touches 20-22)
                const gx = (px ? 1 : 0) - (nx ? 1 : 0)
                const gy = (py ? 1 : 0) - (ny ? 1 : 0)
                const gz = (pz ? 1 : 0) - (nz ? 1 : 0)
                expect(decode(idx)).toEqual([gx, gy, gz]) // encode∘decode identity — the shader sees this
              }
  })

  test('outward directions match the canopy geometry: top→+y, underside→−y, +x face→+x, buried→0', () => {
    expect(decode(leaf_normal_index(false, false, true, false, false, false))).toEqual([0, 1, 0]) // top cell
    expect(decode(leaf_normal_index(false, false, false, true, false, false))).toEqual([0, -1, 0]) // underside
    expect(decode(leaf_normal_index(true, false, false, false, false, false))).toEqual([1, 0, 0]) // +x rim
    expect(decode(leaf_normal_index(false, false, false, false, false, false))).toEqual([0, 0, 0]) // buried → up fallback
    expect(decode(leaf_normal_index(true, true, false, false, false, false))).toEqual([0, 0, 0]) // both x open cancel
  })
})
