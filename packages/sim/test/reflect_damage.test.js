// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_REFLECT_DAMAGE, TF_NOT_ENEMY } from '../src/spell_effect.js'

import {
  CAST_CTX,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kind 25 (K_REFLECT_DAMAGE — 6 slots / 3 spells): a spell declares
// "reflect a flat amount of received damage" and NOTHING lands in FightState (normalize_effect → UNSUPPORTED
// no-op → effects 0->0; matrix `status` class = "no status row applied"). The DECLARED chain semantics
// (spell_effect.move:57 "reflect a flat amount of received damage; value = flat"): a TIMED defensive status row
// on the protected fighter (target_filter 4 = NOT_ENEMY → self/ally), recorded via record_timed (cast.move:681)
// and reverted on dispel (spell_board.move:277 status_needs_revert — the "reflect accumulator"). The sim mirrors
// the DAMAGE_REDIRECT idiom — a timed row the damage path consults — carrying value=flat + turns. The FLAT-reflect
// CONSUMPTION (distinct from DAMAGE_REDIRECT's PERCENT reflect, spell_effect.move:82) rides the next train.
// Representative convicted slots (real corpus payloads, seed/mainnet/spells; all target_filter 4 → ally p1):
//   iyashi_binding_word base0: value 2, 2 turns
//   tokei_backtick      crit0: value 4, 3 turns

const cast_reflect = raw => {
  const state = fresh_state([])
  const ally_cell = find_entity(state, 'p1').cell
  const spell = single_effect_spell(`reflect_${raw.value}`, raw, 3, false)
  return {
    before: state,
    result: process_spell_cast(state, 'p0', spell, 1, ally_cell, CAST_CTX),
  }
}

describe('K_REFLECT_DAMAGE — a flat-reflect status row lands on the protected fighter (matrix kind 25 burn-down)', () => {
  test('iyashi_binding_word base0 (flat 2, 2 turns) writes the reflect row on the ally', () => {
    const { before, result } = cast_reflect({
      kind: K_REFLECT_DAMAGE,
      value: 2,
      turns: 2,
      target_filter: TF_NOT_ENEMY,
    })
    expect(result.success).toBe(true)
    const b = find_entity(before, 'p1')
    const a = find_entity(result.state, 'p1')
    const row = a.effects.find(e => e.type === 'REFLECT_DAMAGE')
    expect(row, 'no status row applied — reflect did not land').toBeDefined()
    expect(a.effects.length).toBeGreaterThan(b.effects.length)
    expect(row.value).toBe(2)
    expect(row.turns_remaining).toBe(2)
  })

  test('tokei_backtick crit0 (flat 4, 3 turns) writes the reflect row on the ally', () => {
    const { before, result } = cast_reflect({
      kind: K_REFLECT_DAMAGE,
      value: 4,
      turns: 3,
      target_filter: TF_NOT_ENEMY,
    })
    expect(result.success).toBe(true)
    const b = find_entity(before, 'p1')
    const a = find_entity(result.state, 'p1')
    const row = a.effects.find(e => e.type === 'REFLECT_DAMAGE')
    expect(row, 'no status row applied — reflect did not land').toBeDefined()
    expect(a.effects.length).toBeGreaterThan(b.effects.length)
    expect(row.value).toBe(4)
    expect(row.turns_remaining).toBe(3)
  })
})
