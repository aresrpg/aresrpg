// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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
//
// #296 VERIFICATION (2026-07-21 re-report): re-investigated against a fresh live report of the same
// symptom class. `liquid_face_opens_to_air` and every registry block (block_registry*.js) were
// re-audited — every foliage/cross-shape entry (all 3 corals, seaweed, lily_pad, bush, and the rest of
// FLORA_BLOCKS/GATHER_BLOCKS/TREE_BLOCKS) is `class: 'foliage'`, and the fix above already treats that
// class as open uniformly regardless of WHERE in the water column the cell sits or whether the
// neighbor is local or cross-chunk. Could not reproduce a hole with the fixture above (still green) OR
// with two additional angles the original fixture didn't cover — added as permanent regression
// coverage below: a MID-COLUMN fully-submerged foliage cell (water on all 6 sides, not just the top
// layer) and a foliage neighbor reported ACROSS A CHUNK SEAM via the real `store.js` halo (not just a
// same-chunk neighbor). Both hold. The only OTHER underwater "reef" content — `coral_rock_rose/cyan/
// gold`, stamped by the `pool_coral` schematic (gen/schematics/registry_map.js) — is genuinely
// `class: 'solid'` (opaque reef ROCK, not a foliage billboard); a solid cube legitimately displacing
// water and drawing its own faces is correct, not this defect. No code change to mesher.js was needed;
// closing #296 on this evidence.

import { test, expect, describe } from 'bun:test'

import { create_chunk_record, local_index, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../config/block_registry.js'
import { CHUNK_SIZE } from '../config/world_config.js'
import { build_neighbor_halos, coord_key } from '../chunks/store.js'

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

/**
 * Unit-face keys ("x,y,z,face") expanded from every merged quad, scoped to LIQUID-class quads only —
 * a foliage cell's own cross billboards (faces 6/7) share x,y,z with the liquid faces under test and
 * must not pollute the diff/count. Module-scope (not describe-local) so both the coral fixture below
 * and the #296-verification fixtures share one implementation.
 * @param {Uint32Array} quad_buffer @param {number} quad_count
 */
function liquid_unit_faces(quad_buffer, quad_count) {
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

describe('mesh_chunk: #296 verification — two angles the coral/top-layer fixture above never covered', () => {
  const BUSH = /** @type {number} */ (get_block_by_name('bush')?.id)

  test('bush is registered as class "foliage" too (fixture sanity — NOT coral-specific)', () => {
    expect(BUSH).toBeGreaterThan(0)
    expect(get_block_by_id(BUSH)?.class).toBe('foliage')
  })

  test('a generic (non-coral) foliage cell fully SUBMERGED mid-column — water above/below/all 4 sides — opens every one of its 6 faces', () => {
    // Unlike the coral fixture (foliage only ever at the water column's TOP layer), this plant sits in
    // the MIDDLE of a 3-deep pool: pre-fix, all 6 of its neighbors are water|water internal boundaries
    // (baseline emits ZERO faces there); post-fix every one must open, since none of them differ from
    // touching air except that the far side also happens to be water — the standard rule doesn't care.
    /** @param {boolean} with_bush */
    const build = (with_bush) => {
      const chunk = create_chunk_record(0, 0, 0)
      for (let z = 1; z <= 3; z += 1) for (let x = 1; x <= 3; x += 1) place_solid(chunk, x, 0, z, SAND)
      for (let y = 1; y <= 3; y += 1)
        for (let z = 1; z <= 3; z += 1) for (let x = 1; x <= 3; x += 1) chunk.ids[local_index(x, y, z)] = WATER
      if (with_bush) chunk.ids[local_index(2, 2, 2)] = BUSH
      chunk.light.fill(0xf0)
      return chunk
    }
    const base = mesh_chunk(build(false))
    const veg = mesh_chunk(build(true))
    const added = [...liquid_unit_faces(veg.quad_buffer, veg.quad_count)]
      .filter((k) => !liquid_unit_faces(base.quad_buffer, base.quad_count).has(k))
      .sort()
    const removed = [...liquid_unit_faces(base.quad_buffer, base.quad_count)]
      .filter((k) => !liquid_unit_faces(veg.quad_buffer, veg.quad_count).has(k))
      .sort()
    expect(added).toEqual(['1,2,2,0', '2,1,2,2', '2,2,1,4', '2,2,3,5', '2,3,2,3', '3,2,2,1'].sort())
    expect(removed).toEqual([])
  })

  test('a foliage neighbor reported ACROSS A CHUNK SEAM via the real store.js halo opens the same as a local foliage neighbor', () => {
    // Production wiring, not a hand-mocked halo: two real ChunkRecords + the actual build_neighbor_halos
    // from chunks/store.js, so this exercises the SAME resolve() path store.js hands the mesher live.
    const chunk_a = create_chunk_record(0, 0, 0)
    for (let z = 14; z <= 16; z += 1) place_solid(chunk_a, 31, 0, z, SAND)
    for (let y = 1; y <= 2; y += 1) for (let z = 14; z <= 16; z += 1) chunk_a.ids[local_index(31, y, z)] = WATER
    chunk_a.light.fill(0xf0)

    const chunk_b = create_chunk_record(1, 0, 0) // the +x neighbor chunk
    for (let z = 14; z <= 16; z += 1) place_solid(chunk_b, 0, 0, z, SAND)
    for (let y = 1; y <= 2; y += 1) for (let z = 14; z <= 16; z += 1) chunk_b.ids[local_index(0, y, z)] = WATER
    chunk_b.ids[local_index(0, 2, 15)] = BUSH // one boundary cell is foliage, not water
    chunk_b.light.fill(0xf0)

    const records = new Map([
      [coord_key(0, 0, 0), chunk_a],
      [coord_key(1, 0, 0), chunk_b],
    ])
    const halos = build_neighbor_halos((cx, cy, cz) => records.get(coord_key(cx, cy, cz)), 0, 0, 0)

    const { quad_buffer, quad_count } = mesh_chunk(chunk_a, halos)
    const faces = liquid_unit_faces(quad_buffer, quad_count)
    // Local water at (31,2,15) tests its +x neighbor, which resolves through the halo into chunk_b's
    // local (0,2,15) — the BUSH cell. Same-fluid controls on either side (z=14/16, real WATER across
    // the seam) must stay closed — proves the assertion isn't vacuously true.
    expect(faces.has('31,2,15,0')).toBe(true)
    expect(faces.has('31,2,14,0')).toBe(false)
    expect(faces.has('31,2,16,0')).toBe(false)
  })
})
