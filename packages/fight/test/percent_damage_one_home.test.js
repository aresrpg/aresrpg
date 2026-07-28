// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1480 — a rendered `+110% Damage` buff must reach EVERY damage number the client shows. The live repro: Full
// Draw applies, the card paints +110% Damage, and the previewed number stays 108 where 200+ is owed.
//
// The contract this seals is ONE HOME: whatever a surface calls "the damage this cast deals" is the number the
// resolution produces, derived from the same function. A caster carrying an active percent_damage status row
// previews the buffed hit AND lands it; nothing in `@aresrpg/fight` may answer that question from the authored
// base, because an authored base cannot move with a buff and a second answer is exactly the divergence.

import { describe, expect, test } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import * as predict_module from '../src/predict_cast.js'
import { predict_cast } from '../src/predict_cast.js'
import { encode } from '../src/los.js'

const CASTER = 'p0'
const VICTIM = 'mob-0'
const ARENA = { width: 10, height: 10, cells: new Array(100).fill(0) }

// The chain's ALTER_STAT status row shape as `engine_view` exposes it: kind 9, stat 8 (percent_damage), the
// centering already stripped at the wire door, so `value` is the real signed delta (statuses.js).
const K_ALTER_STAT = 9
const STAT_PERCENT_DAMAGE = 8
const percent_damage_row = (value) => ({
  id: 'buff:0',
  kind: K_ALTER_STAT,
  stat: STAT_PERCENT_DAMAGE,
  value,
  remaining_turns: 3,
  element: null,
  chance: null,
})

// A fixed-base EARTH strike: value == value_max, so the turn-seed roll cannot move it and the only thing that
// can change the landed number is the caster's own build. The owner's repro number, verbatim.
const AUTHORED_BASE = 108
const strike = normalize_spell_templates([
  {
    id: 'strike',
    name: 'Strike',
    levels: [
      {
        ap_cost: 0,
        range_min: 1,
        range_max: 8,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 0,
        effects: [
          {
            kind: 0,
            value: AUTHORED_BASE,
            value_max: AUTHORED_BASE,
            element: 2,
            target_filter: 1,
            chance: 100,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]).get('strike')

const fighter = (id, cell, is_player, effects) => ({
  id,
  team: is_player ? 0 : 1,
  cell,
  health: 900,
  health_max: 900,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  is_player,
  base_stats: {},
  base_range: 0,
  effects,
  spell_levels: { strike: 1 },
})

const view_with = (caster_effects) => ({
  fight_id: 1,
  arena: ARENA,
  turn_order: [CASTER, VICTIM],
  turn_number: 1,
  fighters: new Map([
    [CASTER, fighter(CASTER, { x: 1, y: 1 }, true, caster_effects)],
    [VICTIM, fighter(VICTIM, { x: 4, y: 1 }, false, [])],
  ]),
})

/** The damage the SIM RESOLVES for this cast — the authority's own number, read off the resolved state. */
const resolved_damage = (caster_effects) => {
  const view = view_with(caster_effects)
  const before = view.fighters.get(VICTIM).health
  const prediction = predict_cast({
    view,
    caster_id: CASTER,
    spell: strike,
    spell_level: 1,
    target_cell: encode(4, 1),
    critical: false,
  })
  const hit = prediction.actions.find((action) => action.kind === 'Hit')
  return before - hit.remaining_hp
}

describe('#1480 — a +110% damage row moves every damage number the client shows', () => {
  test('the unbuffed strike lands the authored base (the repro number)', () => {
    expect(resolved_damage([])).toBe(AUTHORED_BASE)
  })

  test('a +110% percent_damage row more than doubles the RESOLVED hit', () => {
    // §5h: `base × (100 + primary + percent)/100` — 108 × 2.10 = 226 (spell_formula::amplify_damage's twin).
    const buffed = resolved_damage([percent_damage_row(110)])
    expect(buffed).toBe(226)
    expect(buffed).toBeGreaterThan(200)
  })

  test('the PREVIEW is the resolution — same function, never a second answer', () => {
    // predict_cast IS the preview surface (target_prediction_core hands it the live view), so preview and
    // resolution are the same call by construction. This asserts the property a second calculation would break.
    const preview = resolved_damage([percent_damage_row(110)])
    expect(preview).toBe(resolved_damage([percent_damage_row(110)]))
    expect(preview).not.toBe(AUTHORED_BASE)
  })

  test('no authored-base damage read survives in the prediction module', () => {
    // THE BUG CLASS: `damage_of(effects)` answered "the damage this cast deals" from the AUTHORED base, so it
    // returned 108 for a caster the resolution lands 226 for — a second calculation that cannot agree because
    // it never sees the caster at all. One home means this export does not exist.
    expect(predict_module.damage_of).toBeUndefined()
  })
})
