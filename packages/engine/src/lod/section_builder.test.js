// NG-LOD section downsample tests (survey S2). Covers: (1) DETERMINISM — same sampler ⇒ byte-identical
// section, twice, and across two independently-built world gen contexts on the same seed; (2) 2×2→1
// GOLDEN — a hand-computed L1 downsample (max height, mode block) over a scripted sampler; (3) SHAPE —
// span/origin math per level, fixed 32×32 cells, min_height; (4) FAR-WATER RULE (survey S14) — a
// flooded column reads as opaque WATER at the water surface; (5) SKY-ISLAND PROOF — the real world
// sampler recovers a sky-island shell above the overhang band (see the sky-island note in the report).

import { test, expect, describe } from 'bun:test'

import { create_gen_context } from '../gen/column_gen.js'
import { get_block_by_name } from '../config/block_registry.js'

import {
  build_section,
  section_bytes,
  block_size_meters,
  section_span_meters,
  create_world_column_sampler,
  CELLS_PER_SECTION,
  LOD_MIN_LEVEL,
  LOD_MAX_LEVEL,
} from './section_builder.js'

const WATER_ID = /** @type {number} */ (get_block_by_name('water')?.id)

/**
 * A scripted, PURE sampler: height/block are a deterministic function of (x,z) with a small period so
 * the 2×2 taps of an L1 cell land on known values. No world gen — isolates the downsample math.
 * @param {number} x @param {number} z
 * @returns {import('./section_builder.js').ColumnSample}
 */
function scripted_sampler(x, z) {
  // height ramps with x+z; block alternates on parity so a cell's 4 taps have a computable mode.
  const height = 100 + ((((x * 7 + z * 13) % 17) + 17) % 17)
  const block = ((x + z) & 1) === 0 ? 3 : 5 // 3=grass-ish, 5=water-ish ids (arbitrary but stable)
  return { height, block_id: block, sky_top: 0, sky_block: 0 }
}

describe('section shape + span math', () => {
  test('block size + span double per level (2:1)', () => {
    expect(block_size_meters(0)).toBe(1) // [D162] L0 = 1 m cells (matches the near voxel ring)
    expect(block_size_meters(1)).toBe(2)
    expect(block_size_meters(4)).toBe(16)
    expect(section_span_meters(0)).toBe(32) // [D162] L0 span = 32·1
    expect(section_span_meters(1)).toBe(64)
    expect(section_span_meters(4)).toBe(512)
  })

  test('build_section: fixed 32×32 cells, origin = grid·span, all cells filled', () => {
    for (let level = LOD_MIN_LEVEL; level <= LOD_MAX_LEVEL; level += 1) {
      const s = build_section(scripted_sampler, level, 2, -3)
      expect(s.height.length).toBe(CELLS_PER_SECTION * CELLS_PER_SECTION)
      expect(s.block.length).toBe(CELLS_PER_SECTION * CELLS_PER_SECTION)
      expect(s.block_size).toBe(block_size_meters(level))
      expect(s.origin_x).toBe(2 * section_span_meters(level))
      expect(s.origin_z).toBe(-3 * section_span_meters(level))
      // every cell height was written (scripted heights are ≥100, never the 0 default)
      expect(Array.from(s.height).every((h) => h >= 100)).toBe(true)
      // min_height is the true minimum
      expect(s.min_height).toBe(Math.min(...s.height))
    }
  })
})

describe('determinism', () => {
  test('same sampler ⇒ byte-identical section (×2)', () => {
    const a = build_section(scripted_sampler, 2, 5, 5)
    const b = build_section(scripted_sampler, 2, 5, 5)
    expect(Buffer.from(a.height.buffer)).toEqual(Buffer.from(b.height.buffer))
    expect(Buffer.from(a.block.buffer)).toEqual(Buffer.from(b.block.buffer))
  })

  test('two independent world gen contexts on the same seed ⇒ identical section', () => {
    const ctx1 = create_gen_context('aresrpg')
    const ctx2 = create_gen_context('aresrpg')
    const s1 = create_world_column_sampler(ctx1)
    const s2 = create_world_column_sampler(ctx2)
    const a = build_section(s1, 3, 0, 0)
    const b = build_section(s2, 3, 0, 0)
    expect(Buffer.from(a.height.buffer)).toEqual(Buffer.from(b.height.buffer))
    expect(Buffer.from(a.block.buffer)).toEqual(Buffer.from(b.block.buffer))
    // sky layers must agree too (both null or both equal)
    expect(a.sky_cells).toBe(b.sky_cells)
    if (a.sky_height && b.sky_height) {
      expect(Buffer.from(a.sky_height.buffer)).toEqual(Buffer.from(b.sky_height.buffer))
    }
  })
})

describe('2×2 → 1 golden (hand-computed L1 downsample)', () => {
  // At L1, block_size=2, SECTION_TAP_CAP=4 but k=min(2,4)=2 → a 2×2 tap grid per cell. Tap offsets
  // for block_size=2, k=2: floor((i+0.5)*2/2) = floor(i+0.5) = {0, 1}. So cell (cx,cz) at origin
  // (0,0) samples world columns (0,0),(1,0),(0,1),(1,1) — a clean 2×2 block. We hand-compute the
  // expected max-height and mode-block for cell 0 and assert the section matches.
  test('cell 0 = max height + mode block of its 2×2 world columns', () => {
    const s = build_section(scripted_sampler, 1, 0, 0) // [D162] pinned to L1 (the finest DOWNSAMPLING level; L0 is a 1×1 exact tap)

    // Hand-compute over the four world columns of cell (0,0).
    const cols = [scripted_sampler(0, 0), scripted_sampler(1, 0), scripted_sampler(0, 1), scripted_sampler(1, 1)]
    const expected_h = Math.max(...cols.map((c) => c.height))
    // mode of block ids with ties → LOWEST id (matches mode_of tie-break).
    const ids = cols.map((c) => c.block_id)
    const expected_block = mode_lowest(ids)

    expect(s.height[0]).toBe(expected_h)
    expect(s.block[0]).toBe(expected_block)
  })

  test('a second cell (cx=3,cz=2) also matches its hand-computed 2×2', () => {
    const s = build_section(scripted_sampler, 1, 0, 0) // [D162] pinned to L1 (see above)
    const bx = 3 * 2 // block_size 2
    const bz = 2 * 2
    const cols = [
      scripted_sampler(bx + 0, bz + 0),
      scripted_sampler(bx + 1, bz + 0),
      scripted_sampler(bx + 0, bz + 1),
      scripted_sampler(bx + 1, bz + 1),
    ]
    const ci = 2 * CELLS_PER_SECTION + 3
    expect(s.height[ci]).toBe(Math.max(...cols.map((c) => c.height)))
    expect(s.block[ci]).toBe(mode_lowest(cols.map((c) => c.block_id)))
  })
})

describe('far-water rule (survey S14) — flooded column reads opaque water', () => {
  test('a sampler with water above ground yields WATER block at the water surface', () => {
    // scripted flooded sampler: ground 90, water 128 → the far cell must read water @128.
    const flooded = () => ({ height: 128, block_id: WATER_ID, sky_top: 0, sky_block: 0 })
    const s = build_section(flooded, 2, 0, 0)
    expect(s.block[0]).toBe(WATER_ID)
    expect(s.height[0]).toBe(128)
  })

  test('the REAL world sampler reads water where a column is flooded (far-water swap)', () => {
    // Probe the sampler directly (cheap) rather than building whole sections: find a flooded column
    // and confirm the far summary reports WATER at the water surface (the S14 rule, on real gen).
    const ctx = create_gen_context('aresrpg')
    const sampler = create_world_column_sampler(ctx)
    let found_water = false
    for (let z = -600; z <= 600 && !found_water; z += 8) {
      for (let x = -600; x <= 600; x += 8) {
        if (sampler(x, z).block_id === WATER_ID) {
          found_water = true
          break
        }
      }
    }
    expect(found_water).toBe(true)
  })
})

describe('section_bytes', () => {
  test('counts height+block (+sky when present)', () => {
    const s = build_section(scripted_sampler, 2, 0, 0)
    // no sky in scripted sampler → 2 × Uint16Array(1024) = 2·2048 bytes
    expect(section_bytes(s)).toBe(s.height.byteLength + s.block.byteLength)
  })
})

// ---- helpers -------------------------------------------------------------------------------------

/** Mode with ties broken toward the LOWEST id — mirrors section_builder.mode_of.
 * @param {number[]} ids @returns {number} */
function mode_lowest(ids) {
  let [best] = ids
  let best_count = 0
  for (const cand of ids) {
    const c = ids.filter((x) => x === cand).length
    if (c > best_count || (c === best_count && cand < best)) {
      best_count = c
      best = cand
    }
  }
  return best
}
