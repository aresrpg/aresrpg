// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2145 RED-FIRST — the decoded Fight snapshot already carries the caster's live ALTER_STAT row. Prediction
// must feed that row to the same sim settlement fold that resolves a cast; losing it prices the rolled base (7)
// instead of the chain-amplified damage (8).

import { describe, expect, test } from 'bun:test'
import { effective_stats } from '@aresrpg/sim/fight_state'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { predict_cast } from '../src/predict_cast.js'
import { sim_effects_of } from '../src/statuses.js'
import { create_fight_store } from '../src/store.js'

const FIGHT_ID = '0xf2145'
const CASTER_ID = '0xc2145'
const CASTER_CELL = encode(2, 2)
const TARGET_CELL = encode(4, 2)
const TARGET_HP = 21

const TURN_CLOCK = {
  world_seed: 2151050269,
  spawn_id: 11654971339327537382n,
  turn_entropy: 1895569289,
  turn_ordinal: 9,
  seat: 0,
  slot: 0,
}

const WAR_CLEAVE = normalize_spell_templates([
  {
    id: 'senshi_warcleave',
    name: 'Warcleave',
    levels: [
      {
        ap_cost: 0,
        range_min: 1,
        range_max: 9,
        line_of_sight: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 40,
        effects: [
          {
            kind: 0,
            value: 5,
            value_max: 9,
            element: 2,
            target_filter: 1,
            chance: 100,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]).get('senshi_warcleave')

const percent_damage_status = {
  fighter: 0,
  kind: 9,
  stat: 8,
  value: 32796,
  remaining_turns: 1,
}

const ALTER_STAT_CENSUS = [
  [0, 'strength'],
  [1, 'intelligence'],
  [2, 'chance'],
  [3, 'agility'],
  [4, 'wisdom'],
  [5, 'vitality'],
  [6, 'range'],
  [7, 'critical_hit'],
  [8, 'percent_damage'],
  [9, 'raw_damage'],
  [10, 'max_hp'],
  [11, 'heal'],
  [12, 'ap_dodge'],
  [13, 'mp_dodge'],
  [14, 'physical_damage'],
]

const ALTER_RESIST_CENSUS = [
  [0, 'fire_resistance'],
  [1, 'water_resistance'],
  [2, 'earth_resistance'],
  [3, 'air_resistance'],
  [255, 'neutral_resistance'],
]

const decoded_fight = (with_status) => ({
  id: FIGHT_ID,
  status: 1,
  width: 20,
  height: 20,
  participants: [
    {
      owner: '0x2145',
      character: CASTER_ID,
      class: 'senshi',
      team: 0,
      hp: 100,
      max_hp: 100,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CASTER_CELL,
      ready: true,
      casts_this_turn: 0,
      base_stats: { strength: 0, percent_damage: 0, raw_damage: 0 },
    },
  ],
  mobs: [
    {
      level: 1,
      hp: TARGET_HP,
      max_hp: TARGET_HP,
      ap: 6,
      mp: 3,
      cell: TARGET_CELL,
      base_stats: {},
    },
  ],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 100_000,
  turn_entropy: TURN_CLOCK.turn_entropy,
  turn_ordinal: TURN_CLOCK.turn_ordinal,
  world_seed: TURN_CLOCK.world_seed,
  spawn_id: TURN_CLOCK.spawn_id,
  fx: { statuses: with_status ? [percent_damage_status] : [] },
})

const predicted_damage = (with_status) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0', ctx: { my_entity_id: CASTER_ID } })
  const fight = decoded_fight(with_status)
  // This is the pure fight-core equivalent of the chain decode: keep the raw snapshot intact and attach the
  // generic decoded rows the projection consumes. The reader is deliberately part of the fixture so 32796 is
  // proven to mean +28, never mistaken for the live magnitude.
  fight.invisibility_statuses = read_fighter_statuses(fight)
  store.getState().input({ type: 'snapshot', fight, version: 964771126 }, 10_000)
  const prediction = predict_cast({
    view: engine_view(store.getState()),
    caster_id: CASTER_ID,
    spell: WAR_CLEAVE,
    spell_level: 1,
    target_cell: TARGET_CELL,
    critical_clock: TURN_CLOCK,
    critical: false,
  })
  const hit = prediction?.actions.find((action) => action.kind === 'Hit' && action.victim_is_mob)
  return hit == null ? null : TARGET_HP - hit.remaining_hp
}

describe('#2145 live caster stats chain oracle', () => {
  test('active +28% Damage status predicts the chain-committed 8', () => {
    // Chain oracle: journal seq 53, digest BF9zAGbc…, version 964771581 committed Hit amount 8.
    expect(predicted_damage(true)).toBe(8)
  })

  test('the same cast without the status predicts the rolled base 7', () => {
    expect(predicted_damage(false)).toBe(7)
  })

  test('the decoded-row fix closes the settlement fold stat census, not only percent_damage', () => {
    const fight = {
      fx: {
        statuses: [
          ...ALTER_STAT_CENSUS.map(([stat]) => ({
            fighter: 0,
            kind: 9,
            stat,
            value: 32769,
            remaining_turns: 1,
          })),
          ...ALTER_RESIST_CENSUS.map(([element]) => ({
            fighter: 0,
            kind: 11,
            element,
            value: 32769,
            remaining_turns: 1,
          })),
        ],
      },
    }
    const effects = sim_effects_of({ id: CASTER_ID, effects: read_fighter_statuses(fight) })
    const base = Object.fromEntries([...ALTER_STAT_CENSUS, ...ALTER_RESIST_CENSUS].map(([, stat]) => [stat, 0]))
    const live = effective_stats({ stats: base, effects })

    for (const [, stat] of [...ALTER_STAT_CENSUS, ...ALTER_RESIST_CENSUS])
      // max_hp is a pool, explicitly excluded by effective_stats; every combat Stats field shares the fold.
      expect(live[stat], stat).toBe(stat === 'max_hp' ? 0 : 1)
  })
})
