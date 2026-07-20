// Golden mesher test — liquid faces vs. FOLIAGE neighbors (split out to keep mesher_liquid.test.js
// under the 600-LoC ceiling; same convention as the mesher.test.js / mesher_liquid.test.js split).
//
// Owner symptom (screenshot, live shallows): the water surface is a patchwork with square holes
// exactly where underwater vegetation (kelp/coral cross-quads) grows — hard-edged gaps, seabed
// showing through; open water away from vegetation renders fine. ROOT CAUSE: `liquid_face_opens_to_air`
// (mesher.js) culled a liquid face against ANY non-air neighbor id, including foliage (registry
// `class === 'foliage'`, shape 'cross', no occupancy bit) — so a water voxel touching a coral/kelp
// cell lost its face exactly like it touched a solid. A foliage cell is a thin billboard that never
// covers its cell, so the standard voxel rule (only same-fluid or opaque-solid neighbors cull) must
// treat it as open, same as air.

import { test, expect, describe } from 'bun:test'

import { create_chunk_record, local_index, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../config/block_registry.js'
import { CHUNK_SIZE } from '../config/world_config.js'

import { mesh_chunk } from './mesher.js'
import { decode_quad } from './quad_buffer.js'

const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

/**
 * Places a solid block and sets all three occupancy-axis bits, mirroring what gen/decorators do.
 * @param {import('../chunks/format.js').ChunkRecord} chunk
 * @param {number} x @param {number} y @param {number} z @param {number} block_id
 */
function place_solid(chunk, x, y, z, block_id) {
  chunk.ids[local_index(x, y, z)] = block_id
  set_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x, true)
  set_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, y, true)
  set_occupancy_bit(chunk, 2, x * CHUNK_SIZE + y, z, true)
}

/** @param {Uint32Array} quad_buffer @param {number} quad_count */
function decode_all(quad_buffer, quad_count) {
  /** @type {import('./quad_buffer.js').QuadFields[]} */
  const quads = []
  for (let i = 0; i < quad_count; i += 1) quads.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))
  return quads
}

describe('mesh_chunk: liquid faces stay OPEN against foliage neighbors (WATER-VEGETATION MESH HOLES)', () => {
  // Layout mirrors surface_decorator.js's real placement (a foliage id OVERWRITES what would
  // otherwise be a water voxel — one id per cell, no dual-occupancy): sand floor y=0 (4×4, x,z 2..5);
  // water 2-deep (y=1..2) over the whole 4×4 footprint; ONE interior cell of the TOP water layer,
  // (3,2,3), is replaced with coral_pink. That cell can never emit a liquid face itself (it holds no
  // liquid voxel at all — a foliage cell can't source a water face, it can only stop BLOCKING one),
  // but every water cell still touching it must now cap/wall itself against it: the cell directly
  // below (3,1,3) gains a top cap, and the four horizontal water neighbors gain a side face into the
  // coral — turning the pre-fix "raw hole down to the seabed" into a properly lidded/walled pocket.
  const CORAL = /** @type {number} */ (get_block_by_name('coral_pink')?.id)

  /** @param {{ with_coral: boolean }} opts */
  const build = ({ with_coral }) => {
    const chunk = create_chunk_record(0, 0, 0)
    for (let z = 2; z <= 5; z += 1) for (let x = 2; x <= 5; x += 1) place_solid(chunk, x, 0, z, SAND)
    for (let y = 1; y <= 2; y += 1)
      for (let z = 2; z <= 5; z += 1) for (let x = 2; x <= 5; x += 1) chunk.ids[local_index(x, y, z)] = WATER
    if (with_coral) chunk.ids[local_index(3, 2, 3)] = CORAL // overwrites the water voxel, no occupancy
    chunk.light.fill(0xf0)
    return chunk
  }

  /**
   * Unit-face keys ("x,y,z,face") expanded from every merged quad, scoped to LIQUID-class quads
   * only — the coral cell's own cross billboards (faces 6/7) share x,y,z with the liquid faces under
   * test and must not pollute the diff/count below.
   * @param {Uint32Array} quad_buffer @param {number} quad_count
   */
  const liquid_unit_faces = (quad_buffer, quad_count) => {
    const emitted = new Set()
    for (const q of decode_all(quad_buffer, quad_count)) {
      if (get_block_by_id(q.block_id)?.class !== 'liquid') continue
      const axis = Math.floor(q.face / 2)
      const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
      for (let du = 0; du < q.w; du += 1)
        for (let dv = 0; dv < q.h; dv += 1) {
          const c = [q.x, q.y, q.z]
          c[u_axis] += du
          c[v_axis] += dv
          emitted.add(`${c[0]},${c[1]},${c[2]},${q.face}`)
        }
    }
    return emitted
  }

  test('the coral block is registered as class "foliage" (fixture sanity)', () => {
    expect(CORAL).toBeGreaterThan(0)
    expect(get_block_by_id(CORAL)?.class).toBe('foliage')
  })

  test('the 5 water faces touching the coral cell are emitted — top cap + 4 side walls (were culled pre-fix)', () => {
    const { quad_buffer, quad_count } = mesh_chunk(build({ with_coral: true }))
    const emitted = liquid_unit_faces(quad_buffer, quad_count)
    // The standard voxel rule: a foliage neighbor is open, so every water face that would exist
    // against AIR there must also exist against the coral.
    expect(emitted.has('3,1,3,2')).toBe(true) // top cap: water directly under the coral
    expect(emitted.has('2,2,3,0')).toBe(true) // +x wall: west neighbor facing the coral
    expect(emitted.has('4,2,3,1')).toBe(true) // -x wall: east neighbor facing the coral
    expect(emitted.has('3,2,2,4')).toBe(true) // +z wall: north neighbor facing the coral
    expect(emitted.has('3,2,4,5')).toBe(true) // -z wall: south neighbor facing the coral
  })

  test('no regression + no over-emission: coral variant == baseline liquid faces − the coral cell + the 5 new ones', () => {
    const base_mesh = mesh_chunk(build({ with_coral: false }))
    const coral_mesh = mesh_chunk(build({ with_coral: true }))
    const base_emitted = liquid_unit_faces(base_mesh.quad_buffer, base_mesh.quad_count)
    const coral_emitted = liquid_unit_faces(coral_mesh.quad_buffer, coral_mesh.quad_count)

    const added = [...coral_emitted].filter((k) => !base_emitted.has(k)).sort()
    const removed = [...base_emitted].filter((k) => !coral_emitted.has(k)).sort()
    expect(added).toEqual(['2,2,3,0', '3,1,3,2', '3,2,2,4', '3,2,4,5', '4,2,3,1'].sort())
    expect(removed).toEqual(['3,2,3,2']) // the coral cell's own top — no liquid voxel left there to emit it

    // Exact counts, not just set membership: baseline is the known-good 4×4×2 pool (48 unit liquid
    // faces: one 4×4 top (16) + 32 perimeter side walls, zero bottom against the sand floor).
    expect(base_emitted.size).toBe(48)
    expect(coral_emitted.size).toBe(52) // 48 − 1 removed + 5 added — proves no OVER-emission beyond the fix
  })

  test('reverse: the coral cross billboards themselves still render (emission untouched by the liquid fix)', () => {
    const { quad_buffer, quad_count } = mesh_chunk(build({ with_coral: true }))
    const quads = decode_all(quad_buffer, quad_count)
    const coral_quads = quads.filter((q) => q.block_id === CORAL)
    // coral_pink: cross_pairs 2 → 2 pairs × 2 quads (faces 6/7) = 4 un-merged billboard quads.
    expect(coral_quads.length).toBe(4)
    expect([...coral_quads.map((q) => q.face)].sort()).toEqual([6, 6, 7, 7])
    expect(coral_quads.every((q) => q.x === 3 && q.y === 2 && q.z === 3)).toBe(true)
  })
})
