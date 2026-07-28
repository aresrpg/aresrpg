// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Review follow-up for #1306: player-cast resolution is a deterministic twin of Move. Every combat branch must
// hang off the public turn clock, never the simulator state's legacy rng thread. The clock below is tuple A from
// e4558974's Move-extracted parity vectors: turn seed 2347341858, slot-0 crit roll 1089, so a 1-in-4 spell crits.

import { describe, expect, test } from 'bun:test'

import { process_spell_cast } from '../src/fight_spells.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import { fighter, state_of } from './missing_effect_helpers.js'

const PLAYER_CELL = { x: 4, y: 4 }
const TARGET_CELL = { x: 5, y: 4 }
const TURN_CONTEXT = {
  world_seed: 123456789,
  spawn_id: 42,
  turn_entropy: 3141592653,
  turn_ordinal: 7,
  seat: 0,
  slot: 0,
}

const spell = normalize_spell_templates([
  {
    id: 'clocked_crit',
    levels: [
      {
        ap_cost: 0,
        range_min: 1,
        range_max: 2,
        modifiable_range: false,
        line_launch: false,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 4,
        effects: [
          { kind: 0, element: 2, value: 10, target_filter: 1, chance: 100 },
        ],
        crit_effects: [
          { kind: 0, element: 2, value: 50, target_filter: 1, chance: 100 },
        ],
      },
    ],
  },
]).get('clocked_crit')

const cast_from = (legacy_rng, combat_rng) => {
  const player = fighter('p0', PLAYER_CELL, true, { hand: ['clocked_crit'] })
  const target = fighter('m0', TARGET_CELL, false)
  const state = {
    ...state_of([player], [target], legacy_rng),
    rng: legacy_rng,
    turn_rng: combat_rng,
  }
  return process_spell_cast(
    state,
    player.id,
    spell,
    1,
    TARGET_CELL,
    { blocks_los: () => false, is_occupied: () => true },
    () => true,
    TURN_CONTEXT,
  )
}

describe('player casts draw from the public turn clock', () => {
  test('same turn clock produces the Move-pinned crit and damage regardless of state.rng', () => {
    // rng=1 does not crit under the retired rng_int(..., 4) path; rng=4 does. If state.rng leaks into cast
    // resolution these two outcomes diverge. The public clock says both take the critical 50-damage branch.
    const a = cast_from(1, 0x11111111)
    const b = cast_from(4, 0x22222222)

    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    expect(a.is_critical).toBe(true)
    expect(b.is_critical).toBe(true)
    expect(a.state.team1[0].health).toBe(50)
    expect(b.state.team1[0].health).toBe(50)
    // A player action is crank-free on Move: its temporary per-effect clock must not perturb the stream a later
    // mob action or board tick consumes.
    expect(a.state.turn_rng).toBe(0x11111111)
    expect(b.state.turn_rng).toBe(0x22222222)
  })
})
