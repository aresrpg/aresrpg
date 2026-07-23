// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { mix, scramble } from '../src/prng.js'
import {
  turn_seed,
  slot_crit_roll,
  crit_at,
  slot_damage_roll,
  roll_in_range,
} from '../src/turn_seed.js'

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

  // ── #577 DAMAGE roll — the same seeds pinned on BOTH twins (spell_formula::t_slot_damage_roll_parity_vectors) ──
  test('slot_damage_roll reproduces the Move goldens and is decorrelated from crit', () => {
    // the turn_seed values are the fight::turn_seed goldens above (tuples A–D); slot_damage_roll(seed, slot) is
    // pinned identically in aresrpg_foundation::spell_formula so a drift on EITHER twin breaks its suite.
    expect(slot_damage_roll(4190174188, 0)).toBe(9589)
    expect(slot_damage_roll(4190174188, 1)).toBe(3257)
    expect(slot_damage_roll(4190174188, 2)).toBe(3915)
    expect(slot_damage_roll(3110118064, 0)).toBe(7992)
    expect(slot_damage_roll(3110118064, 5)).toBe(9380)
    expect(slot_damage_roll(2245583870, 0)).toBe(2410)
    expect(slot_damage_roll(4068998909, 0)).toBe(2904) // seat-bound: ≠ tuple A's slot-0 roll
    // a distinct domain tag from crit ⇒ a different number at the same (seed, slot)
    expect(slot_damage_roll(4190174188, 0)).not.toBe(
      slot_crit_roll(4190174188, 0),
    )
  })

  test('roll_in_range maps the roll onto [min,max] identically to spell_formula::roll_in_range', () => {
    // mapped goldens (chain-pinned)
    expect(roll_in_range(10, 20, slot_damage_roll(4190174188, 0))).toBe(20)
    expect(roll_in_range(5, 9, slot_damage_roll(4190174188, 0))).toBe(9)
    expect(roll_in_range(100, 200, slot_damage_roll(3110118064, 0))).toBe(180)
    // endpoints + degenerate (mirror spell_formula t_roll_in_range_endpoints_and_degenerate)
    expect(roll_in_range(10, 20, 0)).toBe(10)
    expect(roll_in_range(10, 20, 9999)).toBe(20)
    expect(roll_in_range(10, 20, 5000)).toBe(15)
    expect(roll_in_range(7, 7, 9999)).toBe(7) // min==max ⇒ fixed
    expect(roll_in_range(7, 3, 9999)).toBe(7) // malformed max<min ⇒ min
  })

  test('#574-SIBLING — roll_in_range holds byte-parity on a large-but-safe span (degenerate-multiply twin risk)', () => {
    // roll * span is checked-u64 on the Move side (aborts clean past ~1.8e15) but a JS Number here — silently
    // imprecise past ~9e11 with no abort, the SAME class of twin break #574 fixed for mix(), on a different
    // multiply. This pins a span an order below the JS boundary (8e11) so both twins are proven identical at
    // real stress magnitude, mirroring spell_formula::t_roll_in_range_endpoints_and_degenerate's #6 case exactly.
    // A span beyond ~9e11 is a seed-validator concern (the content pipeline's authored value_max cap, armed
    // separately) — never a runtime path either twin has to defend past this point.
    expect(roll_in_range(0, 799999999999, 9999)).toBe(799920000000)
  })

  test('damage roll spans its range over 10k decorrelated seeds (both endpoints hit, mean central)', () => {
    let lo = false
    let hi = false
    let sum = 0
    for (let i = 0; i < 10000; i++) {
      const v = roll_in_range(1, 10, slot_damage_roll(scramble(i), 0))
      if (v === 1) lo = true
      if (v === 10) hi = true
      sum += v
    }
    expect(lo && hi).toBe(true)
    const mean = Math.floor(sum / 10000)
    expect(mean).toBeGreaterThanOrEqual(4)
    expect(mean).toBeLessThanOrEqual(6)
  })
})
