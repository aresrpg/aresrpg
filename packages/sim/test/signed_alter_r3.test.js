// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// R3 (owner ruling 2026-07-23) — SIGNED stat/resist deltas. Effect kinds 9/11 (alter_stat/alter_resist) store
// value/value_max CENTERED at 32768; the sim decodes through the ONE home `signed_delta` at its fight projection
// boundary (spell_templates::normalize_effect) and its chain-mirror fold (stats_derive::fold_alters). This file
// is the RED-FIRST proof (a centered debuff must NOT apply a huge positive) + the roll∘decode PARITY FIXTURE
// twinned byte-for-byte with spell_effect.move::t_signed_delta_centering_roundtrip.
import { describe, expect, test } from 'bun:test'

import {
  signed_delta,
  SIGNED_SHIFT,
  K_ALTER_STAT,
  K_ALTER_RESIST,
  K_DAMAGE,
} from '../src/spell_effect.js'
import { roll_in_range } from '../src/turn_seed.js'

import { raw_effect, spell_of } from './missing_effect_helpers.js'

describe('R3 signed alter (kind 9/11) decode', () => {
  test('signed_delta decodes centered magnitudes; raw kinds pass through', () => {
    expect(signed_delta(K_ALTER_STAT, SIGNED_SHIFT + 50)).toEqual([false, 50]) // +50 buff
    expect(signed_delta(K_ALTER_STAT, SIGNED_SHIFT - 33)).toEqual([true, 33]) // −33 debuff
    expect(signed_delta(K_ALTER_RESIST, SIGNED_SHIFT)).toEqual([false, 0]) // neutral (delta 0)
    expect(signed_delta(K_DAMAGE, 42)).toEqual([false, 42]) // raw kind — magnitude == value
  })

  // RED-FIRST: the projection is the sim's fight decode boundary. WITHOUT the decode, normalize read FLAG_NEGATIVE
  // (unset here) and passed the centered value straight through → type 'ADD', magnitude 32750 (a +32750 buff). With
  // the decode a centered −18 debuff projects to a REMOVE of magnitude 18 — the negative delta the chain applies.
  test('a centered kind-9 debuff projects to a negative (REMOVE) delta, not a huge positive', () => {
    const spell = spell_of('r3_debuff', [
      raw_effect(K_ALTER_STAT, { stat: 0, value: SIGNED_SHIFT - 18, turns: 2 }),
    ])
    const e = spell.levels[0].base_effects[0]
    expect(e.type).toBe('REMOVE')
    expect(e.min).toBe(18)
    expect(e.max).toBe(18)
  })

  test('a centered kind-9 buff projects to a positive (ADD) delta', () => {
    const spell = spell_of('r3_buff', [
      raw_effect(K_ALTER_STAT, { stat: 0, value: SIGNED_SHIFT + 12, turns: 2 }),
    ])
    const e = spell.levels[0].base_effects[0]
    expect(e.type).toBe('ADD')
    expect(e.min).toBe(12)
    expect(e.max).toBe(12)
  })

  // A centered RANGED debuff (delta −33..−8 ⇒ centered 32735..32760): the projection decodes the sign and the
  // magnitude RANGE (endpoints swap for negatives — the more-negative centered endpoint is the larger magnitude).
  test('a centered ranged debuff projects sign + the [8, 33] magnitude range', () => {
    const spell = spell_of('r3_ranged', [
      raw_effect(K_ALTER_STAT, {
        stat: 0,
        value: SIGNED_SHIFT - 33,
        value_max: SIGNED_SHIFT - 8,
        turns: 2,
      }),
    ])
    const e = spell.levels[0].base_effects[0]
    expect(e.type).toBe('REMOVE')
    expect(e.min).toBe(8)
    expect(e.max).toBe(33)
  })

  // PARITY FIXTURE — the exact twin of spell_effect.move::t_signed_delta_centering_roundtrip. roll_in_range on the
  // CENTERED endpoints of a −33..−8 debuff, then signed_delta, yields the identical (sign, magnitude) the chain
  // decodes for the same roll fraction. Chain and client pick the identical delta ⇒ preview == settlement.
  test('ranged debuff roll∘decode parity vector (−33..−8 · rolls 0/5000/9999)', () => {
    const lo = SIGNED_SHIFT - 33 // 32735
    const hi = SIGNED_SHIFT - 8 //  32760
    expect(signed_delta(K_ALTER_STAT, roll_in_range(lo, hi, 0))).toEqual([true, 33])
    expect(signed_delta(K_ALTER_STAT, roll_in_range(lo, hi, 5000))).toEqual([
      true, 20,
    ])
    expect(signed_delta(K_ALTER_STAT, roll_in_range(lo, hi, 9999))).toEqual([
      true, 8,
    ])
  })
})
