// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight_state, type FightEvent } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'

const checkpoint = () =>
  create_fight_state({
    fight_id: '0xstatus',
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
          mob_type: 'buffer',
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
  })

test('status rows enter presentation at their ordered effect event, not at batch arrival', () => {
  const before = checkpoint()
  const after = structuredClone(before)
  const applied = { kind: 4n, element: 'fire', value: 3n, turns_left: 2n, source: 1n, stat: 0n }
  after.contract.fighters[0]!.effects = [applied]
  const events: readonly FightEvent[] = [
    {
      type: 'spell_cast',
      payload: {
        caster: 1n,
        spell: 'encourage',
        cast_level: 1n,
        target_cell: after.contract.fighters[0]!.cell,
        slot: 0n,
        ap_cost: 2n,
        critical: false,
        weapon: false,
      },
    },
    {
      type: 'effect_applied',
      payload: {
        target: 0n,
        effect_id: 'effect:encourage',
        kind: applied.kind,
        channel: applied.stat,
        element: applied.element,
        value: applied.value,
        turns: applied.turns_left,
        source: applied.source,
      },
    },
  ]

  const cues = project_fight_cues({ checkpoint: after, initial_checkpoint: before, events, batch: 3 })

  expect(cues.map(({ type }) => type)).toEqual(['cast', 'status'])
  expect(cues[1]).toMatchObject({ type: 'status', entity_id: 'fight_character_0', effects: [applied] })
})

test('expiry and dispel remove their exact presented rows in event order', () => {
  const before = checkpoint()
  const first = { kind: 4n, element: '', value: 2n, turns_left: 1n, source: 1n, stat: 6n }
  const second = { kind: 5n, element: '', value: 1n, turns_left: 2n, source: 1n, stat: 7n }
  before.contract.fighters[0]!.effects = [first, second]
  const after = structuredClone(before)
  after.contract.fighters[0]!.effects = []
  const events: readonly FightEvent[] = [
    {
      type: 'effect_expired',
      payload: { target: 0n, effect_id: 'initial:effect:0:0', kind: first.kind, channel: first.stat },
    },
    { type: 'effects_dispelled', payload: { target: 0n, removed_effect_ids: ['initial:effect:0:1'] } },
  ]

  const statuses = project_fight_cues({ checkpoint: after, initial_checkpoint: before, events, batch: 4 }).filter(
    (cue) => cue.type === 'status'
  )

  expect(statuses).toHaveLength(2)
  expect(statuses[0]).toMatchObject({ effects: [second] })
  expect(statuses[1]).toMatchObject({ effects: [] })
})
