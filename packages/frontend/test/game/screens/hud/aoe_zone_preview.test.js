// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2175 — AIMING AN AoE MUST FORECAST EVERY ENTITY THE ZONE COVERS, INCLUDING FROM AN EMPTY ANCHOR.
//
// RED (the reported bug): `compute_target_prediction` anchored the forecast on the hovered ENTITY
// (`hover.entity_id` → its cell → predict_cast) and refused outright when the cursor sat on an empty cell. An
// AoE is aimed at a CELL, and the useful anchor is almost always empty — so the whole zone's damage was
// invisible exactly when the player needed it, and even on an occupied anchor only the hovered body got a number.
//
// GREEN: the anchor is the hovered CELL (the entity's cell when one is under the cursor, `hover.cell` otherwise),
// and the preview SET is derived from the ONE prediction the sim already resolved — predict_cast runs the whole
// cast once and diffs every fighter, so "who does this zone touch" is a READ of its canonical actions, never a
// second zone resolver and never a second damage formula.
//
// Weapon-armed (not a seed spell) so this runs unconditionally — the #117 missing-corpus class doesn't touch the
// weapon path, and the weapon zone door (#387, `weapon_shapes.js`) gives a REAL AoE: category `staff` →
// `line_perp_3` → SHAPE_TBAR size 1 = the aimed cell + one cell each side, perpendicular to the strike axis.

import { describe, expect, test, beforeEach } from 'bun:test'
import { engine_view, board_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'

import { compute_target_prediction } from '../../../../src/game/screens/hud/target_prediction_core.js'
import { predicted_target_outcome } from '../../../../src/game/screens/hud/target_outcome.js'
import { seed_fight_core, reset_fight_core } from '../../../../src/test_helpers/fight_core_harness.js'

const ME = '0xme'
// 20-wide board: cell = y * 20 + x.
const CASTER_CELL = 100 // (0,5)
const ANCHOR_CELL = 102 // (2,5) — EMPTY, the aimed cell
const NORTH_CELL = 82 //  (2,4) — inside the tbar arc
const SOUTH_CELL = 122 // (2,6) — inside the tbar arc
const OUTSIDE_CELL = 104 // (4,5) — on the strike axis but BEYOND the arc: the shape excludes it
const MOB_HP = 30
// reach 3 covers the anchor at chebyshev 2; damage 5 with no max ⇒ a FIXED band (no roll), crit_rate 0 ⇒ the
// non-crit branch is a fact, so every asserted number below is deterministic without a seeded turn clock.
const STAFF = { ap_cost: 2, damage: 5, crit_rate: 0, reach: 3, category: 'staff' }

/** Seat me with the AoE staff, arm it, and hand the pure core the same three slices the hook reads. */
const aim_at = (cell) => {
  seed_fight_core({
    my: ME,
    active: ME,
    seats: [{ character: ME, cell: CASTER_CELL, ap: 6, mp: 3, weapon: STAFF }],
    mobs: [
      { template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: NORTH_CELL, ap: 4, mp: 3, level: 1 },
      { template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: SOUTH_CELL, ap: 4, mp: 3, level: 1 },
      { template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: OUTSIDE_CELL, ap: 4, mp: 3, level: 1 },
    ],
  })
  fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
  const state = fight_store.getState()
  return compute_target_prediction({
    fight: engine_view(state),
    hover: { cell },
    dungeon: board_view(state),
    slot: 0,
  })
}

/** The preview set as the tooltip layer consumes it: one entry per covered entity, folded through the ONE
 *  per-target projection (`predicted_target_outcome`) the single-target card already uses. */
const preview_rows = (out) =>
  (out.previews ?? []).map((row) => ({
    entity_id: row.entity_id,
    ...predicted_target_outcome(out.prediction, row.target_ref, MOB_HP),
  }))

beforeEach(() => reset_fight_core())

describe('#2175 — an AoE aimed at an EMPTY cell forecasts every entity in the zone', () => {
  test('RED: hovering the empty anchor previews BOTH covered mobs, each with its exact predicted damage', () => {
    const out = aim_at(ANCHOR_CELL)

    // Pre-fix: the empty anchor short-circuits to EMPTY_PREDICTION — no prediction, no preview set at all.
    expect(out.prediction).not.toBeNull()
    const rows = preview_rows(out)
    expect(rows.map((row) => row.entity_id).sort()).toEqual(['mob-0', 'mob-1'])
    for (const row of rows) {
      expect(row.delta).toBe(-5) // the exact fixed strike, the same number the single-target card shows
      expect(row.remaining_hp).toBe(MOB_HP - 5)
      expect(row.kills).toBe(false)
    }
  })

  test('a mob the SHAPE excludes shows nothing — the zone is the sim’s answer, not a radius guess', () => {
    const ids = preview_rows(aim_at(ANCHOR_CELL)).map((row) => row.entity_id)
    expect(ids).not.toContain('mob-2') // (4,5) — on the axis, outside the perpendicular arc
  })

  test('moving the hover moves the set: aiming one cell north covers the north mob alone', () => {
    // anchor (2,4): the tbar arc is (2,4) + (2,3) + (2,5) — mob-0 stands ON the anchor, mob-1 (2,6) is out.
    const ids = preview_rows(aim_at(NORTH_CELL)).map((row) => row.entity_id)
    expect(ids).toEqual(['mob-0'])
  })

  test('a single-target aim is unchanged — one covered entity, one entry', () => {
    // A single-cell weapon (sword ⇒ `single`) aimed straight at a body: exactly the pre-#2175 behaviour.
    seed_fight_core({
      my: ME,
      active: ME,
      seats: [{ character: ME, cell: CASTER_CELL, ap: 6, mp: 3, weapon: { ...STAFF, category: 'sword' } }],
      mobs: [
        { template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: NORTH_CELL, ap: 4, mp: 3, level: 1 },
        { template: '0xabc', hp: MOB_HP, max_hp: MOB_HP, cell: SOUTH_CELL, ap: 4, mp: 3, level: 1 },
      ],
    })
    fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
    const state = fight_store.getState()
    const out = compute_target_prediction({
      fight: engine_view(state),
      hover: { entity_id: 'mob-0' },
      dungeon: board_view(state),
      slot: 0,
    })

    expect(out.target_ref).toEqual({ is_mob: true, idx: 0 })
    expect(preview_rows(out).map((row) => row.entity_id)).toEqual(['mob-0'])
  })
})
