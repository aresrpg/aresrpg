// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Review follow-up for #1306: replay the new TurnStarted wire through the production fold, projection and
// predictor. The entropy tuple and expected seed/roll are the Move-extracted tuple A from e4558974.

import { describe, expect, test } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'
import { roll_in_range, slot_damage_roll, turn_seed } from '@aresrpg/sim/turn_seed'

import { crit_clock_of, predict_cast } from '../src/predict_cast.js'
import { board_view, engine_view, my_action_slot } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xentropy_replay'
const PLAYER = '0xplayer'
const TURN_ENTROPY = '3141592653'
const TURN_ORDINAL = '7'
const MOVE_TURN_SEED = 2347341858
const CHAIN_DAMAGE = 30

const event = (kind, fields) => ({
  type: `0xengine::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  world_seed: 123456789,
  spawn_id: 42,
  participants: [
    {
      owner: '0xowner',
      character: PLAYER,
      class: 'senshi',
      team: 0,
      hp: 100,
      max_hp: 100,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 44,
      casts_this_turn: 0,
      stats: {},
      spell_levels: { contents: [] },
    },
  ],
  mobs: [{ template: '0xmob', hp: 100, max_hp: 100, cell: 45, ap: 4, mp: 3, level: 1, stats: {} }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  obstacles: [],
  holes: [],
}

const spell = normalize_spell_templates([
  {
    id: 'entropy_band',
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
        crit_rate: 0,
        effects: [{ kind: 0, element: 2, value: 20, value_max: 60, target_filter: 1, chance: 100 }],
        crit_effects: [],
      },
    ],
  },
]).get('entropy_band')

const replay = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    ctx: { my_entity_id: PLAYER, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1 }, 1_000)
  store.getState().input(
    {
      type: 'receipt',
      version: 2,
      receipt: {
        events: [
          event('TurnStarted', {
            is_mob: false,
            idx: 0,
            deadline_ms: 90_000,
            turn_entropy: TURN_ENTROPY,
            turn_ordinal: TURN_ORDINAL,
          }),
        ],
      },
    },
    1_100
  )
  return store
}

describe('TurnStarted entropy replay -> projected prediction', () => {
  test('the folded wire bytes produce the same turn seed and cast outcome as Move', () => {
    const store = replay()
    const board = board_view(store.getState())
    const clock = crit_clock_of({ fight: board, seat_row: board.escrow[0], slot: my_action_slot(store.getState()) })

    expect(board.turn_entropy).toBe(TURN_ENTROPY)
    expect(board.turn_ordinal).toBe(TURN_ORDINAL)
    expect(turn_seed(clock)).toBe(MOVE_TURN_SEED)
    expect(roll_in_range(20, 60, slot_damage_roll(MOVE_TURN_SEED, 0))).toBe(CHAIN_DAMAGE)

    const hit = predict_cast({
      view: engine_view(store.getState()),
      caster_id: PLAYER,
      spell,
      spell_level: 1,
      target_cell: 45,
      critical: false,
      critical_clock: clock,
      resolve_ref: (id) => (id === 'mob-0' ? { is_mob: true, idx: 0 } : { is_mob: false, idx: 0 }),
    }).actions.find((action) => action.kind === 'Hit' && action.victim_is_mob)

    expect(hit.remaining_hp).toBe(100 - CHAIN_DAMAGE)
  })
})
