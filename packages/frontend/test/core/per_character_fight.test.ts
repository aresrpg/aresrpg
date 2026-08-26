// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import type { FightResult } from '../../src/modules/fight_result.ts'
import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const checkpoint = {
  contract: {
    id: '0xf1',
    fighters: [
      {
        kind: { type: 'player', character: '0xa', owner: '0xme' },
        settled: false,
      },
    ],
  },
  sources: { players: {}, spells: {} },
} as unknown as HydratedFightCheckpoint

const state_with_fight = (owner = '0xme'): AppState => {
  const state = initial_app_state(settings)
  return {
    ...state,
    session: {
      ...state.session,
      wallet: { address: owner } as never,
      selected_character_id: '0xoutside',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xf1', seat: 0 } },
        { id: '0xoutside', custody: 'kiosk' },
        { id: '0xwatcher', custody: 'kiosk' },
      ] as never,
    },
    fight: {
      ...state.fight,
      cached: { '0xf1': checkpoint },
      checkpoint,
      mode: 'remote' as const,
    },
  } as AppState
}

test('closing a preview cannot evict another character fight', () => {
  const state = state_with_fight()
  const closed = reduce_app_state(state, { type: 'fight/preview_closed', character_id: '0xoutside', fight: '0xf1' })
  expect(closed.fight.cached['0xf1']).toBeDefined()
  expect(reduce_app_state(closed, { type: 'character/select', character_id: '0xa' }).fight.mounted).toBeTrue()

  const bystander = reduce_app_state(state_with_fight('0xstranger'), {
    type: 'fight/preview_closed',
    character_id: '0xoutside',
    fight: '0xf1',
  })
  expect(bystander.fight.cached['0xf1']).toBeUndefined()
})

test('each character keeps its committed spectator environment across tab switches', () => {
  const watching = reduce_app_state(state_with_fight(), {
    type: 'fight/spectating',
    character_id: '0xwatcher',
    fight: '0xf1',
  })
  const fighter = reduce_app_state(watching, { type: 'character/select', character_id: '0xa' })
  const spectator = reduce_app_state(fighter, { type: 'character/select', character_id: '0xwatcher' })
  expect(fighter.fight.spectating_by_character).toEqual({ '0xwatcher': '0xf1' })
  expect(spectator.fight.mounted).toBeTrue()
  expect(spectator.fight.checkpoint?.contract.id).toBe('0xf1')
})

test('equal presentation batch numbers are acknowledged inside their own fight', () => {
  const first = checkpoint
  const second = { ...checkpoint, contract: { ...checkpoint.contract, id: '0xf2' } } as never
  // the on-screen fight is the selected character's board; only it may queue animations
  let state = reduce_app_state(state_with_fight(), { type: 'character/select', character_id: '0xa' })
  state = reduce_app_state(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint: first,
    zone_ids: [],
    events: [{ type: 'fight_started', payload: {} }] as never,
    presentation_batch: 1,
    error: null,
    awaiting_turn_witness: false,
  })
  state = reduce_app_state(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint: second,
    zone_ids: [],
    events: [{ type: 'fight_started', payload: {} }] as never,
    presentation_batch: 1,
    error: null,
    awaiting_turn_witness: false,
    project: false,
  })
  // the unprojected fight stores no replay, so an equal batch number cannot collide at all
  expect(state.fight.environments['0xf2']!.presentations).toHaveLength(0)
  const first_batch = state.fight.environments['0xf1']!.presentations[0]!
  state = reduce_app_state(state, { type: 'fight/presented', presentation: first_batch })

  expect(state.fight.environments['0xf1']!.presentations).toHaveLength(0)
  expect(state.fight.environments['0xf2']!.presentations).toHaveLength(0)
})

test('a background settlement error stays with its character', () => {
  const base = initial_app_state(settings)
  const result = (fight: string, character_id: string): FightResult =>
    ({
      fight,
      own_seat: 0,
      participants: [{ character_id }],
      error: null,
    }) as unknown as FightResult
  let state: AppState = {
    ...base,
    session: { ...base.session, selected_character_id: '0xa' },
    fight_result: {
      ...base.fight_result,
      current_by_character: { '0xa': result('0xfa', '0xa'), '0xb': result('0xfb', '0xb') },
    },
  }
  state = reduce_app_state(state, {
    type: 'fight_result/claim_failed',
    character_id: '0xb',
    fight: '0xfb',
    error: 'B failed',
  })
  expect(state.fight_result.current_by_character['0xa']).toMatchObject({ fight: '0xfa', error: null })
  expect(state.fight_result.current_by_character['0xb']).toMatchObject({ fight: '0xfb', error: 'B failed' })
})
