// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LIFE-STEAL STEAL-BACK, chain-exact (#755). Two twin divergences and one blind spot lived on one line of
// the sim's STEAL branch; the chain is the reference:
//
//   cast.move:1385  `fun heal_caster(fight, caster_side, caster_idx, amount) {
//                      if (caster_side == PLAYER_SIDE) participant::apply_heal(...) }`
//     → a MOB caster's life-steal heals NOBODY on chain. The sim healed any caster.
//   retro_effects.move:258-266 — the `actual` heal_caster is fed (`actual / 2`, cast.move:1096/1197) is the hp
//     the VICTIM actually lost: a full redirect row hits the row's source and `return 0`, so a redirected steal
//     steals nothing back. The sim healed off the redirected damage.
//   The heal itself emitted NO effect row (#755) — the hp change happened inside the fold and no consumer
//     (sim_chain encoder, timeline, any projection) could carry it. It now rides the same `{ target_id, heal,
//     new_health }` shape its HEAL neighbour has always emitted.

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_LIFE_STEAL, TF_NOT_TEAM } from '../src/spell_effect.js'

import {
  CASTER_CELL,
  CAST_CTX,
  ENEMY_CELL,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

const STEAL = { kind: K_LIFE_STEAL, value: 40, target_filter: TF_NOT_TEAM }
const steal_spell = single_effect_spell('life_steal', STEAL, 3, false)

/** Set one fighter's current hp (both teams searched) so a heal is observable. */
const with_health = (state, id, health) => {
  const set = team => team.map(e => (e.id === id ? { ...e, health } : e))
  return { ...state, team0: set(state.team0), team1: set(state.team1) }
}

/** The row the damage half emits, and the row the steal-back half emits (absent = the bug). */
const damage_row = result => result.effects.find(e => e.damage != null)
const heal_rows = (result, caster_id) =>
  result.effects.filter(e => e.heal != null && e.target_id === caster_id)

describe('life-steal steal-back mirrors cast.move heal_caster (#755)', () => {
  test('a PLAYER caster heals half the damage dealt AND emits the heal as an effect row', () => {
    const before = with_health(fresh_state([]), 'p0', 100)
    const result = process_spell_cast(
      before,
      'p0',
      steal_spell,
      1,
      ENEMY_CELL,
      CAST_CTX,
    )
    expect(result.success).toBe(true)

    const dealt = damage_row(result).damage
    expect(dealt).toBeGreaterThan(0)
    const expected_heal = Math.floor(dealt / 2)
    const caster_after = find_entity(result.state, 'p0')
    expect(caster_after.health).toBe(100 + expected_heal)

    const rows = heal_rows(result, 'p0')
    expect(
      rows.length,
      'the caster heal emitted no effect row — invisible to every consumer (#755)',
    ).toBe(1)
    expect(rows[0]).toEqual({
      target_id: 'p0',
      heal: expected_heal,
      new_health: caster_after.health,
    })
  })

  test('a MOB caster heals NOTHING and emits no heal row — the chain gates on PLAYER_SIDE', () => {
    const before = with_health(fresh_state([]), 'm0', 100)
    const result = process_spell_cast(
      before,
      'm0',
      steal_spell,
      1,
      CASTER_CELL,
      CAST_CTX,
    )
    expect(result.success).toBe(true)
    expect(damage_row(result).damage).toBeGreaterThan(0)

    expect(
      find_entity(result.state, 'm0').health,
      'a mob caster healed itself — cast.move:1385 heals PLAYER_SIDE only',
    ).toBe(100)
    expect(heal_rows(result, 'm0')).toEqual([])
  })

  test('a REDIRECTED steal steals nothing back — the chain returns 0 for a full redirect', () => {
    // m0 carries a zero-value DAMAGE_REDIRECT row sourced by the living p1: the hit lands on p1 instead, and
    // retro_effects.move:260-261 returns 0, so `actual / 2` is 0 no matter how much p1 took.
    const base = with_health(fresh_state([]), 'p0', 100)
    const before = {
      ...base,
      team1: base.team1.map(e =>
        e.id === 'm0'
          ? {
              ...e,
              effects: [
                {
                  id: 900,
                  type: 'DAMAGE_REDIRECT',
                  timing: 'DIRECT',
                  source_id: 'p1',
                  value: 0,
                  turns_remaining: 3,
                },
              ],
            }
          : e,
      ),
    }
    const result = process_spell_cast(
      before,
      'p0',
      steal_spell,
      1,
      ENEMY_CELL,
      CAST_CTX,
    )
    expect(result.success).toBe(true)
    expect(damage_row(result).target_id).toBe('p1') // the redirect landed
    expect(find_entity(result.state, 'p0').health).toBe(100)
    expect(heal_rows(result, 'p0')).toEqual([])
  })
})
