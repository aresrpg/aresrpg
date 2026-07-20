// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { FLAG_DISPELLABLE, K_DISPEL, TF_NOT_TEAM } from '../src/spell_effect.js'
import {
  CAST_CTX,
  ENEMY_CELL,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kind 26 (K_DISPEL — 2 slots / 2 spells): a spell declares "strip
// dispellable buffs/debuffs from target" and NOTHING is stripped (normalize_effect → UNSUPPORTED no-op → the
// seeded dispellable buff survives; matrix `dispel` class = "dispellable buff still present"). The DECLARED chain
// semantics (spell_effect.move:58 "strip dispellable buffs/debuffs from target"; FLAG_DISPELLABLE marks the
// strippable rows — spell_effect.move:200 "else survives Dispel"; the F5 band forces negative alter rows
// dispellable): the sim strips exactly the target's FLAG_DISPELLABLE rows, leaving non-dispellable rows (STUN,
// etc.) intact. Move's foundation primitive `dispel_fighter` (spell_board.move:257, 0 callers) is the coarse
// "strip all"; the flag-filtering cast-resolver arm rides the next train. Convicted slots (real corpus,
// target_filter 1 → enemy m0): mori_spiteful_thorn base0 (value 0, 1 turn), rojin_wraithspade crit0 (value 0).

const DISPELLABLE_BUFF = {
  id: 987654,
  type: 'STAT_BUFF',
  timing: 'TURN_START',
  source_id: 'seed',
  stat: 'strength',
  value: 5,
  turns_remaining: 3,
  flags: FLAG_DISPELLABLE,
}
const STICKY_STUN = {
  id: 111,
  type: 'STUN',
  timing: 'TURN_START',
  source_id: 'seed',
  value: 0,
  turns_remaining: 2,
}

const cast_dispel = seeded => {
  const state = fresh_state([])
  find_entity(state, 'm0').effects = seeded
  const spell = single_effect_spell(
    'dispel',
    { kind: K_DISPEL, value: 0, turns: 1, target_filter: TF_NOT_TEAM },
    6,
    false,
  )
  return process_spell_cast(state, 'p0', spell, 1, ENEMY_CELL, CAST_CTX)
}

describe('K_DISPEL — dispellable rows on the target are stripped (matrix kind 26 burn-down)', () => {
  test('mori_spiteful_thorn base0 strips the enemy dispellable buff', () => {
    const result = cast_dispel([{ ...DISPELLABLE_BUFF }])
    expect(result.success).toBe(true)
    const a = find_entity(result.state, 'm0')
    expect(
      a.effects.some(e => e.id === 987654),
      'dispellable buff still present (dispel did not strip it)',
    ).toBe(false)
  })

  test('dispel strips ONLY dispellable rows — a non-dispellable STUN survives (flag-gated parity)', () => {
    const result = cast_dispel([{ ...DISPELLABLE_BUFF }, { ...STICKY_STUN }])
    expect(result.success).toBe(true)
    const a = find_entity(result.state, 'm0')
    expect(
      a.effects.some(e => e.id === 987654),
      'dispellable buff still present (dispel did not strip it)',
    ).toBe(false)
    expect(
      a.effects.some(e => e.id === 111),
      'a non-dispellable STUN was wrongly stripped by dispel',
    ).toBe(true)
  })
})
