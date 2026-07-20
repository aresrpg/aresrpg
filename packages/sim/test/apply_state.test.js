// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_APPLY_STATE, TF_NOT_TEAM, TF_ONLY_CASTER } from '../src/spell_effect.js'
import {
  CAST_CTX,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kind 22 (K_APPLY_STATE — 24 slots / 9 spells): a spell declares
// "apply named state X" and NOTHING lands in FightState (normalize_effect → UNSUPPORTED no-op). Representative
// convicted slots (real corpus payloads, seed/mainnet/spells):
//   ikari_blood_toll  base0 → self  named-state 788, 5 turns, target_filter 32 (ONLY_CASTER)
//   ikari_bloodletting base5 → enemy named-state 42, 1 turn,  target_filter 1  (NOT_TEAM)
// Postcondition (matrix `status` class): the victim's effects list GAINS a row. Parity extra: that row is the
// named state itself — value == state_id, turns_remaining == turns — so a future required/forbidden-states gate
// reads it the same way Move's spell_board::fighter_has_state does (kind == k_apply_state && value == state_id).

const cast_named_state = (raw, caster_id, target_cell) => {
  const state = fresh_state([])
  const spell = single_effect_spell(`apply_state_${raw.value}`, raw, 3, false)
  return {
    before: state,
    result: process_spell_cast(state, caster_id, spell, 1, target_cell, CAST_CTX),
  }
}

describe('K_APPLY_STATE — a named state row lands in FightState (matrix kind 22 burn-down)', () => {
  test('self-target (ikari_blood_toll base0: state 788, 5 turns) writes the state row on the caster', () => {
    const caster_cell = find_entity(fresh_state([]), 'p0').cell
    const { before, result } = cast_named_state(
      { kind: K_APPLY_STATE, value: 788, turns: 5, target_filter: TF_ONLY_CASTER },
      'p0',
      caster_cell,
    )
    expect(result.success).toBe(true)
    const b = find_entity(before, 'p0')
    const a = find_entity(result.state, 'p0')
    expect(a.effects.length).toBeGreaterThan(b.effects.length)
    const row = a.effects.find(e => e.value === 788)
    expect(row, 'named state 788 not stored on caster').toBeDefined()
    expect(row.turns_remaining).toBe(5)
  })

  test('enemy-target (ikari_bloodletting base5: state 42, 1 turn) writes the state row on the enemy', () => {
    const enemy_cell = find_entity(fresh_state([]), 'm0').cell
    const { before, result } = cast_named_state(
      { kind: K_APPLY_STATE, value: 42, turns: 1, target_filter: TF_NOT_TEAM },
      'p0',
      enemy_cell,
    )
    expect(result.success).toBe(true)
    const b = find_entity(before, 'm0')
    const a = find_entity(result.state, 'm0')
    expect(a.effects.length).toBeGreaterThan(b.effects.length)
    const row = a.effects.find(e => e.value === 42)
    expect(row, 'named state 42 not stored on enemy').toBeDefined()
    expect(row.turns_remaining).toBe(1)
  })
})
