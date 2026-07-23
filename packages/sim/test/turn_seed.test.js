// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { mix, scramble } from '../src/prng.js'
import { turn_seed, slot_crit_roll, crit_at } from '../src/turn_seed.js'

// ── PARITY FIXTURES — the Move source of truth is the oracle ────────────────────────────────────────────────
// Golden vectors extracted from the REAL Move packages via a `sui move test` debug-print probe (scratchpad
// parity_probe over aresrpg_foundation, sui 1.74.1): each tuple ran fight.move's exact turn_seed fold
// (mix(mix(mix(world_seed, spawn_id), deadline_ms), seat)) + spell_formula::slot_crit_roll on-VM, and the
// printed values are pinned here. The JS mirror MUST reproduce them byte-for-byte or client crit previews
// desync from chain settlement. crit_at edges are copied verbatim from spell_formula's t_crit_at_bp_threshold.

describe('turn-seed parity (Move golden vectors)', () => {
  test('mix/scramble match the prng.move pinned cross-vectors', () => {
    // prng.move scramble_and_mix_are_deterministic pins these two against the SAME numbers.
    expect(scramble(0)).toBe(1144304738)
    expect(mix(0, 0)).toBe(1144304738)
    // #574: the hardened Move twin masks before its checked add, so 1 + u64::MAX wraps to the scramble(0) vector.
    expect(mix(1n, 18_446_744_073_709_551_615n)).toBe(1144304738)
    // order-sensitive folds (the Move test's mix(mix(7,3),9) != mix(mix(7,9),3) assertion)
    expect(mix(mix(7, 3), 9)).not.toBe(mix(mix(7, 9), 3))
  })

  test('turn_seed + slot_crit_roll reproduce the Move-extracted goldens', () => {
    // tuple A: realistic values
    const a = turn_seed({
      world_seed: 123456789,
      spawn_id: 42,
      turn_deadline_ms: 1752192000000,
      seat: 0,
    })
    expect(a).toBe(4190174188)
    expect(slot_crit_roll(a, 0)).toBe(2816)
    expect(slot_crit_roll(a, 1)).toBe(4768)
    expect(slot_crit_roll(a, 2)).toBe(1518)
    // tuple B: u64-large world_seed (> 2^53) — the BigInt reduction path (Number would lose precision)
    const b = turn_seed({
      world_seed: 16045690984503098046n,
      spawn_id: 7n,
      turn_deadline_ms: 1752192065535n,
      seat: 3n,
    })
    expect(b).toBe(3110118064)
    expect(slot_crit_roll(b, 0)).toBe(8707)
    expect(slot_crit_roll(b, 5)).toBe(1837)
    // tuple C: all zeros
    const c = turn_seed({
      world_seed: 0,
      spawn_id: 0,
      turn_deadline_ms: 0,
      seat: 0,
    })
    expect(c).toBe(2245583870)
    expect(slot_crit_roll(c, 0)).toBe(6605)
    // tuple D: same fight, different seat -> a different stream (seat-bound sequences)
    const d = turn_seed({
      world_seed: 123456789,
      spawn_id: 42,
      turn_deadline_ms: 1752192000000,
      seat: 1,
    })
    expect(d).toBe(4068998909)
    expect(slot_crit_roll(d, 0)).toBe(4166)
  })

  test('crit_at matches spell_formula t_crit_at_bp_threshold verbatim', () => {
    expect(crit_at(4999, 2, 0)).toBe(true) // 1-in-2 -> threshold 5000
    expect(crit_at(5000, 2, 0)).toBe(false)
    expect(crit_at(499, 20, 0)).toBe(true) // 1-in-20 (5%) -> threshold 500
    expect(crit_at(500, 20, 0)).toBe(false)
    expect(crit_at(0, 0, 0)).toBe(false) // rate 0 NEVER crits
    // 50% cap: crit_bonus can't drive effective below 2 (threshold stays 5000, not 10000)
    expect(crit_at(4999, 3, 100)).toBe(true)
    expect(crit_at(5000, 3, 100)).toBe(false)
  })

  test('slot rolls are deterministic, index-bound, and in [0, 10000)', () => {
    const ts = 123456789
    expect(slot_crit_roll(ts, 0)).toBe(slot_crit_roll(ts, 0)) // same (seed, slot) -> same roll
    expect(slot_crit_roll(ts, 0)).not.toBe(slot_crit_roll(ts, 1)) // index-bound
    for (let slot = 0; slot < 64; slot++) {
      const roll = slot_crit_roll(ts, slot)
      expect(Number.isInteger(roll)).toBe(true)
      expect(roll).toBeGreaterThanOrEqual(0)
      expect(roll).toBeLessThan(10000)
    }
  })

  test('crit frequency over 10k decorrelated seeds ~ 1-in-20 (mirrors t_distribution_rates over scramble seeds)', () => {
    let crits = 0
    for (let i = 0; i < 10000; i++)
      if (crit_at(slot_crit_roll(scramble(i), 0), 20, 0)) crits++
    expect(crits).toBeGreaterThanOrEqual(380) // the Move test's own generous chi band
    expect(crits).toBeLessThanOrEqual(620)
  })
})
