// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HP KERNEL PARITY — proves hp_math.js reproduces aresrpg_foundation::progression_math BYTE-FOR-BYTE (the same
// integer arithmetic, the same branch table). Vectors mirror the Move module's OWN tests
// (packages/move/foundation/sources/progression_math.move `max_hp_slope_and_floor` + `regen_carries_remainder`)
// so a drift in either side fails here. Plus the remainder-carry starvation guard that the flat "1%/min" formula
// this replaces did NOT have, and the identity pin that keeps the max-HP kernel single-homed in the SDK (#878).
import { describe, expect, test } from 'bun:test'
import * as sdk_stats from '@aresrpg/sdk/stats'

import { base_hp_for_class, max_hp_from_base, regen_hp } from './hp_math.js'

describe('the max-HP kernel has ONE home: the SDK (#878 / #880)', () => {
  test('the client kernel IS the SDK kernel — same function object, not a copy that can drift', () => {
    expect(max_hp_from_base).toBe(sdk_stats.max_hp_from_base)
    expect(base_hp_for_class).toBe(sdk_stats.base_hp_for_class)
  })
})

describe('max_hp_from_base — mirrors progression_math.move max_hp_slope_and_floor', () => {
  test('level 1 → base verbatim (no growth term)', () => {
    expect(max_hp_from_base(70, 1, 0)).toBe(70)
  })
  test('level 10 → base + 9·5 growth', () => {
    expect(max_hp_from_base(70, 10, 0)).toBe(115)
  })
  test('level 10 + vitality 25 → base + growth + vitality', () => {
    expect(max_hp_from_base(70, 10, 25)).toBe(140)
  })
  test('level 0/1 never underflows the (level−1) growth', () => {
    expect(max_hp_from_base(30, 0, 0)).toBe(30)
    expect(max_hp_from_base(30, 1, 0)).toBe(30)
  })
})

describe('regen_hp — mirrors progression_math.move regen_carries_remainder (senshi L1, num 156)', () => {
  test('5000ms → +10 whole HP; stamp advances by the CONSUMED ms only (9807), not to now', () => {
    const [hp, stamp] = regen_hp(25, 5_000, 70, 1, 0, 10_000)
    expect(hp).toBe(35)
    expect(stamp).toBe(5_000 + Math.floor((10 * 75_000) / 156)) // 9807 — the 193ms fraction stays on the clock
    expect(stamp).toBe(9_807)
  })
  test('sub-unit window → BOTH hp and stamp unchanged (the carry law — the whole span rolls forward)', () => {
    const [hp, stamp] = regen_hp(25, 5_000, 70, 1, 0, 5_400)
    expect(hp).toBe(25)
    expect(stamp).toBe(5_000)
  })
  test('tops out → pin to max, stamp now (overshoot fraction discarded at full HP)', () => {
    const [hp, stamp] = regen_hp(69, 0, 70, 1, 0, 1_000_000)
    expect(hp).toBe(70)
    expect(stamp).toBe(1_000_000)
  })
  test('already full (hp >= max) ⇒ pin to max, stamp now', () => {
    expect(regen_hp(70, 500, 70, 1, 0, 9_000)).toEqual([70, 9_000])
  })
  test('clock skew (now <= updated) ⇒ unchanged', () => {
    expect(regen_hp(40, 6_000, 70, 1, 0, 6_000)).toEqual([40, 6_000])
    expect(regen_hp(40, 6_000, 70, 1, 0, 1_000)).toEqual([40, 6_000])
  })
})

describe('regen_hp — wisdom term is faithful to the kernel (num = 150 + level·6 + wisdom·2)', () => {
  test('wisdom raises the accrual (num 156 → 186 at wisdom 15) — proves the port is not hardcoded to 0', () => {
    // level 1: num(wis 0) = 156, num(wis 15) = 150 + 6 + 30 = 186. Over 20_000ms from a deep-damaged char:
    // accrued(0)  = floor(20000·156/75000) = floor(41.6)  = 41 → 41 hp
    // accrued(15) = floor(20000·186/75000) = floor(49.6)  = 49 → 49 hp (wisdom regenerates faster)
    expect(regen_hp(0, 0, 300, 1, 0, 20_000)[0]).toBe(41)
    expect(regen_hp(0, 0, 300, 1, 15, 20_000)[0]).toBe(49)
  })
  test('num scales with level too (level 100, wisdom 0): num = 150 + 600 = 750', () => {
    // accrued = floor(10000·750/75000) = floor(100) = 100
    expect(regen_hp(0, 0, 300, 100, 0, 10_000)[0]).toBe(100)
  })
})

describe('regen_hp — remainder-carry STARVATION guard (the bug the flat 1%/min replacement never had)', () => {
  test('a sub-unit tick NEVER advances the stamp (else slow ticks would starve to 0 HP forever)', () => {
    // 400ms at num 156 accrues floor(400·156/75000)=0 whole HP. A naive re-stamp-to-now would discard the 400ms;
    // the carry law keeps the stamp at its prior value so the fraction accumulates across ticks.
    const [hp, stamp] = regen_hp(25, 0, 70, 1, 0, 400)
    expect(hp).toBe(25)
    expect(stamp).toBe(0) // NOT advanced to 400 — the whole span carries forward
  })
  test('stepwise regen reaches the same HP as one-shot (fraction never lost across tick boundaries)', () => {
    const [one_shot] = regen_hp(25, 5_000, 70, 1, 0, 15_000)
    const step1 = regen_hp(25, 5_000, 70, 1, 0, 10_000) // [35, 9807]
    const step2 = regen_hp(step1[0], step1[1], 70, 1, 0, 15_000) // carry the stamp
    expect(step2[0]).toBe(one_shot) // both 45 — no HP starved by re-stamping
  })
})

describe('base_hp_for_class — config default_classes mirror (§17.31 / ANNEX §4)', () => {
  test('per-class bases match config.move default_classes', () => {
    expect(base_hp_for_class('senshi')).toBe(70)
    expect(base_hp_for_class('ikari')).toBe(120)
    expect(base_hp_for_class('yogen')).toBe(30)
    expect(base_hp_for_class('iyashi')).toBe(50)
  })
  test('unknown / null / empty class → senshi baseline 70 (total fn)', () => {
    expect(base_hp_for_class('mob')).toBe(70)
    expect(base_hp_for_class(null)).toBe(70)
    expect(base_hp_for_class(undefined)).toBe(70)
    expect(base_hp_for_class('')).toBe(70)
  })
})
