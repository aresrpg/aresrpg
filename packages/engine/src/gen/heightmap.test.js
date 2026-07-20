// ENG-20 heightmap-extraction unit tests. Covers the WebGL fallback's SURFACE probe (gen/heightmap.js):
//   (1) DETERMINISM — the same (seed, region) yields a bit-identical grid across fresh calls;
//   (2) SHAPE / INDEXING — grid dims, origin, and row-major (z-outer/x-inner) layout are correct;
//   (3) SURFACE MATCH — a grid cell equals anchor_surface at the same world column (SSOT, no rival math);
//   (4) WATER TAGGING — a surface at/below sea level is coloured water; above it keeps its strata block;
//   (5) COARSE DOWNSAMPLE — cell_size>1 samples the cell's SW corner at the correct world stride;
//   (6) VALIDATION — bad cols/rows/cell_size throw.
// Pure arithmetic (anchor_surface) → no GPU, no three.

import { test, expect, describe } from 'bun:test'

import { SEA_LEVEL } from '../config/world_config.js'
import { get_block_by_name } from '../config/block_registry.js'

import { extract_heightmap, surface_column } from './heightmap.js'
import { create_gen_context, anchor_surface } from './column_gen.js'

const SEED = 'aresrpg'
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

describe('extract_heightmap', () => {
  test('is deterministic across fresh contexts (bit-identical grid)', () => {
    const a = extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: 16, rows: 16 })
    const b = extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: 16, rows: 16 })
    expect(Array.from(a.surface_y)).toEqual(Array.from(b.surface_y))
    expect(Array.from(a.block_id)).toEqual(Array.from(b.block_id))
  })

  test('grid shape + origin + cell_size are reported back correctly', () => {
    const g = extract_heightmap({ gen: SEED, origin_x: -32, origin_z: 64, cols: 10, rows: 7, cell_size: 1 })
    expect(g.cols).toBe(10)
    expect(g.rows).toBe(7)
    expect(g.origin_x).toBe(-32)
    expect(g.origin_z).toBe(64)
    expect(g.cell_size).toBe(1)
    expect(g.surface_y.length).toBe(70)
    expect(g.block_id.length).toBe(70)
  })

  test('row-major z-outer/x-inner: cell (col,row) samples world (origin_x+col, origin_z+row)', () => {
    const ctx = create_gen_context(SEED)
    const origin_x = 40
    const origin_z = -20
    const g = extract_heightmap({ gen: ctx, origin_x, origin_z, cols: 8, rows: 8 })
    for (const [col, row] of [
      [0, 0],
      [3, 0],
      [0, 5],
      [7, 7],
      [2, 6],
    ]) {
      const i = row * g.cols + col
      const truth = anchor_surface(ctx, origin_x + col, origin_z + row)
      expect(g.surface_y[i]).toBe(truth.surface_y)
    }
  })

  test('surface cell matches anchor_surface (single source of truth — no rival heightfield)', () => {
    const ctx = create_gen_context(SEED)
    // (120,70) is a grassy inland surface well above sea level (probed post relief-ladder fork,
    // GEN_VERSION 7 — the old (70,70) column now dips below the waterline under the unscaled ladder).
    const g = extract_heightmap({ gen: ctx, origin_x: 120, origin_z: 70, cols: 1, rows: 1 })
    const truth = anchor_surface(ctx, 120, 70)
    expect(g.surface_y[0]).toBe(truth.surface_y)
    // above sea level → keeps its dry strata surface block (grass here), never water.
    expect(truth.surface_y).toBeGreaterThan(SEA_LEVEL)
    expect(g.block_id[0]).toBe(truth.surface_block)
    expect(g.block_id[0]).not.toBe(WATER)
  })

  test('a surface at/below sea level is coloured water', () => {
    // Scan a wide band for a column whose surface sits at/below sea level (oceans exist in this world).
    const ctx = create_gen_context(SEED)
    let found = false
    outer: for (let z = -400; z <= 400; z += 40) {
      for (let x = -400; x <= 400; x += 40) {
        const a = anchor_surface(ctx, x, z)
        if (a.surface_y <= SEA_LEVEL) {
          const g = extract_heightmap({ gen: ctx, origin_x: x, origin_z: z, cols: 1, rows: 1 })
          expect(g.block_id[0]).toBe(WATER)
          found = true
          break outer
        }
      }
    }
    expect(found).toBe(true) // sanity: the world must have at least one sub-sea-level column in range
  })

  test('coarse downsample (cell_size 4) samples the SW corner at a 4-block stride', () => {
    const ctx = create_gen_context(SEED)
    const origin_x = 100
    const origin_z = 100
    const g = extract_heightmap({ gen: ctx, origin_x, origin_z, cols: 5, rows: 5, cell_size: 4 })
    expect(g.cell_size).toBe(4)
    // cell (col,row) samples (origin_x + col*4, origin_z + row*4).
    for (const [col, row] of [
      [0, 0],
      [2, 1],
      [4, 4],
    ]) {
      const i = row * g.cols + col
      const truth = anchor_surface(ctx, origin_x + col * 4, origin_z + row * 4)
      expect(g.surface_y[i]).toBe(truth.surface_y)
    }
  })

  test('zero-size grid is empty, not an error', () => {
    const g = extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: 0, rows: 0 })
    expect(g.surface_y.length).toBe(0)
    expect(g.block_id.length).toBe(0)
  })

  test('rejects invalid cols/rows/cell_size', () => {
    expect(() => extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: -1, rows: 4 })).toThrow()
    expect(() => extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: 4, rows: 2.5 })).toThrow()
    expect(() => extract_heightmap({ gen: SEED, origin_x: 0, origin_z: 0, cols: 4, rows: 4, cell_size: 0 })).toThrow()
  })
})

describe('surface_column', () => {
  test('matches the grid single-cell extract (same water/strata rule)', () => {
    const ctx = create_gen_context(SEED)
    for (const [x, z] of [
      [70, 70],
      [0, 0],
      [200, -150],
      [-88, 300],
    ]) {
      const col = surface_column(ctx, x, z)
      const g = extract_heightmap({ gen: ctx, origin_x: x, origin_z: z, cols: 1, rows: 1 })
      expect(col.surface_y).toBe(g.surface_y[0])
      expect(col.block_id).toBe(g.block_id[0])
    }
  })

  test('is deterministic (arithmetic + Math.floor)', () => {
    const a = surface_column(create_gen_context(SEED), 123, -45)
    const b = surface_column(create_gen_context(SEED), 123, -45)
    expect(a).toEqual(b)
  })
})
