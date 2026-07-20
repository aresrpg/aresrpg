// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ② ZERO-CASTER PARITY — a board hazard (trap/glyph) scales off the TARGET's resistances ONLY, never the placer's
// live stats. Twin of the chain (cast.move::apply_board_batch — `final_damage(base, el, &ZERO, target_stats)`):
// by detonation time the placer is dead/anonymous, so its damage stats must NOT amplify the payload.
//
// This locks the parity: a placer with +100 intelligence (which WOULD double a FIRE line if the caster scaled)
// must still detonate its trap for the flat base — the pre-fix code amplified off effective_stats(placer).

import { describe, test, expect } from 'bun:test'

import { fresh_state, ENEMY_CELL } from './spell_effect_conformance_matrix.js'
import { place_trap, check_traps } from '../src/fight_traps.js'
import { find_entity } from '../src/fight_state.js'

describe('hazard damage — zero-caster (target resists only, placer never amplifies)', () => {
  test('a +100 INT placer detonates a FIRE trap for the flat base, NOT the amplified value', () => {
    // p0 carries +100 intelligence — under placer-scaling this DOUBLES a FIRE line (factor 200). The target m0
    // has no fire resistance, so the only question is whether the placer amplified.
    const state = fresh_state([
      { id: 1, type: 'STAT_BUFF', timing: 'TURN_START', source_id: 'p0', stat: 'intelligence', value: 100, turns_remaining: 5 },
    ])
    const before = find_entity(state, 'm0').health
    // min===max===30 → the roll is deterministic; the ONLY variable is caster amplification.
    const placed = place_trap(state, 'p0', [ENEMY_CELL], [{ type: 'DAMAGE', element: 'FIRE', min: 30, max: 30 }], ENEMY_CELL)
    const fired = check_traps(placed, ENEMY_CELL, 'm0')
    expect(fired.triggered).toBe(true)
    const after = find_entity(fired.state, 'm0').health
    // zero-caster: exactly the base 30. Placer-scaling (the bug) would have dealt 60 (× factor 200).
    expect(before - after).toBe(30)
  })
})
