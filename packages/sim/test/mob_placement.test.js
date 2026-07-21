// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { rng_seed } from '../src/prng.js'
import {
  grid_cells,
  mask_get,
  empty_mask,
  mask_set,
} from '../src/combat_grid.js'
import { generate_for_anchor } from '../src/board_gen.js'
import { place_mob_cells, seeded_spawn_cell } from '../src/mob_placement.js'

// On-mask cells of a board, in index order (the pool seeded_spawn_cell draws over).
const open_pool = (mask, obstacles, holes, starts) => {
  const blocked = new Set([...obstacles, ...holes, ...starts])
  const out = []
  for (let c = 0; c < grid_cells(); c++)
    if (mask_get(mask, c) && !blocked.has(c)) out.push(c)
  return out
}

// The CURRENT (buggy) chain loop: a FIXED exclusion set (start cells only), never fed the placed mobs —
// mob_ai.move seeded_spawn_cell called per mob with an unchanging `all_starts` (fight.move:280-289). Used
// ONLY to prove the fix is load-bearing (this MUST be able to collide where place_mob_cells cannot).
const naive_place = ({
  mask,
  obstacles = [],
  holes = [],
  starts = [],
  group_seed,
  count,
}) => {
  let state = rng_seed(Number(BigInt(group_seed) & 0xffff_ffffn))
  const cells = []
  for (let i = 0; i < count; i++) {
    const { cell, state: st } = seeded_spawn_cell(
      mask,
      obstacles,
      holes,
      starts,
      state,
    ) // starts NEVER grows
    state = st
    cells.push(cell)
  }
  return cells
}

describe('mob placement — collision-free distinct-cell guarantee (the "both mobs on the same cell" fix)', () => {
  test('N mobs → N DISTINCT, on-mask, non-blocked cells across many seeds/anchors/counts', () => {
    let fights = 0
    for (let ws = 1; ws <= 40; ws++)
      for (let a = 0; a < 6; a++) {
        const ax = 37 * a + ws
        const az = 91 * a + 2 * ws
        const board = generate_for_anchor(ws, ax, az)
        const starts = [...board.start_cells_a, ...board.start_cells_b]
        const pool = open_pool(
          board.shape_mask,
          board.obstacles,
          board.holes,
          starts,
        )
        for (let count = 1; count <= 6; count++) {
          const cells = place_mob_cells({
            mask: board.shape_mask,
            obstacles: board.obstacles,
            holes: board.holes,
            starts,
            group_seed: ws * 1000 + a * 7 + count,
            count,
          })
          fights++
          // exactly min(count, capacity) cells, ALL distinct (the core guarantee)
          expect(cells.length).toBe(Math.min(count, pool.length))
          expect(new Set(cells).size).toBe(cells.length)
          // every cell is on the board, walkable, and NOT a start seat
          for (const c of cells) {
            expect(mask_get(board.shape_mask, c)).toBe(true)
            expect(board.obstacles.includes(c)).toBe(false)
            expect(board.holes.includes(c)).toBe(false)
            expect(starts.includes(c)).toBe(false)
          }
        }
      }
    expect(fights).toBeGreaterThan(1000) // real coverage, not a single lucky seed
  })

  test('deterministic — identical (board, seed, count) → identical cells', () => {
    const board = generate_for_anchor(12345, 100, 200)
    const starts = [...board.start_cells_a, ...board.start_cells_b]
    const args = {
      mask: board.shape_mask,
      obstacles: board.obstacles,
      holes: board.holes,
      starts,
      group_seed: '424242',
      count: 5,
    }
    expect(place_mob_cells(args)).toEqual(place_mob_cells(args))
  })

  test('tight board (capacity == count and capacity == count+1) still yields all-distinct cells', () => {
    // a hand-built mask with EXACTLY 3 open cells (0,1,2) and no blockers — the worst case for collisions
    const mask = empty_mask()
    for (const c of [0, 1, 2]) mask_set(mask, c)
    // capacity == count: must fill all 3, each once
    for (let seed = 0; seed < 50; seed++) {
      const cells = place_mob_cells({ mask, group_seed: seed, count: 3 })
      expect(cells.length).toBe(3)
      expect(new Set(cells).size).toBe(3)
    }
    // capacity == count+1: 2 mobs on 3 cells — always distinct
    for (let seed = 0; seed < 50; seed++) {
      const cells = place_mob_cells({ mask, group_seed: seed, count: 2 })
      expect(new Set(cells).size).toBe(2)
    }
  })

  test('REGRESSION GUARD: the current chain loop (fixed exclusion) DOES collide where the fix never does', () => {
    // 3 open cells, 2 mobs — the fixed-exclusion draw collides on a fraction of seeds (~1/3 of pairs);
    // the accumulating fix collides on NONE. If a future change reverts the fix, the second expectation breaks.
    const mask = empty_mask()
    for (const c of [0, 1, 2]) mask_set(mask, c)
    let naive_collisions = 0
    let fixed_collisions = 0
    for (let seed = 0; seed < 60; seed++) {
      const naive = naive_place({ mask, group_seed: seed, count: 2 })
      const fixed = place_mob_cells({ mask, group_seed: seed, count: 2 })
      if (new Set(naive).size < naive.length) naive_collisions++
      if (new Set(fixed).size < fixed.length) fixed_collisions++
    }
    expect(naive_collisions).toBeGreaterThan(0) // the bug is real and reproducible
    expect(fixed_collisions).toBe(0) // the fix eliminates it entirely
  })
})
