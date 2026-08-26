// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight_state, type FightEvent } from '@aresrpg/fight'

import { chat_line_tokens } from '../../../src/components/Chat.tsx'
import { project_fight_chat_lines } from '../../../src/game/fight/fight_chat_lines.ts'

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
    spells: {},
  })

const name_of = (seat: bigint): string => (seat === 0n ? 'Yogan' : 'Wabbit')

test('the log speaks casts, merged reductions, returns, and stat changes — never turns or costs', () => {
  const state = checkpoint()
  const events: readonly FightEvent[] = [
    { type: 'turn_switched', payload: { from: 1n, to: 0n, round: 2n, skipped: [], reason: 'end_turn' } },
    {
      type: 'spell_cast',
      payload: {
        caster: 0n,
        spell: 'slash',
        cast_level: 1n,
        target_cell: 9n,
        slot: 0n,
        ap_cost: 3n,
        critical: false,
        weapon: false,
      },
    },
    {
      type: 'ap_mp_change',
      payload: {
        fighter: 0n,
        ap_before: 6n,
        ap_after: 3n,
        mp_before: 3n,
        mp_after: 3n,
        reason: 'cast_cost',
        source: 0n,
      },
    },
    { type: 'damage_reduced', payload: { source: 0n, target: 1n, prevented: 5n, remaining: 45n, effect_ids: ['s1'] } },
    {
      type: 'damage_number',
      payload: {
        source: 0n,
        target: 1n,
        amount: 45n,
        hp_before: 100n,
        hp_after: 55n,
        element: 'earth',
        cause: 'spell',
      },
    },
    { type: 'spell_returned', payload: { caster: 0n, target: 1n, amount: 12n, cast_level: 1n } },
    {
      type: 'effect_applied',
      payload: { target: 1n, effect_id: 'e1', kind: 5n, channel: 5n, element: '', value: 2n, turns: 2n, source: 0n },
    },
  ]

  const lines = project_fight_chat_lines(state, events, '1', name_of)

  expect(lines.map(({ key }) => key)).toEqual(['log_cast', 'log_lost_reduced', 'log_returned', 'log_stat_change'])
  expect(lines[1]!.values).toMatchObject({
    target: { text: 'Wabbit', seat: 1 },
    amount: { text: '45' },
    reduced: { text: '5' },
  })
  expect(lines[3]!.values.delta).toMatchObject({ text: '−2' })
  expect(lines[3]!.values.stat).toMatchObject({ copy_key: 'stat_range' })
})

test('a chatiment trigger logs its per-trigger delta once, not the folded total', () => {
  const state = checkpoint()
  const events: readonly FightEvent[] = [
    {
      type: 'chatiment_triggered',
      payload: { fighter: 1n, stance_effect_id: 's1', added_effect_id: 'e1', channel: 0n, value: 2n, turns: 3n },
    },
    {
      type: 'effect_applied',
      payload: { target: 1n, effect_id: 'e1', kind: 4n, channel: 0n, element: '', value: 4n, turns: 3n, source: 1n },
    },
  ]

  const lines = project_fight_chat_lines(state, events, '1', name_of)

  expect(lines).toHaveLength(1)
  expect(lines[0]!.values.delta).toMatchObject({ text: '+2' })
})

test('non-stat effects never interpret their unused channel zero as strength', () => {
  const state = checkpoint()
  const events: readonly FightEvent[] = [
    {
      type: 'effect_applied',
      payload: {
        target: 1n,
        effect_id: 'shield',
        kind: 14n,
        channel: 0n,
        element: '',
        value: 3n,
        turns: 2n,
        source: 0n,
      },
    },
    {
      type: 'effect_applied',
      payload: {
        target: 1n,
        effect_id: 'stance',
        kind: 7n,
        channel: 0n,
        element: '',
        value: 3n,
        turns: 3n,
        source: 1n,
      },
    },
  ]

  expect(project_fight_chat_lines(state, events, '1', name_of)).toEqual([])
})

test('chat tokens localize the template live and color each value', () => {
  const state = checkpoint()
  const [line] = project_fight_chat_lines(
    state,
    [
      {
        type: 'damage_number',
        payload: {
          source: 0n,
          target: 1n,
          amount: 45n,
          hp_before: 100n,
          hp_after: 55n,
          element: 'earth',
          cause: 'spell',
        },
      },
    ],
    '1',
    name_of
  )

  const tokens = chat_line_tokens(line!, { log_lost: '{target} lost {amount} HP' }, { 1: 'Localized Wabbit' })

  expect(tokens.map(({ text }) => text).join('')).toBe('Localized Wabbit lost 45 HP')
  expect(tokens.map(({ cls }) => cls)).toEqual(['target', 'verb', 'num', 'verb'])
})
