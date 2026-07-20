// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_CARRY, K_SWAP_POSITIONS, K_THROW, TF_NOT_TEAM } from '../src/spell_effect.js'
import {
  CAST_CTX,
  ENEMY_CELL,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kinds 15/16/17 — the last three displacement convictions
// (K_SWAP_POSITIONS / K_CARRY / K_THROW, 1 slot each). Each declares a Pandawa-class displacement and NOTHING
// happens in FightState (normalize_effect has no case → UNSUPPORTED no-op → the victim never leaves 4,4). The
// matrix conviction for all three is verbatim "victim did not move (stayed 4,4)"; these reproduce exactly that.
// The DECLARED semantics are Move's own (spell_effect.move:39-41, the k_* getter comments) — the engine arm is
// UNWIRED (cast.move:609-612 record_timed catch-all on the player path; no-op on mobs), so the sim mirrors the
// declared cell-moves first, matrix-gated; the chain arm rides the next train. Representative convicted slots
// (real corpus payloads, seed/mainnet/spells; all target_filter 1 = NOT_TEAM → the enemy m0 is the victim):
//   ikari_blood_trade base0: kind 15 (SWAP),  value 1
//   shusen_hoist      base0: kind 16 (CARRY),  value 1
//   shusen_heave      base0: kind 17 (THROW),  value 1
// A green here mirrors the existing displacement events ({ target_id, cell, has_cell }) so the render pipeline
// sees the standard Displaced shape — identical to PUSH/PULL/TELEPORT.

const cast_displacement = raw => {
  const before = fresh_state([])
  const spell = single_effect_spell(`disp_${raw.kind}`, raw, 3, false)
  return {
    before,
    caster_cell: find_entity(before, 'p0').cell,
    enemy_cell: find_entity(before, 'm0').cell,
    result: process_spell_cast(before, 'p0', spell, 1, ENEMY_CELL, CAST_CTX),
  }
}

const moved_event = (result, id) =>
  (result.effects ?? []).some(e => e.has_cell && e.target_id === id)

describe('K_SWAP_POSITIONS — caster and target exchange cells (matrix kind 15 burn-down)', () => {
  test('swap (ikari_blood_trade base0: kind 15, enemy) exchanges the caster and target cells', () => {
    const { caster_cell, enemy_cell, result } = cast_displacement({
      kind: K_SWAP_POSITIONS,
      value: 1,
      target_filter: TF_NOT_TEAM,
    })
    expect(result.success).toBe(true)
    const enemy_after = find_entity(result.state, 'm0')
    const caster_after = find_entity(result.state, 'p0')
    // The victim MOVED off 4,4 — the matrix conviction "victim did not move (stayed 4,4)" is closed.
    expect(
      enemy_after.cell,
      `victim did not move (stayed ${enemy_cell.x},${enemy_cell.y})`,
    ).not.toEqual(enemy_cell)
    // Atomic exchange: the enemy took the caster's cell, the caster took the enemy's.
    expect(enemy_after.cell).toEqual(caster_cell)
    expect(caster_after.cell).toEqual(enemy_cell)
    // Both sides emit the standard Displaced event (has_cell) — render-pipeline parity with PUSH/TELEPORT.
    expect(moved_event(result, 'm0')).toBe(true)
    expect(moved_event(result, 'p0')).toBe(true)
  })
})

describe('K_CARRY — the target is picked up onto the caster cell (matrix kind 16 burn-down)', () => {
  test('carry (shusen_hoist base0: kind 16, enemy) relocates the target onto the caster cell', () => {
    const { caster_cell, enemy_cell, result } = cast_displacement({
      kind: K_CARRY,
      value: 1,
      target_filter: TF_NOT_TEAM,
    })
    expect(result.success).toBe(true)
    const enemy_after = find_entity(result.state, 'm0')
    expect(
      enemy_after.cell,
      `victim did not move (stayed ${enemy_cell.x},${enemy_cell.y})`,
    ).not.toEqual(enemy_cell)
    // "pick an adjacent fighter onto caster's cell" — the target co-locates with the caster (the carried state).
    expect(enemy_after.cell).toEqual(caster_cell)
    expect(moved_event(result, 'm0')).toBe(true)
  })
})

describe('K_THROW — the target is heaved along the throw ray (matrix kind 17 burn-down)', () => {
  test('throw (shusen_heave base0: kind 17, enemy) displaces the target off its cell', () => {
    const { enemy_cell, result } = cast_displacement({
      kind: K_THROW,
      value: 1,
      target_filter: TF_NOT_TEAM,
    })
    expect(result.success).toBe(true)
    const enemy_after = find_entity(result.state, 'm0')
    expect(
      enemy_after.cell,
      `victim did not move (stayed ${enemy_cell.x},${enemy_cell.y})`,
    ).not.toEqual(enemy_cell)
    // Heaved along the caster->target ray (caster 2,4 through 4,4) by value=1, via the displacement module → 5,4.
    expect(enemy_after.cell).toEqual({ x: 5, y: 4 })
    expect(moved_event(result, 'm0')).toBe(true)
  })
})
