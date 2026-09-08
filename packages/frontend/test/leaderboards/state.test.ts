// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { LeaderboardSnapshot } from '@aresrpg/protocol'

import {
  leaderboard_subscription,
  initial_leaderboards_state,
  reduce_leaderboards,
} from '../../src/modules/leaderboards.ts'
import { leaderboard_score } from '../../src/leaderboards/presentation.ts'
import { initial_app_state } from '../../src/store.ts'
import { load_game_settings } from '../../src/game/core/settings.ts'

const snapshot = (id: number, checkpoint = 10): LeaderboardSnapshot => ({
  observation: { id, metric: 'xp', season: null },
  season: 0,
  current_season: 0,
  start_epoch: 100,
  end_epoch: 130,
  epoch: 100,
  checkpoint,
  entries: [],
  self: null,
})

test('late responses cannot replace a newly selected category or newer checkpoint', () => {
  const initial = initial_leaderboards_state()
  const selected = reduce_leaderboards(initial, { type: 'leaderboards/select', metric: 'kills', season: null })
  expect(
    reduce_leaderboards(selected, {
      type: 'server/packet',
      packet: { type: 'packet/leaderboard', snapshot: snapshot(0) },
    })
  ).toBe(selected)
  const current = { ...snapshot(1, 20), observation: selected.observation }
  const ready = reduce_leaderboards(selected, {
    type: 'server/packet',
    packet: { type: 'packet/leaderboard', snapshot: current },
  })
  expect(ready.snapshot).toBe(current)
  expect(
    reduce_leaderboards(ready, {
      type: 'server/packet',
      packet: { type: 'packet/leaderboard', snapshot: { ...current, checkpoint: 19 } },
    })
  ).toBe(ready)
  expect(reduce_leaderboards(ready, { type: 'auth/disconnected' })).toEqual(initial)
})

test('opening, reconnecting, selecting and leaving send the observed window', () => {
  const initial = initial_app_state(load_game_settings('medium', null, null))
  const state = {
    ...initial,
    navigation: { ...initial.navigation, page: 'leaderboard' as const },
    session: { ...initial.session, link_status: 'ready' as const },
  }
  expect(leaderboard_subscription(state, initial)).toEqual({
    type: 'packet/leaderboard_observe',
    observation: state.leaderboards.observation,
  })
  expect(leaderboard_subscription(state, state)).toBeNull()
  expect(leaderboard_subscription({ ...state, navigation: initial.navigation }, state)).toEqual({
    type: 'packet/leaderboard_observe',
    observation: null,
  })
})

test('SUI formatting preserves the last MIST and all count digits', () => {
  expect(leaderboard_score('9007199254740993', 'marketplace', 'en')).toBe('9,007,199.254740993 SUI')
  expect(leaderboard_score('18446744073709551615', 'xp', 'en')).toBe('18,446,744,073,709,551,615')
})
