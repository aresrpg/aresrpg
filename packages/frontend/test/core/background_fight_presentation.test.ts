// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fight nobody watches runs like a background window (owner 2026-08-26): its state advances,
// its animations are never stored. Switching boards lands on the live checkpoint with no replay.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

const checkpoint_of = (id: string, character: string): HydratedFightCheckpoint =>
  ({
    contract: {
      id,
      fighters: [{ kind: { type: 'player', character, owner: '0xme' }, settled: false }],
      turn_started_ms: 0n,
      started_ms: null,
    },
    sources: { players: {}, spells: {} },
  }) as unknown as HydratedFightCheckpoint

const fight_a = checkpoint_of('0xfa', '0xa')
const fight_b = checkpoint_of('0xfb', '0xb')

const two_fight_state = (): AppState => {
  const base = initial_app_state(settings)
  return {
    ...base,
    session: {
      ...base.session,
      wallet: { address: '0xme' } as never,
      selected_character_id: '0xa',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } },
        { id: '0xb', custody: 'fight', active_fight: { id: '0xfb', seat: 0 } },
      ] as never,
    },
    fight: {
      ...base.fight,
      cached: { '0xfa': fight_a, '0xfb': fight_b },
      checkpoint: fight_a,
      mode: 'remote' as const,
    },
  } as AppState
}

const reconcile = (state: AppState, checkpoint: HydratedFightCheckpoint, project?: boolean): AppState =>
  reduce_app_state(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint,
    zone_ids: [],
    events: [{ type: 'fight_started', payload: {} }] as never,
    presentation_batch: 1,
    error: null,
    awaiting_turn_witness: false,
    ...(project === undefined ? {} : { project }),
  })

test('a background fight never stores an animation replay — its queue stays empty', () => {
  const state = reconcile(two_fight_state(), fight_b, false)

  expect(state.fight.environments['0xfb']?.presentations).toEqual([])
  expect(state.fight.checkpoint?.contract.id).toBe('0xfa')
})

test('switching boards drops both queues — arriving is like never having left', () => {
  let state = reconcile(two_fight_state(), fight_a)
  expect(state.fight.presentations).toHaveLength(1)
  state = reduce_app_state(state, { type: 'character/select', character_id: '0xb' })

  expect(state.fight.checkpoint?.contract.id).toBe('0xfb')
  expect(state.fight.presentations).toEqual([])
  expect(state.fight.environments['0xfa']?.presentations).toEqual([])
})

test('leaving the board pages clears the animation queue on the next fold', () => {
  let state = reduce_app_state(two_fight_state(), { type: 'page/open', page: 'marketplace' })
  state = reconcile(state, fight_a)

  expect(state.fight.presentations).toEqual([])
  expect(state.fight.environments['0xfa']?.presentations).toEqual([])
})
