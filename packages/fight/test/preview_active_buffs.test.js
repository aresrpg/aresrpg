// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1083 RED-FIRST — THE PREVIEW UNDER-PROMISED WHAT THE CHAIN LANDED.
//
// `statuses.status_row_of` is the sim→chain door and it is TOTAL: every timed stat row a fighter carries has a
// status row. The REVERSE door — `statuses.sim_effects_of`, the one every predicting surface reads its caster's
// live effects through — promoted exactly TWO kinds into sim mechanics: a RANGE alter row and invisibility.
// So an active `+20 Strength` or `+110% Damage` was PRESENTATION ONLY: the floater under the cursor priced the
// unbuffed number while the chain resolved the buffed one, and the outcome preview inherited the same lie.
//
// The two doors are inverses of each other, and this file pins that: what `status_row_of` writes to the status
// home, `sim_effects_of` must read back as the SAME sim row. Then the driven leg — a real store, a real
// snapshot carrying the chain's status rows, the real `predict_cast` path — proves the number MOVES.

import { describe, expect, test } from 'bun:test'

import { normalize_spell_templates } from '../../sim/src/spell_templates.js'
import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { predict_cast } from '../src/predict_cast.js'
import { range_bonus_of, sim_effects_of, status_row_of } from '../src/statuses.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1083'
const CHAR = '0xc1083'
const CASTER = encode(2, 4)
const TARGET = encode(4, 4)

/** A chain-shaped status row as `read_fighter_statuses` hands it to the fold — value ALREADY decoded (#886). */
const status = (over = {}) => ({
  fighter: 0,
  kind: SE.K_ALTER_STAT,
  remaining_turns: 3,
  element: null,
  value: 20,
  stat: SE.STAT_STRENGTH,
  chance: 100,
  source: 0,
  ...over,
})

const fight_object = (statuses, base_stats) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 120,
      max_hp: 200,
      ap: 99,
      mp: 20,
      base_ap: 99,
      base_mp: 20,
      cell: CASTER,
      base_stats: { strength: 0, raw_damage: 0, percent_damage: 0, ...base_stats },
    },
  ],
  mobs: [{ hp: 400, max_hp: 400, ap: 99, mp: 20, cell: TARGET, base_stats: {} }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 100_000,
  invisibility_statuses: statuses,
})

/** A plain 100-damage earth strike — every point of Strength and every flat damage bonus shows up in it. */
const STRIKE = normalize_spell_templates([
  {
    id: 'preview_probe',
    levels: [
      {
        ap_cost: 3,
        range_min: 0,
        range_max: 9,
        crit_rate: 0,
        line_of_sight: false,
        effects: [
          {
            kind: SE.K_DAMAGE,
            element: 2, // earth — scales with Strength
            value: 100,
            area_shape: SE.SHAPE_POINT,
            area_size: 0,
            target_filter: SE.TF_NOT_TEAM,
            chance: 100,
            turns: 0,
            stat: 0,
            flags: 0,
            phase: SE.PHASE_ON_ENTER,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]).get('preview_probe')

const view_with = (statuses, base_stats) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object(statuses, base_stats), version: 5 }, 10_000)
  return engine_view(store.getState())
}

/** The mob's remaining HP the preview promises for one strike — the exact number the floater renders. */
const previewed_hp = (statuses, base_stats) =>
  predict_cast({
    view: view_with(statuses, base_stats),
    caster_id: CHAR,
    spell: STRIKE,
    spell_level: 1,
    target_cell: TARGET,
    critical: false,
  })?.actions.find((action) => action.kind === 'Hit')?.remaining_hp ?? null

describe('#1083 the reverse door promotes every stat row prediction can price', () => {
  test('RED: an active +20 Strength buff moves the damage preview', () => {
    const unbuffed = previewed_hp([])
    const buffed = previewed_hp([status()])

    expect(unbuffed).toBe(400 - 100) // 100 base, no amplification
    // +20 Strength amplifies by (100 + 20)/100 → 120 damage. The preview promised 100 before this fix.
    expect(buffed).toBe(400 - 120)
  })

  test('RED: a +110% Damage buff moves the preview, and a Strength DEBUFF moves it down', () => {
    expect(previewed_hp([status({ stat: SE.STAT_PERCENT_DAMAGE, value: 110 })])).toBe(400 - 210)
    // The sign lives in the value ONCE (#904) — a decoded negative row is a DEBUFF, flag or no flag. On a
    // 60-Strength build a −50 row prices at 10 Strength (110 damage), never at the unbuffed 160.
    expect(previewed_hp([], { strength: 60 })).toBe(400 - 160)
    expect(previewed_hp([status({ value: -50 })], { strength: 60 })).toBe(400 - 110)
    // …and the sim's own u64 floor still holds: a debuff cannot push a stat below zero.
    expect(previewed_hp([status({ value: -50 })])).toBe(400 - 100)
  })

  test('RED: a flat +30 Raw Damage buff adds after amplification, exactly like the chain orders it', () => {
    expect(previewed_hp([status({ stat: SE.STAT_RAW_DAMAGE, value: 30 })])).toBe(400 - 130)
    // Strength amplifies the base, THEN the flat rides on top: (100 * 1.2) + 30 = 150.
    expect(previewed_hp([status(), status({ stat: SE.STAT_RAW_DAMAGE, value: 30 })])).toBe(400 - 150)
  })

  test('the two doors are inverses: what status_row_of writes, sim_effects_of reads back', () => {
    const rows = [
      { type: 'STAT_BUFF', stat: 'strength', value: 20, turns_remaining: 3 },
      { type: 'STAT_DEBUFF', stat: 'agility', value: 17, turns_remaining: 2 },
      { type: 'STAT_BUFF', stat: 'range', value: 1, turns_remaining: 4 },
      { type: 'STAT_BUFF', stat: 'percent_damage', value: 110, turns_remaining: 1 },
      { type: 'STAT_DEBUFF', stat: 'fire_resistance', value: 12, turns_remaining: 5 },
      { type: 'INVISIBILITY', value: 0, turns_remaining: 2 },
    ]
    const round_trip = sim_effects_of({ id: 'p0', effects: rows.map(status_row_of) })

    expect(
      round_trip.map(({ type, stat, value, turns_remaining }) => ({ type, stat, value, turns_remaining }))
    ).toEqual(rows.map(({ type, stat, value, turns_remaining }) => ({ type, stat, value, turns_remaining })))
  })

  test('POOL rows stay out of the sim effects — the fold owns ap/mp, and two homes would double-count', () => {
    // `inputs.pool_grant` already moves the turn-start refill for GIVE/REMOVE_POINTS rows and `project.js`
    // hands the RESULT to the sim entity as its ap/mp. Promoting them here too would add the grant twice.
    expect(sim_effects_of({ effects: [{ kind: 6, stat: SE.POINT_MP, value: 1, remaining_turns: 3 }] })).toEqual([])
  })

  test('the range fold is unchanged — widening the door did not move an already-correct number', () => {
    const fighter = { base_range: 6, effects: [status({ stat: SE.STAT_RANGE, value: 1 }), status()] }
    expect(range_bonus_of(fighter)).toBe(7)
  })
})
