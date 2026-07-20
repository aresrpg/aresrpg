// Golden mesher tests — LIQUID + surface-coverage suites (split out of mesher.test.js to keep both
// files under the 600-LoC ceiling; pure move, no behavior change). Covers:
//  1. Liquid surface pass: a pool emits ONE merged water top, zero liquid side/bottom faces, and
//     never occludes the solids beneath it.
//  2. Shoreline watertightness: water meeting a taller beach cliff — the cliff faces the water
//     reveals are all emitted (no see-through void), the seabed under the pool stays meshed.
//  3. +y surface coverage invariant: the emitted top faces EXACTLY equal the set the chunk's own
//     occupancy/ids imply (no striped/missing rows, no overlap, no extras) — for solid AND liquid,
//     on hand-built and real generated terrain, with and without neighbor halos.
// (The box / height-step / island-watertightness / halo-seam / cross-foliage geometry goldens
// stay in mesher.test.js.)

import { test, expect, describe } from 'bun:test'

import { create_chunk_record, get_occupancy_bit, local_index, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../config/block_registry.js'
import { CHUNK_SIZE } from '../config/world_config.js'
import { generate_world_chunk } from '../gen/world_gen.js'
import { build_neighbor_halos, coord_key } from '../chunks/store.js'

import { mesh_chunk } from './mesher.js'
import { LEAF_SPRITE_IDS, SNOW_ID } from './leaf_sprites.js'
import { decode_quad } from './quad_buffer.js'

const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

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

describe('mesh_chunk: liquid boundary pass emits watertight tops + air-facing sides (v3 hydrology support fix)', () => {
  // v3 hydrology support fix (2026-07-03): the liquid pass now emits a face wherever a water cell's
  // neighbor is AIR — top at the surface PLUS sides/bottom where water meets air — so sloped/terraced
  // rivers render watertight (no dark step voids). Faces against solid/water stay unemitted. Re-blessed
  // from the v1 "top-only" goldens below.
  // Layout: sand floor (y=0, full 32×32) + a 4×4 water pool (x,z in 2..5) three deep (y 1..3), air
  // above and all around. Emitted water faces: ONE merged 4×4 +y top (y=3); the 4 vertical pool walls
  // (each a 4-wide × 3-tall air-facing sheet on faces 0/1/4/5); NO -y bottom (the pool sits on sand).
  const chunk = create_chunk_record(0, 0, 0)
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) place_solid(chunk, x, 0, z, SAND)
  }
  for (let y = 1; y <= 3; y += 1) {
    for (let z = 2; z <= 5; z += 1) {
      for (let x = 2; x <= 5; x += 1) chunk.ids[local_index(x, y, z)] = WATER // ids only, no occupancy
    }
  }
  chunk.light.fill(0xf0)

  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  const quads = decode_all(quad_buffer, quad_count)
  const water = quads.filter((q) => q.block_id === WATER)
  const emitted = emitted_unit_faces(quad_buffer, quad_count)

  test('exactly one merged 4×4 water top quad at the surface level (face 2, flat AO)', () => {
    const tops = water.filter((q) => q.face === 2)
    expect(tops.length).toBe(1)
    expect(tops[0]).toMatchObject({ x: 2, y: 3, z: 2, w: 4, h: 4, face: 2, block_id: WATER })
    expect(tops[0].ao).toEqual([3, 3, 3, 3])
  })

  test('all four air-facing pool walls are emitted (faces 0/1/4/5), each covering the 4×3 wet edge', () => {
    // The pool's outer ring of water cells all open to air laterally, so every wall unit face y1..3
    // on the pool perimeter is emitted at the water voxel's OWN coord (GPU applies the +x/+z push).
    for (let y = 1; y <= 3; y += 1) {
      for (let s = 2; s <= 5; s += 1) {
        expect(emitted.has(`5,${y},${s},0`)).toBe(true) // +x wall (east edge x=5)
        expect(emitted.has(`2,${y},${s},1`)).toBe(true) // -x wall (west edge x=2)
        expect(emitted.has(`${s},${y},5,4`)).toBe(true) // +z wall (south edge z=5)
        expect(emitted.has(`${s},${y},2,5`)).toBe(true) // -z wall (north edge z=2)
      }
    }
    // Every liquid quad is flat-AO (water carries no AO in v3).
    expect(water.every((q) => q.ao[0] === 3 && q.ao[1] === 3 && q.ao[2] === 3 && q.ao[3] === 3)).toBe(true)
  })

  test('no liquid bottom (-y) face is emitted where the pool rests on solid sand', () => {
    expect(water.some((q) => q.face === 3)).toBe(false) // floor is sand → no water bottom
  })

  test('the sand floor beneath the water stays meshed (liquids never occlude solids)', () => {
    const floor = quad_covering(quads, 3, 0, 3, 2) // sand top under the pool center
    expect(floor?.block_id).toBe(SAND)
    expect(emitted.has('3,0,3,2')).toBe(true)
  })
})

describe('mesh_chunk: liquid bottom face emitted where water overhangs air (v3 hydrology support fix)', () => {
  // A single water cell floating with AIR directly below (a synthetic support-less cell — the
  // hydrostatic gate proves gen never produces these, but the mesher must still draw all air-facing
  // faces of whatever ids it is handed). It must emit all 6 faces incl. the -y bottom (face 3).
  const chunk = create_chunk_record(0, 0, 0)
  chunk.ids[local_index(8, 8, 8)] = WATER
  chunk.light.fill(0xf0)
  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  const water = decode_all(quad_buffer, quad_count).filter((q) => q.block_id === WATER)

  test('an isolated water voxel emits all six unit faces incl. -y bottom (face 3)', () => {
    expect(water.length).toBe(6)
    expect([...water.map((q) => q.face)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    // Every face is the unit cell at the voxel's own coord (GPU pushes 0/2/4 to the far plane).
    expect(water.every((q) => q.x === 8 && q.y === 8 && q.z === 8 && q.w === 1 && q.h === 1)).toBe(true)
  })
})

describe('mesh_chunk: shoreline is watertight — no see-through void where water meets a beach', () => {
  // Symptom: hard BLACK rims/voids at shorelines. A data probe over real coastal terrain (54k
  // water columns) found ZERO water|air horizontal interfaces and ZERO missing solid faces — the
  // black is 100% M0 light (submerged cells are sun=0 in fill_simple_light, so every solid face the
  // water reveals encodes black): a render/light-lane issue, NOT a mesher geometry gap. This golden
  // pins the geometry so a future change can't silently open a real void. Layout: sand seabed at
  // y=0; water pool x,z 0..7 y 1..3 (surface y=3); beach shelf x 8..11 solid to y=5 (a cliff two
  // blocks TALLER than the surface). The water's +x edge (x=7) abuts the cliff (x=8) → liquid|solid;
  // the cliff's -x faces must all be emitted (water carries no occupancy bit, so sand-vs-water reads
  // as sand-vs-air and IS meshed). No liquid side/bottom faces exist at v1.
  const chunk = create_chunk_record(0, 0, 0)
  for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) place_solid(chunk, x, 0, z, SAND) // seabed floor
  for (let y = 1; y <= 3; y += 1)
    for (let z = 0; z <= 7; z += 1) for (let x = 0; x <= 7; x += 1) chunk.ids[local_index(x, y, z)] = WATER // pool, no occupancy
  for (let y = 1; y <= 5; y += 1)
    for (let z = 0; z <= 7; z += 1) for (let x = 8; x <= 11; x += 1) place_solid(chunk, x, y, z, SAND) // beach shelf (cliff)
  chunk.light.fill(0xf0)

  const { quad_buffer, quad_count } = mesh_chunk(chunk)
  const quads = decode_all(quad_buffer, quad_count)
  const water = quads.filter((q) => get_block_by_id(q.block_id)?.class === 'liquid')
  const emitted = emitted_unit_faces(quad_buffer, quad_count)

  test('water surface is one merged 8×8 top quad (face 2)', () => {
    const tops = water.filter((q) => q.face === 2)
    expect(tops.length).toBe(1)
    expect(tops[0]).toMatchObject({ x: 0, y: 3, z: 0, w: 8, h: 8, face: 2, block_id: WATER })
  })

  test('the water side facing the SOLID cliff (+x, x=7) is NOT emitted — solid draws that face, not water', () => {
    // v3 hydrology support fix: liquid sides emit only against AIR. The pool's +x edge abuts the
    // cliff (solid), so no water +x face exists there (water|solid is the cliff's job); the pool's
    // other three edges open to boundary air, so those water walls DO emit. This is the watertight
    // interface — no double-drawn water-vs-solid sheet, no see-through gap.
    for (let y = 1; y <= 3; y += 1) for (let z = 0; z <= 7; z += 1) expect(emitted.has(`7,${y},${z},0`)).toBe(false) // no water +x into cliff
    // The open (air-facing) pool walls ARE emitted (spot-check the -x west edge, x=0).
    for (let y = 1; y <= 3; y += 1) for (let z = 0; z <= 7; z += 1) expect(emitted.has(`0,${y},${z},1`)).toBe(true)
    expect(water.some((q) => q.face !== 2)).toBe(true) // air-facing water walls now exist (were absent in v1)
  })

  test('the beach cliff facing the water (x=8 -x, y 1..5) is fully emitted — no water-edge void', () => {
    // The exact interface the symptom points at: the solid wall behind/beside the water surface.
    // Underwater (y 1..3, faces water) + above the waterline (y 4..5, faces air) — every unit face
    // must be present; a single missing one would be a true see-through hole. Plus the shelf top cap.
    for (let y = 1; y <= 5; y += 1) for (let z = 0; z <= 7; z += 1) expect(emitted.has(`8,${y},${z},1`)).toBe(true)
    for (let z = 0; z <= 7; z += 1) for (let x = 8; x <= 11; x += 1) expect(emitted.has(`${x},5,${z},2`)).toBe(true) // shelf top cap
  })

  test('the seabed floor under the water is fully meshed (the surface reveals solid, never void)', () => {
    for (let z = 0; z <= 7; z += 1)
      for (let x = 0; x <= 7; x += 1) {
        expect(emitted.has(`${x},0,${z},2`)).toBe(true) // sand +y top under every water column
        expect(quad_covering(quads, x, 0, z, 2)?.block_id).toBe(SAND)
      }
  })
})

// Coverage invariant — permanent guard for the striped/missing-top-faces class of bug (a mask
// off-by-one drops whole rows of +y faces). Asserts the emitted top faces EXACTLY equal the set
// that should be emitted, derived from the chunk's own occupancy/ids + the same above-cell rule the
// mesher uses (independent of binary_greedy's bit shifts): none missing, none overlapping, no
// extras. Solids derive from OCCUPANCY not class — the decorator writes leaves as class:'solid'
// WITHOUT occupancy, and the solid pass is occupancy-driven.

/**
 * @param {import('../chunks/format.js').ChunkRecord} chunk
 * @param {{ quad_buffer: Uint32Array, quad_count: number }} mesh
 * @param {'solid'|'liquid'} klass
 * @param {import('../mesh/mesher.js').NeighborHalos} [halos] boundary lookups the mesh used, if any
 */
function assert_face2_coverage(chunk, mesh, klass, halos) {
  /** @param {number} id — D164-B: leaves are class 'solid' but DON'T occlude (see the cull view). */
  const is_solid_id = (id) => id !== 0 && get_block_by_id(id)?.class === 'solid' && !LEAF_SPRITE_IDS.has(id)
  // D164: leaf blocks keep solid OCCUPANCY (collision/culling) but render as SPRITE CLUSTERS — they
  // legitimately emit zero +y cube faces, so the coverage oracle skips them (imported single source).
  /** @param {number} x @param {number} y @param {number} z */
  const is_leaf = (x, y, z) => LEAF_SPRITE_IDS.has(chunk.ids[local_index(x, y, z)])
  // Canopy SNOW (snow resting on a leaf) renders as a deposit sprite — its cube faces are suppressed
  // too (D164, reported: "snow block in grey cardboards"), so the oracle skips it like the leaves.
  /** @param {number} x @param {number} y @param {number} z */
  const is_canopy_snow = (x, y, z) => chunk.ids[local_index(x, y, z)] === SNOW_ID && y > 0 && is_leaf(x, y - 1, z)
  /** @param {number} x @param {number} y @param {number} z */
  const occ = (x, y, z) => get_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x)
  /** block id of the cell above the top layer (across the +y chunk boundary). @param {number} x @param {number} z */
  const above_top = (x, z) => (halos && halos.block ? halos.block(x, CHUNK_SIZE, z) : 0)

  /** @type {Set<string>} */
  const expected = new Set()
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        if (klass === 'solid') {
          if (!occ(x, y, z) || is_leaf(x, y, z) || is_canopy_snow(x, y, z)) continue
          // D164-B culling relaxation: a LEAF above does NOT occlude (leaves render as see-through
          // sprites) — in-chunk via is_leaf, cross-chunk via is_solid_id's leaf exclusion.
          const above_solid =
            y + 1 < CHUNK_SIZE ? occ(x, y + 1, z) && !is_leaf(x, y + 1, z) : is_solid_id(above_top(x, z))
          if (!above_solid) expected.add(`${x},${y},${z}`)
        } else {
          const id = chunk.ids[local_index(x, y, z)]
          if (id === 0 || get_block_by_id(id)?.class !== 'liquid') continue
          const above = y + 1 < CHUNK_SIZE ? chunk.ids[local_index(x, y + 1, z)] : above_top(x, z)
          if (above === 0) expected.add(`${x},${y},${z}`)
        }
      }
  const quads = decode_all(mesh.quad_buffer, mesh.quad_count)
  /** @type {Map<string, number>} */
  const tally = new Map()
  for (const q of quads) {
    if (q.face !== 2 || get_block_by_id(q.block_id)?.class !== klass) continue
    // [LEAVES-2X Rung 2] leaves are registry class 'solid' but now DUAL-EMIT an opaque CUBE shell (the far
    // 'canopy' representation) alongside their sprites — those leaf cube tops are legitimate quads, but this
    // oracle guards the SOLID SURFACE (trunks/ground), which `expected` already builds leaf-free. Exclude
    // leaf ids from the tally too so the two stay comparable (leaf-shell coverage is proven by the mesher
    // dual-emit parity test, not this surface invariant).
    if (klass === 'solid' && LEAF_SPRITE_IDS.has(q.block_id)) continue
    for (let du = 0; du < q.w; du += 1)
      for (let dv = 0; dv < q.h; dv += 1) {
        const key = `${q.x + du},${q.y},${q.z + dv}`
        tally.set(key, (tally.get(key) ?? 0) + 1)
      }
  }

  for (const [, count] of tally) expect(count).toBe(1) // no overlapping quads
  expect([...tally.keys()].sort()).toEqual([...expected].sort()) // no missing (stripes), no extras
}

/** The 6 cube-face directions: index = face id, value = neighbor offset. 0=+x 1=-x 2=+y 3=-y 4=+z 5=-z. */
const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/**
 * WATERTIGHT-WATER invariant (v3 hydrology support fix): for a meshed chunk, the emitted LIQUID
 * quads must cover EXACTLY the set of water-cell faces whose neighbor (halo-resolved) is AIR — all
 * six directions — with no face missing, none overlapping, and NONE against solid or water (those
 * are excluded from the expected set, so an extra there fails the equality). Faces are keyed at the
 * water voxel's OWN local coord + face id (the GPU applies the +1 positive-face push), matching how
 * the mesher writes them. This is the permanent guard for the terrace-step "dark void" defect.
 * @param {import('../chunks/format.js').ChunkRecord} chunk
 * @param {{ quad_buffer: Uint32Array, quad_count: number }} mesh
 * @param {import('../mesh/mesher.js').NeighborHalos} [halos]
 */
function assert_watertight_liquid(chunk, mesh, halos) {
  /** @param {number} x @param {number} y @param {number} z */
  const id_at = (x, y, z) => {
    if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE)
      return chunk.ids[local_index(x, y, z)]
    return halos && halos.block ? halos.block(x, y, z) : 0
  }
  /** @param {number} id */
  const is_liquid = (id) => id !== 0 && get_block_by_id(id)?.class === 'liquid'

  /** @type {Set<string>} keys "x,y,z,face" — every air-facing water face. */
  const expected = new Set()
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        if (!is_liquid(chunk.ids[local_index(x, y, z)])) continue
        for (let f = 0; f < 6; f += 1) {
          const [dx, dy, dz] = FACE_DIRS[f]
          if (id_at(x + dx, y + dy, z + dz) === 0) expected.add(`${x},${y},${z},${f}`)
        }
      }

  const quads = decode_all(mesh.quad_buffer, mesh.quad_count)
  /** @type {Map<string, number>} */
  const tally = new Map()
  for (const q of quads) {
    if (q.face > 5 || get_block_by_id(q.block_id)?.class !== 'liquid') continue
    const axis = Math.floor(q.face / 2)
    const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
    for (let du = 0; du < q.w; du += 1)
      for (let dv = 0; dv < q.h; dv += 1) {
        const c = [q.x, q.y, q.z]
        c[u_axis] += du
        c[v_axis] += dv
        const key = `${c[0]},${c[1]},${c[2]},${q.face}`
        tally.set(key, (tally.get(key) ?? 0) + 1)
      }
  }

  for (const [, count] of tally) expect(count).toBe(1) // no overlapping liquid quads
  expect([...tally.keys()].sort()).toEqual([...expected].sort()) // exact: none missing, none extra
}

describe('mesh_chunk: +y surface coverage invariant (no striped/missing top faces)', () => {
  test('flat solid slab: Σ(w×h) of +y quads == 1024, every column covered exactly once', () => {
    const build_slab = () => {
      const c = create_chunk_record(0, 0, 0)
      for (let y = 0; y < 8; y += 1)
        for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) place_solid(c, x, y, z, STONE)
      c.light.fill(0xf0)
      return c
    }

    /** @param {ReturnType<typeof mesh_chunk>} mesh */
    const assert_full_top = (mesh) => {
      const quads = decode_all(mesh.quad_buffer, mesh.quad_count)
      const grid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
      let area = 0
      for (const q of quads) {
        if (q.face !== 2) continue
        area += q.w * q.h
        for (let du = 0; du < q.w; du += 1)
          for (let dv = 0; dv < q.h; dv += 1) grid[(q.z + dv) * CHUNK_SIZE + (q.x + du)] += 1
      }
      expect(area).toBe(CHUNK_SIZE * CHUNK_SIZE) // 1024
      expect([...grid].every((n) => n === 1)).toBe(true) // exactly-once, no gaps, no overlap
    }

    const slab = build_slab()
    assert_full_top(mesh_chunk(slab)) // without halos
    // With halos: every neighbor is an identical slab — the y=7 top still opens to air above, so
    // coverage must be unchanged (proves the halo path doesn't wrongly cull/duplicate the surface).
    const halos = build_neighbor_halos(() => slab, 0, 0, 0)
    assert_full_top(mesh_chunk(slab, halos))
  })

  test('real world chunk (0,4,0) solid surface: exact coverage, with and without halos', () => {
    const chunk = generate_world_chunk(0, 4, 0)
    assert_face2_coverage(chunk, mesh_chunk(chunk), 'solid')

    /** @type {Map<string, import('../chunks/format.js').ChunkRecord>} */
    const cache = new Map()
    /** @param {number} cx @param {number} cy @param {number} cz */
    const get_rec = (cx, cy, cz) => {
      const k = coord_key(cx, cy, cz)
      if (!cache.has(k)) cache.set(k, generate_world_chunk(cx, cy, cz))
      return cache.get(k)
    }
    const halos = build_neighbor_halos(get_rec, 0, 4, 0)
    assert_face2_coverage(chunk, mesh_chunk(chunk, halos), 'solid', halos)
  })

  test('liquid surface coverage incl. the y=31 chunk-top boundary (halo-detected air above)', () => {
    // Water surface both mid-chunk (y=6) and pinned to the top boundary (y=31); the latter needs
    // the halo to see the all-air chunk above.
    const chunk = create_chunk_record(0, 0, 0)
    for (let z = 4; z <= 7; z += 1) {
      for (let x = 4; x <= 7; x += 1) {
        for (let y = 0; y <= 6; y += 1) chunk.ids[local_index(x, y, z)] = WATER // surface at y=6
        for (let y = 28; y <= 31; y += 1) chunk.ids[local_index(x, y, z)] = WATER // surface at y=31
      }
    }
    chunk.light.fill(0xf0)
    const air_above = create_chunk_record(0, 1, 0) // all air → cell above the y=31 water is air

    assert_face2_coverage(chunk, mesh_chunk(chunk), 'liquid') // isolated: top boundary reads air too
    const halos = build_neighbor_halos((cx, cy, cz) => (cy === 1 ? air_above : undefined), 0, 0, 0)
    assert_face2_coverage(chunk, mesh_chunk(chunk, halos), 'liquid', halos)
  })

  test('real coastal chunk: liquids are WATERTIGHT — every air-facing water face emitted, none vs solid/water', () => {
    // v3 hydrology support fix: a real generated sea-surface chunk (cx=-14, cy=3 holds the y=127 water
    // surface). On REAL terrain (not just a hand-built pool) the liquid pass must be watertight in all
    // six directions: every water face whose neighbor is AIR gets exactly one quad, and NO liquid face
    // is emitted against solid (double-draw) or water (internal). This is the permanent guard for the
    // terrace-step "disconnected sheet / dark void" defect (item B). toBeGreaterThan guards a no-op if
    // the coast ever drifts off these coords.
    const [cx, cy, cz] = [-14, 3, -5]
    const chunk = generate_world_chunk(cx, cy, cz)
    // Cache neighbor gen (same pattern as the (0,4,0) test above): the halo path queries neighbor
    // records per boundary cell, so an uncached `generate_world_chunk` callback re-generates the
    // same ~11 chunks thousands of times. Harmless at the old ~1ms/chunk heightfield; with the
    // GEN_VERSION 2 unified-density gen (~2× cost) the redundant regen alone blew the 5s test timeout
    // (the mesh itself is 54ms). Memoizing collapses it to 11 gens — no invariant change.
    /** @type {Map<string, import('../chunks/format.js').ChunkRecord>} */
    const halo_cache = new Map()
    const get_halo_rec = (/** @type {number} */ gx, /** @type {number} */ gy, /** @type {number} */ gz) => {
      const k = coord_key(gx, gy, gz)
      if (!halo_cache.has(k)) halo_cache.set(k, generate_world_chunk(gx, gy, gz))
      return halo_cache.get(k)
    }
    const halos = build_neighbor_halos(get_halo_rec, cx, cy, cz)
    const mesh = mesh_chunk(chunk, halos)
    assert_face2_coverage(chunk, mesh, 'liquid', halos) // tops still exactly cover the surface
    assert_watertight_liquid(chunk, mesh, halos) // + all air-facing sides/bottom, none vs solid/water
    const liquid_quads = decode_all(mesh.quad_buffer, mesh.quad_count).filter(
      (q) => get_block_by_id(q.block_id)?.class === 'liquid'
    )
    expect(liquid_quads.length).toBeGreaterThan(0) // this open-ocean chunk is surrounded → tops only, still watertight
  })

  test('terraced river (item B): each step riser + floor is a watertight water sheet, no dark void', () => {
    // The reported defect (item B): a sloped river rendered as disconnected sheets with dark voids at
    // each terrace step, because the v1 liquid pass emitted TOP faces only. Reproduce a 3-step river:
    // solid staircase (stone) descending in +x, one water cell riding each tread with air above and
    // an OPEN +x front where the tread drops to the next (lower) step. Pre-fix, each step's water was
    // a floating top with a see-through gap down its front; post-fix the front riser (+x, face 0) and,
    // at the lowest exposed lip, the underside are emitted → the sheet is continuous and watertight.
    const chunk = create_chunk_record(0, 0, 0)
    // Steps at x-bands [0..3],[4..7],[8..11] with tread tops at y=5,4,3 and a water cell one above each.
    const step_top = [5, 4, 3]
    for (let s = 0; s < 3; s += 1) {
      const x0 = s * 4
      for (let x = x0; x <= x0 + 3; x += 1)
        for (let z = 8; z <= 11; z += 1) {
          for (let y = 0; y <= step_top[s]; y += 1) place_solid(chunk, x, y, z, STONE) // solid tread
          chunk.ids[local_index(x, step_top[s] + 1, z)] = WATER // water riding the tread (no occupancy)
        }
    }
    chunk.light.fill(0xf0)
    const mesh = mesh_chunk(chunk)
    assert_watertight_liquid(chunk, mesh) // every air-facing water face covered exactly once, none vs solid
    const water = decode_all(mesh.quad_buffer, mesh.quad_count).filter(
      (q) => get_block_by_id(q.block_id)?.class === 'liquid'
    )
    // The exposed step FRONT: the upper two steps' water (y=6 at x=3, y=5 at x=7) drops onto the next
    // step whose water is a block lower, so the front (+x) neighbor is AIR → a riser face is emitted.
    const emitted = emitted_unit_faces(mesh.quad_buffer, mesh.quad_count)
    for (let z = 8; z <= 11; z += 1) {
      expect(emitted.has(`3,6,${z},0`)).toBe(true) // step-0 water front riser (into the drop)
      expect(emitted.has(`7,5,${z},0`)).toBe(true) // step-1 water front riser
    }
    expect(water.some((q) => q.face === 0)).toBe(true) // risers exist (were missing pre-fix → the void)
    expect(water.length).toBeGreaterThan(3) // more than just the 3 merged tops
  })
})

describe('mesh_chunk: no phantom water walls at a STREAMING SEAM (ocean-hiccup / "old TV" fix)', () => {
  // 2026-07-03 — the water shader produced a chunk hiccup reading like old-TV static: two isolated
  // vertical striped panels floating mid-ocean. ROOT CAUSE (gen-scan + live confirmed): open ocean is
  // CONTINUOUS across chunk seams (water=SEA_LEVEL both sides), but while a neighbor chunk is still
  // STREAMING, its cells read as air (0) via the halo, so every ocean voxel on the seam edge emits a
  // vertical SIDE face into that phantom air → a cascade-striped wall. FIX: a liquid side/bottom face
  // into a NOT-resident neighbor is treated as water (suppressed); the TOP surface is never suppressed.
  //
  // Layout: an ocean SLAB — the WHOLE chunk is water at y=0..3 over a sand floor at y=-… (we just fill
  // the chunk edges with water so the +x edge (x=31) faces the +x neighbor chunk). We mesh it three
  // ways: (a) isolation — old behavior, edge emits; (b) with a NOT-resident +x neighbor — the phantom
  // wall is suppressed; (c) with a RESIDENT AIR +x neighbor — a genuine water|air edge still emits.
  const ocean = create_chunk_record(0, 0, 0)
  for (let y = 0; y <= 3; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) ocean.ids[local_index(x, y, z)] = WATER
    }
  }
  ocean.light.fill(0xf0)

  /** +x-edge (x=31) side faces (face 0) emitted by a given mesh. */
  const east_wall_faces = (/** @type {ReturnType<typeof mesh_chunk>} */ mesh) => {
    const emitted = emitted_unit_faces(mesh.quad_buffer, mesh.quad_count)
    let n = 0
    for (let y = 0; y <= 3; y += 1) for (let z = 0; z < CHUNK_SIZE; z += 1) if (emitted.has(`31,${y},${z},0`)) n += 1
    return n
  }

  test('a NOT-resident neighbor suppresses the seam wall (no phantom panel)', () => {
    // Halo whose get_record always returns undefined → the +x neighbor is "streaming, not resident".
    const halos = build_neighbor_halos(() => undefined, 0, 0, 0)
    const mesh = mesh_chunk(ocean, halos)
    expect(east_wall_faces(mesh)).toBe(0) // ZERO +x side faces at the seam — the wall is gone
  })

  test('a RESIDENT AIR neighbor still emits the genuine water|air wall (watertightness preserved)', () => {
    // A resident neighbor chunk that is entirely AIR (empty record) — a real water-meets-air edge.
    const air_east = create_chunk_record(1, 0, 0) // all ids 0 (air), resident
    const halos = build_neighbor_halos((cx) => (cx === 1 ? air_east : undefined), 0, 0, 0)
    const mesh = mesh_chunk(ocean, halos)
    expect(east_wall_faces(mesh)).toBe(CHUNK_SIZE * 4) // every seam-edge water cell (32×4) walls off
  })

  test('the TOP surface is emitted regardless of a not-resident neighbor (no hole in the ocean)', () => {
    const halos = build_neighbor_halos(() => undefined, 0, 0, 0)
    const mesh = mesh_chunk(ocean, halos)
    const emitted = emitted_unit_faces(mesh.quad_buffer, mesh.quad_count)
    // The whole y=3 surface opens to air above (no +y neighbor resident, but top is never suppressed).
    for (let z = 0; z < CHUNK_SIZE; z += 1) expect(emitted.has(`${CHUNK_SIZE - 1},3,${z},2`)).toBe(true)
  })

  test('isolation (no halos) keeps the old behavior — seam edge reads air and emits', () => {
    const mesh = mesh_chunk(ocean) // no halos → out-of-range = air (backward compat)
    expect(east_wall_faces(mesh)).toBe(CHUNK_SIZE * 4)
  })
})
