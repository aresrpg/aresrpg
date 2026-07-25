// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GOLDEN — `scaled_hp` twin parity. Every vector below is copied VERBATIM from the Move tests that assert
// the source formula (packages/move/foundation/tests/mob_ai_tests.move `t_scaled_hp_scaling_and_degenerate_range`
// and packages/move/engine/tests/pure_tests.move), so a silent JS drift from the on-chain derivation fails here.
import { describe, expect, test } from 'bun:test'

import { scaled_hp } from '../src/mob_stats.js'

// The Move asserts, one-for-one. base 100 over the band [10,20]: 0.7× at the floor, 1.05× mid, 1.4× at the cap.
const MOVE_ASSERTS = [
  // mob_ai_tests.move:18-21
  { args: [100, 10, 20, 10], hp: 70 },
  { args: [100, 10, 20, 15], hp: 105 },
  { args: [100, 10, 20, 20], hp: 140 },
  { args: [100, 10, 10, 15], hp: 100 }, // degenerate range (max == min) -> base verbatim
  // pure_tests.move:130-134 (same formula through mob::scaled_hp_for_testing)
  { args: [100, 5, 5, 5], hp: 100 },
]

describe('scaled_hp — the mob_ai.move twin', () => {
  for (const { args, hp } of MOVE_ASSERTS)
    test(`scaled_hp(${args.join(', ')}) === ${hp}`, () => {
      expect(scaled_hp(...args)).toBe(hp)
    })

  // The Move operator is u64 `/` — TRUNCATING. No Move test pins a remainder case, so this one pins the
  // SEMANTIC: 10*7*(10+1) / (10*10) = 770/100 = 7.7 in Move's u64 arithmetic -> 7. A JS port that forgets to
  // floor returns 7.7 and drifts from the chain on every odd band.
  test('u64 division truncates — 10 base over [10,20] at level 11 is 7, not 7.7', () => {
    expect(scaled_hp(10, 10, 20, 11)).toBe(7)
  })

  // Move u64 subtraction ABORTS on underflow, so `level < min_level` is not a value the chain can produce.
  // The mirror refuses it loudly instead of returning a nonsense (negative-derived) hp.
  test('a level below the band throws, mirroring the Move u64 underflow abort', () => {
    expect(() => scaled_hp(100, 10, 20, 9)).toThrow()
  })
})
