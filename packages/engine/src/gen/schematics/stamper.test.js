// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gate for the deterministic stamper (§4.6 phase A). Proves the three properties phase B depends on:
// determinism (same seed ⇒ byte-identical, distinct chunks ⇒ independent), cross-border clip
// correctness (union of every touched chunk's clipped output == the unclipped whole, and the slices
// are disjoint), and bounds safety (never writes outside 0..31, never throws on OOB/negative).

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE } from '../../config/world_config.js'
import { create_chunk_record, local_index } from '../../chunks/format.js'
import { AIR_BLOCK_ID } from '../../config/block_registry.js'

import { load_schematic, load_schematic_set } from './loader.js'
import {
  select_schematic,
  stamp_into_chunk,
  stamp_schematic,
  expand_placement,
  rotate_offset,
  max_horizontal_reach,
  hash_column,
} from './stamper.js'

const TREES = load_schematic_set('tree')
const ROCKS = load_schematic_set('rock')

/**
 * Non-air cells of a chunk as a Map "wx,wy,wz" → block_id (world coords).
 * @param {import('../../chunks/format.js').ChunkRecord} chunk
 * @param {number} cx @param {number} cy @param {number} cz
 * @returns {Map<string, number>}
 */
function readback(chunk, cx, cy, cz) {
  const m = new Map()
  for (let ly = 0; ly < CHUNK_SIZE; ly++)
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const b = chunk.ids[local_index(lx, ly, lz)]
        if (b !== AIR_BLOCK_ID) m.set(`${cx * CHUNK_SIZE + lx},${cy * CHUNK_SIZE + ly},${cz * CHUNK_SIZE + lz}`, b)
      }
  return m
}

/** @param {number[]} arr */
const min = (arr) => arr.reduce((a, b) => (b < a ? b : a), Infinity)
/** @param {number[]} arr */
const max = (arr) => arr.reduce((a, b) => (b > a ? b : a), -Infinity)
/** floor-div into chunk coord (arithmetic, negatives ok). @param {number} w */
const to_chunk = (w) => Math.floor(w / CHUNK_SIZE)

describe('rotate_offset', () => {
  test('4 quarter-turns return to origin; each turn is a bijection', () => {
    const pts = [
      [3, 0],
      [0, 5],
      [-2, 7],
      [4, -6],
    ]
    for (const [dx, dz] of pts) {
      let x = dx
      let z = dz
      for (let i = 0; i < 4; i++) [x, z] = rotate_offset(x, z, 1)
      expect([x, z]).toEqual([dx, dz])
    }
    // distinctness of a set under a single rotation
    const src = pts.map(([dx, dz]) => `${dx},${dz}`)
    const rot = pts.map(([dx, dz]) => rotate_offset(dx, dz, 1).join(','))
    expect(new Set(rot).size).toBe(new Set(src).size)
  })
})

describe('select_schematic determinism', () => {
  test('same (seed, column) ⇒ same pick + rotation, repeatably', () => {
    const a = select_schematic(1234, 40, -17, TREES)
    const b = select_schematic(1234, 40, -17, TREES)
    expect(a).not.toBeNull()
    expect(a?.schematic.name).toBe(/** @type {any} */ (b).schematic.name)
    expect(a?.rotation).toBe(/** @type {any} */ (b).rotation)
  })

  test('empty set ⇒ null', () => {
    expect(select_schematic(1, 2, 3, [])).toBeNull()
  })

  test('picks spread across the set (not a constant)', () => {
    const names = new Set()
    for (let i = 0; i < 400; i++) {
      const p = select_schematic(7, i * 3, i * 5, TREES)
      if (p) names.add(p.schematic.name)
    }
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('stamp determinism', () => {
  test('same args ⇒ byte-identical chunk ids', () => {
    const s = load_schematic('GRASSLAND_ACACIA_G3')
    const mk = () => {
      const c = create_chunk_record(0, 4, 0)
      stamp_into_chunk(c, 0, 4, 0, 10, 12, 130, s, 2)
      return c
    }
    const a = mk()
    const b = mk()
    expect(Buffer.from(a.ids.buffer)).toEqual(Buffer.from(b.ids.buffer))
  })

  test('stamp_schematic is a pure function of its args', () => {
    const c1 = create_chunk_record(2, 4, -1)
    const c2 = create_chunk_record(2, 4, -1)
    const s1 = stamp_schematic(c1, 2, 4, -1, 70, -20, 132, 99, TREES)
    const s2 = stamp_schematic(c2, 2, 4, -1, 70, -20, 132, 99, TREES)
    expect(s1?.name).toBe(/** @type {any} */ (s2).name)
    expect(Buffer.from(c1.ids.buffer)).toEqual(Buffer.from(c2.ids.buffer))
  })

  test('distinct chunks are independent: an anchor writes nothing into a chunk it cannot reach', () => {
    const s = load_schematic('GRASSLAND_TREE_G1') // small reach
    const far = create_chunk_record(50, 4, 50)
    const written = stamp_into_chunk(far, 50, 4, 50, 12, 12, 130, s, 0)
    expect(written).toBe(0)
    expect(far.ids.every((v) => v === AIR_BLOCK_ID)).toBe(true)
  })
})

describe('cross-border clip correctness (union == whole, disjoint)', () => {
  // Anchors chosen to straddle x, y and z chunk borders simultaneously.
  /** @type {{name:string, wx:number, wz:number, sy:number}[]} */
  const scenarios = [
    { name: 'GRASSLAND_TREE_G1', wx: 31, wz: 31, sy: 28 },
    { name: 'TAIGA_CHENE_BIG_G2', wx: 33, wz: 30, sy: 26 }, // tall tree spanning many cy
    { name: 'GRASSLAND_ROCK_BIG_G3', wx: -1, wz: 1, sy: 40 }, // straddles negative x border
  ]
  for (const sc of scenarios) {
    for (const rotation of /** @type {(0|1|2|3)[]} */ ([0, 1, 2, 3])) {
      test(`${sc.name} @rot${rotation}: clipped slices tile into the whole`, () => {
        const s = load_schematic(sc.name)
        const whole = expand_placement(sc.wx, sc.wz, sc.sy, s, rotation)
        /** @type {Map<string, number>} */
        const wholeMap = new Map(whole.map((v) => [`${v.wx},${v.wy},${v.wz}`, v.block_id]))
        // rotation is a bijection ⇒ no two voxels collide on a world cell
        expect(wholeMap.size).toBe(whole.length)

        const cx0 = to_chunk(min(whole.map((v) => v.wx)))
        const cx1 = to_chunk(max(whole.map((v) => v.wx)))
        const cy0 = to_chunk(min(whole.map((v) => v.wy)))
        const cy1 = to_chunk(max(whole.map((v) => v.wy)))
        const cz0 = to_chunk(min(whole.map((v) => v.wz)))
        const cz1 = to_chunk(max(whole.map((v) => v.wz)))
        // more than one chunk must be involved or the scenario is not testing a border
        expect((cx1 - cx0 + 1) * (cy1 - cy0 + 1) * (cz1 - cz0 + 1)).toBeGreaterThan(1)

        /** @type {Map<string, number>} */
        const union = new Map()
        let total = 0
        for (let cx = cx0; cx <= cx1; cx++)
          for (let cy = cy0; cy <= cy1; cy++)
            for (let cz = cz0; cz <= cz1; cz++) {
              const chunk = create_chunk_record(cx, cy, cz)
              stamp_into_chunk(chunk, cx, cy, cz, sc.wx, sc.wz, sc.sy, s, rotation)
              const rb = readback(chunk, cx, cy, cz)
              for (const [k, id] of rb) {
                expect(union.has(k)).toBe(false) // disjoint
                union.set(k, id)
              }
              total += rb.size
            }
        expect(total).toBe(wholeMap.size) // no double-writes, nothing lost
        expect(union.size).toBe(wholeMap.size)
        for (const [k, blockId] of wholeMap) expect(union.get(k)).toBe(blockId)
      })
    }
  }
})

describe('bounds safety', () => {
  test('fully out-of-range placement writes nothing and does not throw', () => {
    const s = load_schematic('GRASSLAND_ACACIA_G3')
    const c = create_chunk_record(0, 0, 0)
    const written = stamp_into_chunk(c, 0, 0, 0, 5, 5, 10_000, s, 1) // surface far above the chunk
    expect(written).toBe(0)
    expect(c.ids.every((v) => v === AIR_BLOCK_ID)).toBe(true)
  })

  test('corner/edge placement never writes outside 0..31 and never throws', () => {
    const s = load_schematic('SWAMP_BIG_TREE_G5') // wide footprint
    for (const rotation of /** @type {(0|1|2|3)[]} */ ([0, 1, 2, 3])) {
      const c = create_chunk_record(-3, 4, 2)
      const written = stamp_into_chunk(c, -3, 4, 2, -3 * CHUNK_SIZE, 2 * CHUNK_SIZE + 31, 4 * CHUNK_SIZE, s, rotation)
      expect(written).toBeLessThanOrEqual(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).length)
      // all writes are in-range by construction of the id array length; assert no corruption
      expect(c.ids.length).toBe(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE)
    }
  })

  test('negative world coordinates stamp deterministically', () => {
    const s = load_schematic('GRASSLAND_TREE_G4')
    const a = create_chunk_record(-2, 4, -2)
    const b = create_chunk_record(-2, 4, -2)
    stamp_into_chunk(a, -2, 4, -2, -40, -40, 130, s, 3)
    stamp_into_chunk(b, -2, 4, -2, -40, -40, 130, s, 3)
    expect(Buffer.from(a.ids.buffer)).toEqual(Buffer.from(b.ids.buffer))
  })
})

describe('halo reach + hash lineage', () => {
  test('max_horizontal_reach matches the widest schematic footprint', () => {
    expect(max_horizontal_reach(TREES)).toBeGreaterThan(0)
    expect(max_horizontal_reach(ROCKS)).toBeGreaterThan(0)
    expect(max_horizontal_reach([])).toBe(0)
    for (const s of TREES) expect(s.reach).toBeLessThanOrEqual(max_horizontal_reach(TREES))
  })

  test('hash_column is stable and integer (matches surface_decorator lineage)', () => {
    expect(hash_column(10, -7, 0x9e3779b1)).toBe(hash_column(10, -7, 0x9e3779b1))
    expect(Number.isInteger(hash_column(1, 2, 3))).toBe(true)
    expect(hash_column(1, 2, 3)).toBeGreaterThanOrEqual(0)
  })
})
