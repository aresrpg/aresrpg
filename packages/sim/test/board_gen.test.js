import { describe, test, expect } from 'bun:test'

import { rng_seed, rng_next, rng_int, rng_range } from '../src/prng.js'
import {
  generate_for_anchor,
  board_seed_from_anchor,
} from '../src/board_gen.js'

// ── PRNG PARITY ANCHOR ────────────────────────────────────────────────────────────────────────────────────
// The board derivation is bit-exact ONLY if the shared prng is. These vectors are copied VERBATIM from
// prng.move's `prng_matches_js_reference` test (which itself captured them LIVE from prng.js). Move stores the
// state UNSIGNED (u64 masked); prng.js stores it as a signed int32 with the same low 32 bits, so we compare
// `state >>> 0`. Re-asserting here guards the determinism contract the whole board mirror rides on.
describe('prng parity anchor — prng.move prng_matches_js_reference', () => {
  test('rng_seed(0) → next ×4 matches the Move reference vectors', () => {
    let s = rng_seed(0)
    const out = []
    for (let i = 0; i < 4; i++) {
      const n = rng_next(s)
      s = n.state
      out.push([n.state >>> 0, n.value])
    }
    expect(out).toEqual([
      [1831565813, 1144304738],
      [3663131626, 1416247],
      [1199730143, 958946056],
      [3031295956, 627933444],
    ])
  })

  test('derived draws: rng_range(12345,1,100)=70 · rng_int(999,6)=1', () => {
    expect(rng_range(rng_seed(12345), 1, 100).value).toBe(70)
    expect(rng_int(rng_seed(999), 6).value).toBe(1)
  })
})

// ── BOARD PROPERTIES — parity with pure_tests.move (property-level; the Move tests assert properties, not
// literals). Copied VERBATIM. ────────────────────────────────────────────────────────────────────────────────
describe('board derivation — parity with pure_tests.move (properties)', () => {
  test('board_is_deterministic_and_well_formed', () => {
    const g1 = generate_for_anchor(12345, 100, 200)
    const g2 = generate_for_anchor(12345, 100, 200)
    // determinism: identical dims + start cells
    expect(g1.width).toBe(g2.width)
    expect(g1.height).toBe(g2.height)
    expect(g1.start_cells_a).toEqual(g2.start_cells_a)
    expect(g1.start_cells_b).toEqual(g2.start_cells_b)
    // dims in the vocab bounds
    expect(g1.width).toBeGreaterThanOrEqual(7)
    expect(g1.width).toBeLessThanOrEqual(17)
    expect(g1.height).toBeGreaterThanOrEqual(7)
    expect(g1.height).toBeLessThanOrEqual(19)
    // 6 start cells per side, disjoint
    expect(g1.start_cells_a.length).toBe(6)
    expect(g1.start_cells_b.length).toBe(6)
    for (const c of g1.start_cells_a) expect(g1.start_cells_b).not.toContain(c)
  })

  test('board_varies_with_anchor: a different anchor yields a different board seed', () => {
    const s1 = board_seed_from_anchor(12345, 100, 200)
    const s2 = board_seed_from_anchor(12345, 101, 200)
    expect(s1).not.toBe(s2)
  })
})

// ── GOLDEN DRIFT-GUARD ──────────────────────────────────────────────────────────────────────────────────────
// These literals are JS-DERIVED (captured from this very mirror), NOT yet proven bit-identical to the Move
// board::generate output — the Move pure_tests assert only properties, so no on-chain literal exists to diff
// against. PROVEN-PARITY 2026-07-08: pure_tests.move::board_dump_for_js_parity printed all three cases — every
// then this freezes the JS derivation so a refactor can't silently change the draw contract. The third seed uses
// anchors near u32 max (4e9 / 3e9) to exercise the BigInt overflow fold in board_seed_from_anchor.
const GOLDEN = [
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

describe('board derivation — golden drift-guard (Move-parity-proven literals)', () => {
  for (const g of GOLDEN) {
    test(`generate_for_anchor(${g.args.join(',')}) is stable`, () => {
      const [ws, ax, az] = g.args
      expect(board_seed_from_anchor(ws, ax, az)).toBe(g.seed)
      const board = generate_for_anchor(ws, ax, az)
      expect(board.width).toBe(g.width)
      expect(board.height).toBe(g.height)
      expect(board.shape_mask.map(w => w.toString())).toEqual(g.mask)
      expect(board.obstacles).toEqual(g.obstacles)
      expect(board.holes).toEqual(g.holes)
      expect(board.start_cells_a).toEqual(g.a)
      expect(board.start_cells_b).toEqual(g.b)
    })
  }
})
