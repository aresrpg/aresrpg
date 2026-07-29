// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { effective_stats, find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_STEAL_STAT, TF_NOT_TEAM } from '../src/spell_effect.js'

import {
  CAST_CTX,
  ENEMY_CELL,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kind 10 (K_STEAL_STAT — 12 slots / 5 spells): a spell declares
// "steal stat X" and NOTHING lands in FightState (normalize_effect → UNSUPPORTED no-op → effects 0->0). The
// DECLARED chain semantics (spell_effect.move:33 "debuff target + buff caster same stat; value = amount"): the
// TARGET loses `value` of the stat AND the CASTER gains the same, BOTH as timed rows that revert on expiry — the
// alter_stat idiom (STAT_DEBUFF/STAT_BUFF rows effective_stats folds and turn-end expiry decays). The chain
// arm rides the next train (cast.move:610 records the raw row only, no split yet); the sim mirrors it first,
// matrix-gated. Representative convicted slots (real corpus payloads, seed/mainnet/spells; all target_filter 1 =
// NOT_TEAM → the enemy m0 is the victim):
//   shugo_measured_riposte base1: stat 0 (strength), value 11, 3 turns
//   ikari_ironboot         base1: stat 3 (agility),  value 5,  3 turns

const cast_steal = raw => {
  const state = fresh_state([])
  const spell = single_effect_spell(
    `steal_${raw.stat}_${raw.value}`,
    raw,
    3,
    false,
  )
  return {
    before: state,
    result: process_spell_cast(state, 'p0', spell, 1, ENEMY_CELL, CAST_CTX),
  }
}

describe('K_STEAL_STAT — target debuffed + caster buffed, both timed (matrix kind 10 burn-down)', () => {
  test('strength steal (shugo_measured_riposte base1: stat 0, 11, 3t) debits the enemy and credits the caster', () => {
    const { before, result } = cast_steal({
      kind: K_STEAL_STAT,
      stat: 0,
      value: 11,
      turns: 3,
      target_filter: TF_NOT_TEAM,
    })
    expect(result.success).toBe(true)
    const b_enemy = find_entity(before, 'm0')
    const a_enemy = find_entity(result.state, 'm0')
    const a_caster = find_entity(result.state, 'p0')
    // TARGET LOSES the stat — a STAT_DEBUFF timed row lands on the enemy.
    expect(a_enemy.effects.length).toBeGreaterThan(b_enemy.effects.length)
    const debuff = a_enemy.effects.find(e => e.type === 'STAT_DEBUFF')
    expect(
      debuff,
      'no STAT_DEBUFF row on the target — stat steal did not debit',
    ).toBeDefined()
    expect(debuff.stat).toBe('strength')
    expect(debuff.value).toBe(11)
    expect(debuff.turns_remaining).toBe(3)
    // CASTER GAINS the same stat — the mirror STAT_BUFF timed row lands on the caster (both-sides parity).
    const buff = a_caster.effects.find(e => e.type === 'STAT_BUFF')
    expect(
      buff,
      'no STAT_BUFF row on the caster — steal did not credit the caster',
    ).toBeDefined()
    expect(buff.stat).toBe('strength')
    expect(buff.value).toBe(11)
    expect(buff.turns_remaining).toBe(3)
    // Both fold into effective_stats (the buff/debuff is FELT; the row's turn-decay reverts it on expiry).
    expect(effective_stats(a_enemy).strength).toBe(-11)
    expect(effective_stats(a_caster).strength).toBe(11)
  })

  test('agility steal (ikari_ironboot base1: stat 3, 5, 3t) debits the enemy and credits the caster', () => {
    const { result } = cast_steal({
      kind: K_STEAL_STAT,
      stat: 3,
      value: 5,
      turns: 3,
      target_filter: TF_NOT_TEAM,
    })
    expect(result.success).toBe(true)
    const a_enemy = find_entity(result.state, 'm0')
    const a_caster = find_entity(result.state, 'p0')
    const debuff = a_enemy.effects.find(e => e.type === 'STAT_DEBUFF')
    expect(debuff, 'no STAT_DEBUFF row on the target').toBeDefined()
    expect(debuff.stat).toBe('agility')
    expect(debuff.value).toBe(5)
    expect(debuff.turns_remaining).toBe(3)
    const buff = a_caster.effects.find(e => e.type === 'STAT_BUFF')
    expect(buff, 'no STAT_BUFF row on the caster').toBeDefined()
    expect(buff.stat).toBe('agility')
    expect(buff.value).toBe(5)
    expect(buff.turns_remaining).toBe(3)
    expect(effective_stats(a_enemy).agility).toBe(-5)
    expect(effective_stats(a_caster).agility).toBe(5)
  })
})
