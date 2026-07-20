// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DETERMINISM PIN for the consolidated integer hashes (repo audit 2026-07-10). Before this module
// existed, sky_islands / strata / icebergs / cirque / caves each carried their own byte-for-byte copy
// of the same splitmix-lineage hash2/hash3, differing only cosmetically (`salt|0` vs `salt`, `& U32`
// vs none). This test replays EVERY former per-file variant verbatim and asserts it is bit-identical
// to the canonical over a wide input grid — negatives, zero, large magnitudes, and 2^31 boundaries —
// so the consolidation provably cannot shift any world seed. If a future edit to integer_hash.js
// changes an output, this fails loudly.

import { test, expect, describe } from 'bun:test'

import { hash2, hash3 } from './integer_hash.js'

const U32 = 0xffffffff

// ── Former per-file impls, copied VERBATIM from the pre-consolidation sources ──────────────────────
// hash2 — sky_islands.js (salt not |0, no & U32)
const old_hash2_sky = (a, b, salt) => {
  let h = (salt ^ Math.imul(a | 0, 0x27d4_eb2d) ^ Math.imul(b | 0, 0x1656_67b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x297a_2d39) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
// hash2 — strata.js (operand-first, salt|0, & U32)
const old_hash2_strata = (x, z, salt) => {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(z | 0, 0x1656_67b1) ^ (salt | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x297a_2d39) >>> 0
  return ((h ^ (h >>> 16)) & U32) >>> 0
}
// hash2 — icebergs.js / cirque.js (salt|0 first, & U32)
const old_hash2_iceberg = (a, b, salt) => {
  let h = ((salt | 0) ^ Math.imul(a | 0, 0x27d4_eb2d) ^ Math.imul(b | 0, 0x1656_67b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x297a_2d39) >>> 0
  return ((h ^ (h >>> 16)) & U32) >>> 0
}
// hash3 — caves.js / sky_islands.js (salt not |0, no & U32)
const old_hash3_caves = (x, y, z, salt) => {
  let h = (salt ^ Math.imul(x | 0, 0x1656_67b1) ^ Math.imul(y | 0, 0x2f6d_9f4b) ^ Math.imul(z | 0, 0x5b83_2d19)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a_2d39) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}
// hash3 — icebergs.js / cirque.js (salt|0 first, & U32)
const old_hash3_iceberg = (a, b, c, salt) => {
  let h =
    ((salt | 0) ^ Math.imul(a | 0, 0x1656_67b1) ^ Math.imul(b | 0, 0x2f6d_9f4b) ^ Math.imul(c | 0, 0x5b83_2d19)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a_2d39) >>> 0
  return ((h ^ (h >>> 15)) & U32) >>> 0
}

// Wide, adversarial input grid: sign, zero, small, large, and the 2^31 / u32 boundaries.
const COORDS = [-2_147_483_648, -1_000_003, -257, -1, 0, 1, 2, 255, 4096, 1_000_003, 2_147_483_647, 4_294_967_295]
const SALTS = [0, 1, 7, 1337, -1, 0x9e37_79b1, 0x27d4_eb2d, -2_147_483_648, 2_147_483_647]

describe('integer_hash — output-identical to every former per-file impl (no world-seed shift)', () => {
  test('hash2 == sky_islands / strata / icebergs variants over the grid', () => {
    for (const a of COORDS)
      for (const b of COORDS)
        for (const salt of SALTS) {
          const want = hash2(a, b, salt)
          expect(old_hash2_sky(a, b, salt)).toBe(want)
          expect(old_hash2_strata(a, b, salt)).toBe(want)
          expect(old_hash2_iceberg(a, b, salt)).toBe(want)
          expect(want).toBeGreaterThanOrEqual(0) // u32
          expect(want).toBeLessThanOrEqual(0xffffffff)
        }
  })

  test('hash3 == caves / sky_islands / icebergs variants over the grid', () => {
    for (const a of COORDS)
      for (const b of COORDS)
        for (const c of [-1, 0, 1, 4096, 2_147_483_647])
          // 3rd axis: keep the product bounded
          for (const salt of SALTS) {
            const want = hash3(a, b, c, salt)
            expect(old_hash3_caves(a, b, c, salt)).toBe(want)
            expect(old_hash3_iceberg(a, b, c, salt)).toBe(want)
            expect(want).toBeGreaterThanOrEqual(0)
            expect(want).toBeLessThanOrEqual(0xffffffff)
          }
  })

  test('hash2/hash3 are pure — same inputs, same outputs across calls', () => {
    expect(hash2(123, -456, 789)).toBe(hash2(123, -456, 789))
    expect(hash3(123, -456, 78, 9)).toBe(hash3(123, -456, 78, 9))
    expect(hash2(1, 2, 3)).not.toBe(hash3(1, 2, 3, 4)) // distinct functions (all-zero inputs are a shared fixed point at 0)
  })

  // ABSOLUTE pinned vectors — orthogonal to the differential tests above. Those prove
  // `canonical == recorded-old-impl`; this freezes the literal outputs, so a coordinated edit to
  // BOTH the canonical AND a recorded-old variant (which would slip past the differential grid)
  // still trips here. Values captured from the live impl at consolidation (repo audit 2026-07-10);
  // any change re-rolls world seeds — DO NOT update these to make a failing test pass.
  test('hash2/hash3 match frozen reference outputs (world-seed tripwire)', () => {
    expect(hash2(0, 0, 0)).toBe(0)
    expect(hash2(1, 2, 3)).toBe(2_941_595_148)
    expect(hash2(12_345, -678, 0x1337)).toBe(877_123_605)
    expect(hash2(-2_147_483_648, 2_147_483_647, 0x9e37_79b1)).toBe(1_594_984_449)
    expect(hash2(4096, 4096, 7)).toBe(1_502_887_413)

    expect(hash3(0, 0, 0, 0)).toBe(0)
    expect(hash3(1, 2, 3, 4)).toBe(388_365_854)
    expect(hash3(12_345, -678, 90, 0x1337)).toBe(124_541_694)
    expect(hash3(-2_147_483_648, 2_147_483_647, -1, 0x9e37_79b1)).toBe(2_034_324_633)
    expect(hash3(100, -100, 50, 1337)).toBe(4_122_511_880)
  })
})
