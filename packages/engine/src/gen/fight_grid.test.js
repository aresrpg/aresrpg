// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight-grid derivation tests (§6.6, ticket #25). Three gates:
//   1. GOLDEN      — a fixed (hash, room) yields exact grid bytes + starts (locks determinism +
//                    the Move-twin contract; any drift here is a world/on-chain fork).
//   2. CONNECTIVITY — every start is walkable, in the single connected region, and no two starts
//                    overlap; walkable cells all reachable from a start.
//   3. DISTRIBUTION — grids vary across different hashes (not a degenerate constant generator).

import { test, expect, describe } from 'bun:test'

import { FIGHT_GRID_CELLS_MIN, FIGHT_GRID_CELLS_MAX } from '../config/world_config.js'

import { generate_fight_grid, fight_grid_seed_state, CELL_FLOOR, CELL_OBSTACLE, CELL_HOLE } from './fight_grid.js'

// ---- 1. GOLDEN (Move-twin contract) ---------------------------------------------------------
// Fixed inputs → frozen output. The Move on-chain twin MUST reproduce these exact bytes.
// If this test ever changes, regenerate the shared JSON vectors and bump BOTH mirrors atomically.

const GOLDEN_HASH = 0x1234567890abcdefn
const GOLDEN_ROOM = 3
const GOLDEN_COUNTS = { player_count: 4, mob_count: 3 }

const GOLDEN_SEED_STATE = 4001048304
const GOLDEN_WIDTH = 10
const GOLDEN_HEIGHT = 15
// prettier-ignore
const GOLDEN_CELLS = [
  1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,
  1,1,1,0,0,1,1,1,1,1,
  1,1,0,0,0,0,1,1,1,1,
  1,1,0,0,0,0,1,1,1,1,
  1,1,0,0,0,0,1,1,1,1,
  1,1,1,0,0,0,0,1,1,1,
  1,1,1,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,1,1,
  1,2,2,0,0,0,0,0,1,1,
  1,2,2,2,0,0,0,1,1,1,
  1,1,2,2,2,0,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,
]
const GOLDEN_PLAYER_STARTS = [
  { x: 3, y: 3 },
  { x: 4, y: 3 },
  { x: 2, y: 4 },
  { x: 3, y: 4 },
]
const GOLDEN_MOB_STARTS = [
  { x: 5, y: 12 },
  { x: 6, y: 11 },
  { x: 5, y: 11 },
]

describe('golden: fixed (hash, room) locks exact bytes + starts (Move-twin contract)', () => {
  const grid = generate_fight_grid(GOLDEN_HASH, GOLDEN_ROOM, GOLDEN_COUNTS)

  test('seed-mix state is frozen', () => {
    expect(fight_grid_seed_state(GOLDEN_HASH, GOLDEN_ROOM)).toBe(GOLDEN_SEED_STATE)
  })

  test('shape is frozen', () => {
    expect(grid.width).toBe(GOLDEN_WIDTH)
    expect(grid.height).toBe(GOLDEN_HEIGHT)
  })

  test('cell bytes are frozen', () => {
    expect(Array.from(grid.cells)).toEqual(GOLDEN_CELLS)
  })

  test('start positions are frozen', () => {
    expect(grid.player_starts).toEqual(GOLDEN_PLAYER_STARTS)
    expect(grid.mob_starts).toEqual(GOLDEN_MOB_STARTS)
  })

  test('hex-string and BigInt hashes derive the identical grid', () => {
    const via_string = generate_fight_grid('0x1234567890abcdef', GOLDEN_ROOM, GOLDEN_COUNTS)
    expect(via_string.width).toBe(grid.width)
    expect(via_string.height).toBe(grid.height)
    expect(Array.from(via_string.cells)).toEqual(Array.from(grid.cells))
  })

  test('re-running the same inputs is byte-identical (idempotent)', () => {
    const again = generate_fight_grid(GOLDEN_HASH, GOLDEN_ROOM, GOLDEN_COUNTS)
    expect(Array.from(again.cells)).toEqual(Array.from(grid.cells))
    expect(again.player_starts).toEqual(grid.player_starts)
    expect(again.mob_starts).toEqual(grid.mob_starts)
  })
})

// ---- 2. CONNECTIVITY ------------------------------------------------------------------------

/**
 * 4-neighbour flood-fill from a seed cell; returns the set of reachable walkable cell indices.
 * @param {Uint8Array} cells
 * @param {number} width
 * @param {number} height
 * @param {number} seed_index
 * @returns {Set<number>}
 */
function reachable_from(cells, width, height, seed_index) {
  const seen = new Set()
  const stack = [seed_index]
  seen.add(seed_index)
  while (stack.length > 0) {
    const cur = /** @type {number} */ (stack.pop())
    const cx = cur % width
    const cy = (cur - cx) / width
    const nbs = [
      cx > 0 ? cur - 1 : -1,
      cx < width - 1 ? cur + 1 : -1,
      cy > 0 ? cur - width : -1,
      cy < height - 1 ? cur + width : -1,
    ]
    for (const nb of nbs) {
      if (nb < 0) continue
      if (cells[nb] === CELL_FLOOR && !seen.has(nb)) {
        seen.add(nb)
        stack.push(nb)
      }
    }
  }
  return seen
}

describe('connectivity: starts valid, non-overlapping, all walkable cells reachable', () => {
  const cases = [
    { hash: 0x1234567890abcdefn, room: 3, players: 4, mobs: 3 },
    { hash: 0xdeadbeefn, room: 0, players: 2, mobs: 2 },
    { hash: 0xaaaabbbbccccddddn, room: 7, players: 8, mobs: 8 },
    { hash: 1n, room: 1, players: 1, mobs: 1 },
    { hash: 0xffffffffffffffffn, room: 12, players: 3, mobs: 5 },
  ]

  for (const c of cases) {
    test(`hash=${c.hash.toString(16)} room=${c.room} p=${c.players} m=${c.mobs}`, () => {
      const grid = generate_fight_grid(c.hash, c.room, {
        player_count: c.players,
        mob_count: c.mobs,
      })

      // shape bounds
      expect(grid.width).toBeGreaterThanOrEqual(FIGHT_GRID_CELLS_MIN)
      expect(grid.width).toBeLessThanOrEqual(FIGHT_GRID_CELLS_MAX)
      expect(grid.height).toBeGreaterThanOrEqual(FIGHT_GRID_CELLS_MIN)
      expect(grid.height).toBeLessThanOrEqual(FIGHT_GRID_CELLS_MAX)
      expect(grid.cells.length).toBe(grid.width * grid.height)

      // correct counts
      expect(grid.player_starts.length).toBe(c.players)
      expect(grid.mob_starts.length).toBe(c.mobs)

      const all_starts = [...grid.player_starts, ...grid.mob_starts]

      // every start is on a walkable floor cell (never obstacle/hole)
      for (const s of all_starts) {
        const cell = grid.cells[s.y * grid.width + s.x]
        expect(cell).toBe(CELL_FLOOR)
      }

      // no two starts overlap
      const keys = new Set(all_starts.map((s) => `${s.x},${s.y}`))
      expect(keys.size).toBe(all_starts.length)

      // single connected walkable region: every floor cell reachable from a start
      const [seed] = grid.player_starts
      const seed_index = seed.y * grid.width + seed.x
      const reachable = reachable_from(grid.cells, grid.width, grid.height, seed_index)
      let floor_total = 0
      for (const cell of grid.cells) if (cell === CELL_FLOOR) floor_total += 1
      expect(reachable.size).toBe(floor_total)

      // every start is inside that reachable region
      for (const s of all_starts) {
        expect(reachable.has(s.y * grid.width + s.x)).toBe(true)
      }

      // only the three legal byte values appear
      for (const cell of grid.cells) {
        expect(cell === CELL_FLOOR || cell === CELL_OBSTACLE || cell === CELL_HOLE).toBe(true)
      }
    })
  }
})

// ---- 3. DISTRIBUTION ------------------------------------------------------------------------

describe('distribution: grids vary across different hashes', () => {
  test('many distinct shapes and no two identical grids over 256 hashes', () => {
    const shapes = new Set()
    const fingerprints = new Set()
    const N = 256
    for (let i = 0; i < N; i += 1) {
      const hash = (BigInt(i) * 0x9e3779b97f4a7c15n + 0x1234n) & ((1n << 64n) - 1n)
      const grid = generate_fight_grid(hash, i % 6, {
        player_count: 2,
        mob_count: 2,
      })
      shapes.add(`${grid.width}x${grid.height}`)
      fingerprints.add(`${grid.width}x${grid.height}:${grid.cells.join('')}`)
    }
    // 9x9 = 81 possible shapes; expect broad coverage, not a single degenerate shape.
    expect(shapes.size).toBeGreaterThan(20)
    // every generated grid is unique (no accidental constant/aliasing).
    expect(fingerprints.size).toBe(N)
  })

  test('different rooms of the same dungeon differ', () => {
    const hash = 0xcafebabecafebaben
    const a = generate_fight_grid(hash, 0, { player_count: 2, mob_count: 2 })
    const b = generate_fight_grid(hash, 1, { player_count: 2, mob_count: 2 })
    const same = a.width === b.width && a.height === b.height && a.cells.join('') === b.cells.join('')
    expect(same).toBe(false)
  })
})
