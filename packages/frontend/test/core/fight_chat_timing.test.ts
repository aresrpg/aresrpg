// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight_state, type FightEvent } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import fight_module, { type FightPresentationBatch } from '../../src/modules/fight.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

test('combat lines enter chat only after their presentation batch completes', () => {
  const checkpoint = create_fight_state({
    fight_id: '0xf1',
    board_seed: 1n,
    players: [
      {
        character: '0xc1',
        owner: '0xme',
        ready: true,
        hp: 100n,
        source: create_character_source({ classe: 'senshi', level: 1n }),
      },
    ],
    mobs: [],
    spells: {},
  })
  const events: readonly FightEvent[] = [
    {
      type: 'damage_number',
      payload: {
        source: 0n,
        target: 0n,
        amount: 5n,
        hp_before: 100n,
        hp_after: 95n,
        element: 'earth',
        cause: 'spell',
      },
    },
  ]
  const presentation: FightPresentationBatch = Object.freeze({
    batch: 1,
    checkpoint,
    zone_ids: Object.freeze([]),
    events,
  })
  const listeners = new Map<string, ((input: AppInput) => void)[]>()
  let state: AppState = Object.freeze({
    ...initial_app_state(settings),
    session: Object.freeze({
      ...initial_app_state(settings).session,
      selected_character_id: '0xc1',
      characters: [{ id: '0xc1', name: 'Hero' }] as never,
    }),
  })
  const emit = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    for (const listener of listeners.get(input.type) ?? []) listener(input)
  }
  fight_module.observe?.({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: AppInput) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: emit,
  })

  emit({
    type: 'fight/reconciled',
    mode: 'local',
    checkpoint,
    zone_ids: [],
    events,
    presentation_batch: 1,
    error: null,
    awaiting_turn_witness: false,
  })
  expect(state.chat.lines).toEqual([])

  emit({ type: 'fight/presented', presentation } as AppInput)
  expect(state.chat.lines.map(({ key }) => key)).toEqual(['log_lost'])
  expect(state.chat.lines[0]?.fight).toBe('0xf1')
})
