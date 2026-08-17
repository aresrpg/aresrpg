// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { create_character_source, create_fight_state, type FightEvent, type SpellLevel } from '@aresrpg/fight'

import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'

const level: SpellLevel = {
  ap_cost: 3n,
  range_min: 1n,
  range_max: 4n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 2n,
  effects: [],
  crit_effects: [],
}

const checkpoint = () =>
  create_fight_state({
    fight_id: '0xf1',
    board_seed: 1n,
    players: [
      {
        character: '0xc1',
        owner: '0xa1',
        ready: true,
        hp: 100n,
        source: create_character_source({ classe: 'senshi', level: 10n }),
      },
    ],
    mobs: [
      {
        team: 1n,
        scalar: 100n,
        template: {
          mob_type: 'alley_bunny',
          level_min: 1n,
          level_max: 1n,
          hp: 100n,
          ap: 6n,
          mp: 3n,
          agility: 0n,
          wisdom: 0n,
          earth_res: 32_768n,
          fire_res: 32_768n,
          water_res: 32_768n,
          air_res: 32_768n,
          spells: [],
          xp: 1n,
          loot: [],
        },
      },
    ],
    spells: { slash: { classe: 'senshi', unlock_level: 1n, levels: [level] } },
  })

describe('fight presentation cues', () => {
  test('projects one ordered immutable batch without re-resolving its cast results', () => {
    const state = checkpoint()
    const target_cell = state.contract.fighters[1]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'spell_cast',
        payload: {
          caster: 0n,
          spell: 'slash',
          cast_level: 1n,
          target_cell,
          slot: 0n,
          ap_cost: 3n,
          critical: true,
          weapon: false,
        },
      },
      {
        type: 'damage_number',
        payload: {
          source: 0n,
          target: 1n,
          amount: 100n,
          hp_before: 100n,
          hp_after: 0n,
          element: 'earth',
          cause: 'spell',
        },
      },
      { type: 'fighter_died', payload: { fighter: 1n, source: 0n, cause: 'spell', cell: target_cell } },
    ]

    const cues = project_fight_cues({ checkpoint: state, events, batch: 7 })

    expect(cues.map(({ type }) => type)).toEqual(['cast', 'damage', 'death'])
    expect(cues[0]).toMatchObject({
      id: '0xf1:7:0',
      type: 'cast',
      caster_id: 'fight_character_0',
      element: 'earth',
      critical: true,
      amount: 100,
      target_max_hp: 100,
      affected_cells: [Number(target_cell)],
      killed: true,
    })
    expect(cues[1]).toMatchObject({ type: 'damage', target_id: 'fight_mob_1', critical: true })
  })

  test('coalesces consecutive movement steps but keeps their accepted order', () => {
    const state = checkpoint()
    const from = state.contract.fighters[0]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'fighter_moved',
        payload: { fighter: 0n, from, to: from + 1n, mode: 'walk', source: 0n, mp_spent: 1n },
      },
      {
        type: 'fighter_moved',
        payload: { fighter: 0n, from: from + 1n, to: from + 2n, mode: 'walk', source: 0n, mp_spent: 1n },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 3 })).toEqual([
      {
        id: '0xf1:3:0',
        type: 'movement',
        entity_id: 'fight_character_0',
        cells: [Number(from + 1n), Number(from + 2n)],
        mode: 'walk',
        source_id: 'fight_character_0',
      },
    ])
  })
})
