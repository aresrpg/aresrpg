// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight_state, type FightEvent, type SpellLevel } from '@aresrpg/fight'

import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'

const trap_level: SpellLevel = {
  ap_cost: 3n,
  range_min: 1n,
  range_max: 4n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: true,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 0n,
  effects: [],
  crit_effects: [],
}

test('a PvP trap cast and placement play only for the caster team', () => {
  const source = create_character_source({ classe: 'senshi' })
  const checkpoint = create_fight_state({
    fight_id: '0xpvp',
    board_seed: 1n,
    players: [
      { character: '0xc1', owner: '0xa1', team: 0n, hp: 100n, source },
      { character: '0xc2', owner: '0xa2', team: 1n, hp: 100n, source },
    ],
    mobs: [],
    spells: { trap: { classe: 'senshi', unlock_level: 1n, levels: [trap_level] } },
  })
  const target_cell = checkpoint.contract.fighters[0]!.cell + 1n
  const events: readonly FightEvent[] = [
    {
      type: 'spell_cast',
      payload: {
        caster: 0n,
        spell: 'trap',
        cast_level: 1n,
        target_cell,
        slot: 0n,
        ap_cost: 3n,
        critical: false,
        weapon: false,
      },
    },
    {
      type: 'trap_placed',
      payload: {
        zone_id: 'zone:hidden',
        owner: 0n,
        anchor: target_cell,
        shape: 0n,
        size: 0n,
        visibility: 'owner',
      },
    },
  ]

  expect(project_fight_cues({ checkpoint, events, batch: 1, viewer_team: 0n }).map(({ type }) => type)).toEqual([
    'cast',
    'zone_placed',
  ])
  expect(project_fight_cues({ checkpoint, events, batch: 1, viewer_team: 1n })).toEqual([])
  expect(project_fight_cues({ checkpoint, events, batch: 1, viewer_team: null })).toEqual([])
})
