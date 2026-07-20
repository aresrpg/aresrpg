// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seam 2 gate — the board derives deterministically from (seed, anchor), varies with the anchor, and
// every derived board is a well-formed, king-isolated, seat-able board.build() spec.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'

import { ground_height } from './ground_height.js'
import {
  board_spec_for_anchor,
  board_seed_from_anchor,
  voids_from_shape_mask,
  _generate_board,
} from './board_anchor.js'

const cfg = DEFAULT_WORLD_GEN_CONFIG
const ANCHORS = Array.from({ length: 40 }, (_, i) => [((i * 613) % 2000) - 1000, ((i * 379) % 2000) - 1000])
const WS = 3735928559 // 0xDEADBEEF — a fixed CHAIN u64 world seed for the anchor-driven tests

// ── CROSS-TWIN VECTORS (S-47) — engine board-from-anchor ≡ sim board_gen.js ≡ Move ──────────────────────────
// The SAME golden vectors as packages/sim/test/board_gen.test.js (its GOLDEN block), which are PROVEN
// bit-identical to the on-chain board::generate_for_anchor (2026-07-08 pure_tests.move::board_dump_for_js_parity).
// Duplicated here WITH this citation because the engine ships NO @aresrpg/sim dependency by design (prng.js
// vendoring law) — one home for the vectors is sim's board_gen.test.js. Same (world_seed, x, z) → the same seed
// + raw board (dims / mask bitset / obstacles / holes / start cells) here as there ⇒ engine ≡ sim ≡ Move.
const CROSS_TWIN = [
  {
    args: [12345, 100, 200],
    seed: 1266891245,
    width: 14,
    height: 16,
    mask: [
      '17311835885279395838',
      '18375812311932666879',
      '18442310838598496319',
      '4611408941232946947',
      '35958565680316400',
      '0',
    ],
    obstacles: [227, 71, 104, 211, 249],
    holes: [41, 221, 122, 108],
    a: [1, 2, 3, 4, 5, 6],
    b: [310, 309, 308, 307, 306, 305],
  },
  {
    args: [777, 5, 5],
    seed: 1357353067,
    width: 11,
    height: 7,
    mask: ['17296073271551199231', '18374827148574654591', '7', '0', '0', '0'],
    obstacles: [45, 47],
    holes: [104, 49, 41],
    a: [0, 1, 2, 3, 4, 5],
    b: [130, 129, 128, 127, 126, 125],
  },
  {
    args: [3735928559, 4000000000, 3000000000],
    seed: 1350058223,
    width: 15,
    height: 18,
    mask: [
      '17329850283787821052',
      '18376938212913252351',
      '18442381207409782911',
      '9223099357711040263',
      '576443709856940016',
      '8585756670',
    ],
    obstacles: [128, 271, 146, 130, 304, 273],
    holes: [182],
    a: [2, 3, 4, 5, 6, 7],
    b: [352, 351, 350, 349, 348, 347],
  },
]

/** Serialize an on-cell Set to the Move-identical 6×u64 word vector (word = c>>6, bit = c&63) → decimal strings. */
const mask_words = (set) => {
  const w = [0n, 0n, 0n, 0n, 0n, 0n]
  for (const c of set) w[c >> 6] |= 1n << BigInt(c & 63)
  return w.map(String)
}

describe('binding/board_anchor — cross-twin parity: engine ≡ sim board_gen.js ≡ Move', () => {
  for (const g of CROSS_TWIN) {
    test(`(${g.args.join(',')}) → seed ${g.seed} + byte-identical board`, () => {
      const [ws, ax, az] = g.args
      expect(board_seed_from_anchor(ws, ax, az)).toBe(g.seed) // the (world_seed, anchor) fold
      const board = _generate_board(g.seed) // variant 0 → board::generate_for_anchor's draw sequence
      expect(board.grid_w).toBe(g.width)
      expect(board.grid_h).toBe(g.height)
      expect(mask_words(board.shape_mask)).toEqual(g.mask) // the shape mask, as the chain's u64 bitset
      expect(board.obstacles).toEqual(g.obstacles)
      expect(board.holes).toEqual(g.holes)
      expect(board.start_cells_a).toEqual(g.a)
      expect(board.start_cells_b).toEqual(g.b)
    })
  }
})

describe('voids_from_shape_mask — chain bitset → voids, bit order per combat_grid.move', () => {
  // Build the mask with the EXACT Move formula (combat_grid.move mask_set:183-189): cell = y*20 + x,
  // word = cell/64, bit = cell%64. The adapter's voids must then be exactly the box cells whose bit is 0.
  const GRID_W = 20
  const set_bit = (words, c) => {
    words[Math.floor(c / 64)] |= 1n << BigInt(c % 64)
  }

  test('4×5 box, two cells cleared — proves stride-20 row-major AND the 64-bit word boundary', () => {
    const grid_w = 4,
      grid_h = 5 // box cells: c=0..3, 20..23, 40..43, 60..63 (word 0), 80..83 (word 1)
    const off = new Set([3 /* (3,0), word 0 */, 80 /* (0,4), word 1 bit 16 */])
    const words = [0n, 0n, 0n, 0n, 0n, 0n]
    for (let y = 0; y < grid_h; y += 1)
      for (let x = 0; x < grid_w; x += 1) {
        const c = y * GRID_W + x
        if (!off.has(c)) set_bit(words, c)
      }
    // voids == the off-mask box cells, in row-major (y outer, x inner) order.
    expect(voids_from_shape_mask(words, grid_w, grid_h)).toEqual([
      { x: 3, y: 0 },
      { x: 0, y: 4 },
    ])
  })

  test('a full mask → no voids; accepts bigint / string / number words', () => {
    // single-row 3-wide board: cells 0,1,2 (word 0 low bits) → bits 0,1,2 = 7.
    expect(voids_from_shape_mask([7n, 0n, 0n, 0n, 0n, 0n], 3, 1)).toEqual([]) // bigint words
    expect(voids_from_shape_mask(['7'], 3, 1)).toEqual([]) // decimal string (gRPC shape), short array ok
    expect(voids_from_shape_mask([7], 3, 1)).toEqual([]) // Number word
    // clear bit 1 (cell (1,0)) → exactly that cell is a void.
    expect(voids_from_shape_mask([5], 3, 1)).toEqual([{ x: 1, y: 0 }])
  })

  test('cross-check on a golden mask: every on-shape cell is never reported as a void', () => {
    // CROSS_TWIN[1] (11×7) mask — its obstacles/holes/start cells are all on-shape, so none can be a void.
    const mask = ['17296073271551199231', '18374827148574654591', '7', '0', '0', '0']
    const voids = new Set(voids_from_shape_mask(mask, 11, 7).map((c) => c.y * 20 + c.x))
    for (const c of [45, 47, 104, 49, 41, 0, 1, 2, 3, 4, 5, 130, 129, 128, 127, 126, 125])
      expect(voids.has(c)).toBe(false)
  })
})

describe('binding/board_spec_for_anchor — determinism', () => {
  test('same (config, anchor) → deeply identical spec', () => {
    for (const [x, z] of ANCHORS) {
      const a = board_spec_for_anchor(cfg, WS, x, z)
      const b = board_spec_for_anchor(cfg, WS, x, z)
      expect(a).toEqual(b)
    }
  })

  test('fractional anchors floor to the same voxel column', () => {
    // Math.floor(100.9)=100, Math.floor(-50.2)=-51 — floor toward −∞, not truncation.
    expect(board_spec_for_anchor(cfg, WS, 100.9, -50.2)).toEqual(board_spec_for_anchor(cfg, WS, 100, -51))
  })

  test('different anchors → different boards (seed changes on a 1-block move)', () => {
    const base = board_spec_for_anchor(cfg, WS, 200, 200)
    expect(board_spec_for_anchor(cfg, WS, 201, 200).seed).not.toBe(base.seed)
    expect(board_spec_for_anchor(cfg, WS, 200, 201).seed).not.toBe(base.seed)
    // and the resulting layout genuinely differs across a spread of anchors (not a constant board).
    const specs = new Set(ANCHORS.map(([x, z]) => JSON.stringify(board_spec_for_anchor(cfg, WS, x, z).spec)))
    expect(specs.size).toBeGreaterThan(ANCHORS.length / 2)
  })

  test('a different world seed → a different board at the same anchor', () => {
    expect(board_spec_for_anchor(cfg, WS, 0, 0).seed).not.toBe(board_spec_for_anchor(cfg, WS + 1, 0, 0).seed)
  })
})

describe('binding/board_spec_for_anchor — well-formed board.build() spec', () => {
  const key = (c) => `${c.x},${c.y}`

  test('dims in range; obstacles/holes within caps; disjoint from each other and voids', () => {
    for (const [x, z] of ANCHORS) {
      const { spec } = board_spec_for_anchor(cfg, WS, x, z)
      expect(spec.grid_w).toBeGreaterThanOrEqual(7)
      expect(spec.grid_w).toBeLessThanOrEqual(17)
      expect(spec.grid_h).toBeGreaterThanOrEqual(7)
      expect(spec.grid_h).toBeLessThanOrEqual(19)
      expect(spec.obstacles.length).toBeLessThanOrEqual(6)
      expect(spec.holes.length).toBeLessThanOrEqual(4)

      const voids = new Set(spec.voids.map(key))
      const obs = new Set(spec.obstacles.map(key))
      const holes = new Set(spec.holes.map(key))
      // obstacles/holes never overlap each other or a void, and sit inside the grid.
      for (const c of [...spec.obstacles, ...spec.holes]) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThan(spec.grid_w)
        expect(c.y).toBeLessThan(spec.grid_h)
        expect(voids.has(key(c))).toBe(false)
      }
      for (const c of spec.obstacles) expect(holes.has(key(c))).toBe(false)
    }
  })

  test('king-isolation holds — no two blockers within Chebyshev-1', () => {
    for (const [x, z] of ANCHORS) {
      const { spec } = board_spec_for_anchor(cfg, WS, x, z)
      const blockers = [...spec.obstacles, ...spec.holes]
      for (let i = 0; i < blockers.length; i += 1)
        for (let j = i + 1; j < blockers.length; j += 1) {
          const cheby = Math.max(Math.abs(blockers[i].x - blockers[j].x), Math.abs(blockers[i].y - blockers[j].y))
          expect(cheby).toBeGreaterThan(1)
        }
    }
  })

  test('each side gets 6 start cells, on-shape, unblocked, disjoint, in opposite bands', () => {
    for (const [x, z] of ANCHORS) {
      const { spec, start_cells_a, start_cells_b } = board_spec_for_anchor(cfg, WS, x, z)
      expect(start_cells_a.length).toBe(6)
      expect(start_cells_b.length).toBe(6)
      const voids = new Set(spec.voids.map(key))
      const blocked = new Set([...spec.obstacles, ...spec.holes].map(key))
      const a_keys = new Set(start_cells_a.map(key))
      for (const c of [...start_cells_a, ...start_cells_b]) {
        expect(voids.has(key(c))).toBe(false) // on-shape
        expect(blocked.has(key(c))).toBe(false) // unblocked
      }
      for (const c of start_cells_b) expect(a_keys.has(key(c))).toBe(false) // disjoint
      // A is the near band (lower y), B is the far band (higher y) — bands don't cross.
      const max_a_y = Math.max(...start_cells_a.map((c) => c.y))
      const min_b_y = Math.min(...start_cells_b.map((c) => c.y))
      expect(max_a_y).toBeLessThanOrEqual(min_b_y)
    }
  })

  test('voids carve non-rectangular shapes; voids never overlap blockers/starts', () => {
    // The vocab (BLOB/ROUNDED/ELLIPSE/CROSS — RECT dropped) trims cells on almost every board, so the
    // boards are not plain squares. voids are off-shape ⇒ disjoint from every on-shape cell set.
    let any_voids = 0
    for (const [x, z] of ANCHORS) {
      const { spec, start_cells_a, start_cells_b } = board_spec_for_anchor(cfg, WS, x, z)
      const voids = new Set(spec.voids.map(key))
      for (const c of [...spec.obstacles, ...spec.holes, ...start_cells_a, ...start_cells_b])
        expect(voids.has(key(c))).toBe(false)
      // every void sits inside the grid bounding box.
      for (const c of spec.voids) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThan(spec.grid_w)
        expect(c.y).toBeLessThan(spec.grid_h)
      }
      if (spec.voids.length > 0) any_voids += 1
    }
    expect(any_voids).toBeGreaterThanOrEqual(Math.ceil(ANCHORS.length * 0.75)) // most shapes are non-rect
  })

  test('origin is centred on the anchor and grounded by the Y-oracle', () => {
    for (const [x, z] of ANCHORS.slice(0, 8)) {
      const { spec } = board_spec_for_anchor(cfg, WS, x, z)
      const { origin } = spec.anchor
      expect(origin.x).toBe(x - Math.floor((spec.grid_w * 2) / 2))
      expect(origin.z).toBe(z - Math.floor((spec.grid_h * 2) / 2))
      expect(origin.y).toBe(ground_height(cfg, x, z)) // floor sits on the canonical ground
    }
  })
})
