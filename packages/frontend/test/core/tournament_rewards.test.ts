// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'
import tournament_module from '../../src/modules/tournament.ts'
import {
  collected_tournament_rewards,
  combined_tournament_rewards,
  pending_tournament_presentation,
} from '../../src/modules/tournament_rewards.ts'
import { tournament_fixture } from '../helpers/tournament.ts'

const row = () => {
  const base = tournament_fixture()
  return {
    ...base,
    status: 'finished' as const,
    format: 3 as const,
    sui_total: '1001',
    sui_pool: '0',
    token_total: '2000',
    token_pool: '0',
    kares_pool: 'pool',
    sui_bps: [10000, 0, 0, 0, 0],
    token_bps: [10000, 0, 0, 0, 0],
    rewards: [{ place: 1, template: 'wood', amount: 2 }],
    teams: [
      {
        ...base.teams[0],
        place: 1,
        seats: [0, 1, 2].map((index) => ({
          ...base.teams[0].seats[0],
          character: `hero-${index}`,
          owner: 'owner',
          token_claimed: false,
        })),
      },
    ],
  }
}
const receipt = (digest = 'confirmed') => ({
  $kind: 'Transaction',
  Transaction: { digest, effects: { status: { success: true } } },
})
const collection = (digest = 'confirmed') =>
  collected_tournament_rewards(row(), { kind: 'coins', team: 0, seat: 0 }, receipt(digest), 'owner')!
const initial = (): AppState => {
  const state = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
  return {
    ...state,
    session: { ...state.session, selected_character_id: 'hero', wallet: { address: 'owner' } as never },
  }
}

test('only certified successful owned claims produce exact rewards, independently of remaining pool and gas', () => {
  expect(collection()).toEqual({
    digest: 'confirmed',
    tournament: 'cup',
    rewards: [
      { asset: 'sui', amount: 334n },
      { asset: 'kares', amount: 667n },
    ],
  })
  const action = { kind: 'coins' as const, team: 0, seat: 0 }
  expect(collected_tournament_rewards(row(), action, undefined, 'owner')).toBeNull()
  expect(
    collected_tournament_rewards(
      row(),
      action,
      { $kind: 'FailedTransaction', FailedTransaction: receipt().Transaction },
      'owner'
    )
  ).toBeNull()
  expect(
    collected_tournament_rewards(
      row(),
      action,
      { Transaction: { digest: 'failed', effects: { status: { success: false } } } },
      'owner'
    )
  ).toBeNull()
  expect(collected_tournament_rewards(row(), action, receipt(), 'someone-else')).toBeNull()
  expect(
    collected_tournament_rewards(row(), { kind: 'item', team: 0, seat: 0, reward: 0 }, receipt(), 'owner')?.rewards
  ).toEqual([{ asset: 'item', template: 'wood', amount: 2n }])
})

test('rewards combine exact totals with currencies first and retain distinct item identities', () => {
  expect(
    combined_tournament_rewards([
      collection('a'),
      collection('b'),
      { digest: 'c', tournament: 'cup', rewards: [{ asset: 'item', template: 'wood', amount: 2n }] },
      { digest: 'd', tournament: 'cup', rewards: [{ asset: 'item', template: 'wood', amount: 3n }] },
    ])
  ).toEqual([
    { asset: 'sui', amount: 668n },
    { asset: 'kares', amount: 1334n },
    { asset: 'item', template: 'wood', amount: 5n },
  ])
})

test('duplicate and late outcomes do not replay rewards; closing one reveal preserves later receipts', () => {
  let state = reduce_app_state(initial(), { type: 'tournament/pending', key: 'a' })
  const outcome = { type: 'tournament/outcome' as const, key: 'a', reason: null, collection: collection('a') }
  state = reduce_app_state(state, outcome)
  state = reduce_app_state(state, outcome)
  expect(state.tournament.collections).toHaveLength(1)
  state = reduce_app_state(state, { type: 'tournament/pending', key: null })
  expect(pending_tournament_presentation(state)).toEqual({ type: 'tournament/rewards_opened' })
  state = reduce_app_state(state, { type: 'tournament/rewards_opened' })
  state = reduce_app_state(state, { type: 'tournament/pending', key: 'b' })
  state = reduce_app_state(state, { ...outcome, key: 'b', collection: collection('b') })
  expect(state.tournament.reward_reveal).toEqual(['a'])
  state = reduce_app_state(state, { type: 'tournament/rewards_closed' })
  expect(state.tournament.collections.filter((row) => !row.acknowledged).map((row) => row.digest)).toEqual(['b'])
  state = reduce_app_state(state, { type: 'tournament/pending', key: null })
  expect(reduce_app_state(state, outcome)).toBe(state)
  state = reduce_app_state(state, { type: 'tournament/rewards_opened' })
  state = reduce_app_state(state, { type: 'tournament/rewards_closed' })
  state = reduce_app_state(state, { type: 'tournament/pending', key: 'a' })
  state = reduce_app_state(state, outcome)
  state = reduce_app_state(state, { type: 'tournament/pending', key: null })
  expect(pending_tournament_presentation(state)).toBeNull()
  expect(state.tournament.collections).toHaveLength(2)
  expect(
    reduce_app_state(state, { type: 'auth/connected', session: { address: 'another-owner' } as never }).tournament
      .collections
  ).toBe(state.tournament.collections)
  expect(reduce_app_state(state, { type: 'auth/disconnected' }).tournament.collections).toEqual([])
})

test('failed claims never celebrate even if a stale collection accompanies the outcome', () => {
  const pending = reduce_app_state(initial(), { type: 'tournament/pending', key: 'a' })
  const failed = reduce_app_state(pending, {
    type: 'tournament/outcome',
    key: 'a',
    reason: 'rejected',
    collection: collection(),
  })
  expect(failed.tournament.collections).toEqual([])
  expect(pending_tournament_presentation(failed)).toBeNull()
})

test('podium opening observes completion once, waits for fight results, and never replays on login or duplicate snapshots', () => {
  const publish = (state: ReturnType<typeof initial>, value: ReturnType<typeof row>) =>
    reduce_app_state(state, {
      type: 'server/packet',
      packet: { type: 'packet/tournaments', tournaments: [value] },
    })
  expect(publish(initial(), row()).tournament.pending_podium).toBeNull()
  const running = publish(initial(), { ...row(), status: 'in_progress' } as never)
  let finished = publish(running, { ...row(), version: '6' })
  expect(finished.tournament.pending_podium).toBe('cup')
  expect(pending_tournament_presentation({ ...finished, fight: { ...finished.fight, mounted: true } })).toBeNull()
  expect(
    pending_tournament_presentation({
      ...finished,
      fight_result: {
        ...finished.fight_result,
        current_by_character: { hero: { fight: 'final', result_open: true, level_up_open: false } as never },
      },
    })
  ).toBeNull()
  expect(pending_tournament_presentation(finished)).toEqual({ type: 'tournament/podium_opened', id: 'cup' })
  const listeners = new Map<string, (input: AppInput) => void>()
  tournament_module.observe?.({
    events: { on: (name: string, listener: (input: AppInput) => void) => listeners.set(name, listener) },
    signal: new AbortController().signal,
    get_state: () => finished,
    dispatch: (input: AppInput) => {
      finished = reduce_app_state(finished, input)
    },
  } as never)
  finished = reduce_app_state(finished, { type: 'tournament/podium_opened', id: 'cup' })
  listeners.get('tournament/podium_opened')!({ type: 'tournament/podium_opened', id: 'cup' })
  expect(finished.navigation.pathname).toBe('/kolizeum/tournament/cup/podium')
  expect(finished.tournament.pending_podium).toBeNull()
  expect(publish(finished, { ...row(), version: '6' }).tournament.pending_podium).toBeNull()
  expect(
    publish({ ...running, session: { ...running.session, wallet: { address: 'spectator' } as never } }, row())
      .tournament.pending_podium
  ).toBeNull()
})

test('hidden teammate results cannot block the selected character’s tournament presentation', () => {
  const base = initial()
  const state = {
    ...base,
    tournament: { ...base.tournament, pending_podium: 'cup' },
    fight_result: {
      ...base.fight_result,
      current_by_character: {
        teammate: { fight: 'final', result_open: true, level_up_open: true, participants: [], own_seat: null } as never,
      },
    },
  }
  expect(pending_tournament_presentation(state)).toEqual({ type: 'tournament/podium_opened', id: 'cup' })
})

test('known completion presents without a fresh chain clock or a live connection', () => {
  const base = initial()
  const state = {
    ...base,
    tournament: { ...base.tournament, pending_podium: 'cup', feed_status: 'unavailable' as const },
  }
  const listeners = new Map<string, (state: AppState) => void>()
  const inputs: AppInput[] = []
  tournament_module.observe?.({
    events: { on: (name: string, listener: (state: AppState) => void) => listeners.set(name, listener) },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: (input: AppInput) => inputs.push(input),
  } as never)
  listeners.get('STATE_UPDATED')!(state)
  expect(inputs).toEqual([{ type: 'tournament/podium_opened', id: 'cup' }])
})

test('a pending prize claim does not hide the known podium or prematurely reveal collection', () => {
  const base = initial()
  const state = {
    ...base,
    tournament: { ...base.tournament, pending: 'claim', pending_podium: 'cup', collections: [collection()] },
  }
  expect(pending_tournament_presentation(state)).toEqual({ type: 'tournament/podium_opened', id: 'cup' })
  expect(
    pending_tournament_presentation({ ...state, tournament: { ...state.tournament, pending_podium: null } })
  ).toBeNull()
})
