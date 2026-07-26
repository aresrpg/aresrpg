// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SIGNED-EFFECT WIRE DECODE (#904 final ruling), pinned to CAPTURED CHAIN BYTES — the sim half of the
// deterministic twin. The Move half is `aresrpg_fight::pure_tests::captured_centered_rows_fold_their_authored_delta`
// (packages/move/engine/tests/pure_tests.move) and folds the SAME two rows to the SAME deltas.
//
// Provenance — testnet `sui client object`, 2026-07-26 (the rows quoted in issue #904):
//   Razkin  0x4a00a579…be97 (version 45, digest 7i3f6jDBPuhsqGUU7P3jeTRdepwcN3bDZ9Ne5J65icBA)
//     spells[1].effects[0] = { kind: 9, stat: 8 (percent_damage), flags: 0, value: "32793", turns: 2 }
//     The published corpus authors that row as +25 ("Savage Fury", world_corpus.json) — 32793 = 32768 + 25.
//   Bonelet 0xb80ade53…d444 = { kind: 9, stat: 3 (agility), flags: 8, value: "32751" } — authors −17.
//   Kraken Leviathan 0x89072bd3…af56 = { kind: 9, stat: 6 (range), flags: 8, value: "32761" } — authors −7.
//
// The buff carries flags 0 and the debuff carries flags 8: any decoder that reads FLAG_NEGATIVE for the sign
// folds Razkin's row as a ~32768× buff and floors Bonelet's stat to 0. The sign is in the VALUE.

import { describe, expect, test } from 'bun:test'

import {
  K_ALTER_RESIST,
  K_ALTER_STAT,
  K_STEAL_STAT,
  FLAG_NEGATIVE,
  STAT_STRENGTH,
} from '../src/spell_effect.js'

import { raw_effect, spell_of } from './missing_effect_helpers.js'

const SIGNED_SHIFT = 32_768
const first_effect = effect =>
  spell_of('centered_decode', [effect]).levels[0].base_effects[0]

describe('signed effect values decode centered at 32768 (#904)', () => {
  test("Razkin's minted buff row folds its AUTHORED +25, not its raw 32793", () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, { stat: 8, value: 32_793, flags: 0, turns: 2 }),
    )
    expect(effect.type).toBe('ADD')
    expect(effect.stat).toBe('percent_damage')
    expect(effect.value).toBe(25)
  })

  test("Bonelet's minted debuff row folds its AUTHORED −17", () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, {
        stat: 3,
        value: 32_751,
        flags: FLAG_NEGATIVE,
        turns: 2,
      }),
    )
    expect(effect.type).toBe('REMOVE')
    expect(effect.stat).toBe('agility')
    expect(effect.value).toBe(17)
  })

  test("the Kraken's −7 range debuff decodes the same way", () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, {
        stat: 6,
        value: 32_761,
        flags: FLAG_NEGATIVE,
        turns: 2,
      }),
    )
    expect(effect.type).toBe('REMOVE')
    expect(effect.stat).toBe('range')
    expect(effect.value).toBe(7)
  })

  test('the flag is never the sign: an UNFLAGGED value below the centering is a debuff', () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, {
        stat: STAT_STRENGTH,
        value: SIGNED_SHIFT - 17,
        flags: 0,
        turns: 2,
      }),
    )
    expect(effect.type).toBe('REMOVE')
    expect(effect.value).toBe(17)
  })

  test('the flag is never the sign: a FLAGGED value above the centering is a buff', () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, {
        stat: STAT_STRENGTH,
        value: SIGNED_SHIFT + 25,
        flags: FLAG_NEGATIVE,
        turns: 2,
      }),
    )
    expect(effect.type).toBe('ADD')
    expect(effect.value).toBe(25)
  })

  test('the neutral point is exactly zero, not a 32768-strong buff', () => {
    const effect = first_effect(
      raw_effect(K_ALTER_STAT, {
        stat: STAT_STRENGTH,
        value: SIGNED_SHIFT,
        turns: 2,
      }),
    )
    expect(effect.type).toBe('ADD')
    expect(effect.value).toBe(0)
  })

  test('ALTER_RESIST (kind 11) is centered too — both directions', () => {
    const buff = first_effect(
      raw_effect(K_ALTER_RESIST, {
        element: 2,
        value: SIGNED_SHIFT + 15,
        turns: 2,
      }),
    )
    expect(buff.type).toBe('ADD')
    expect(buff.stat).toBe('earth_resistance')
    expect(buff.value).toBe(15)

    const shred = first_effect(
      raw_effect(K_ALTER_RESIST, {
        element: 2,
        value: SIGNED_SHIFT - 15,
        turns: 2,
      }),
    )
    expect(shred.type).toBe('REMOVE')
    expect(shred.stat).toBe('earth_resistance')
    expect(shred.value).toBe(15)
  })

  test('STEAL_STAT (kind 12) is NOT a signed kind — its value stays a plain magnitude', () => {
    // The chain splits a steal into two CENTERED alter rows at cast time (cast.move `apply_steal_stat`); the
    // authored effect itself carries the magnitude on both sides of the twin.
    const effect = first_effect(
      raw_effect(K_STEAL_STAT, { stat: STAT_STRENGTH, value: 11, turns: 3 }),
    )
    expect(effect.type).toBe('REMOVE')
    expect(effect.value).toBe(11)
  })
})
