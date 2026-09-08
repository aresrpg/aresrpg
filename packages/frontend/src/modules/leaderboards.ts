// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket, LeaderboardMetric, LeaderboardObservation, LeaderboardSnapshot } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'

export type LeaderboardsState = Readonly<{
  observation: LeaderboardObservation
  snapshot: LeaderboardSnapshot | null
  error: boolean
}>
export type LeaderboardsInput =
  | Readonly<{ type: 'leaderboards/select'; metric: LeaderboardMetric; season: number | null }>
  | Readonly<{ type: 'leaderboards/refresh' }>

export const initial_leaderboards_state = (): LeaderboardsState => ({
  observation: { metric: 'xp', season: null, id: 0 },
  snapshot: null,
  error: false,
})

export const leaderboard_subscription = (state: AppState, previous: AppState): ClientPacket | null => {
  const open = state.navigation.page === 'leaderboard'
  const was_open = previous.navigation.page === 'leaderboard'
  const connected = state.session.link_status === 'ready'
  const reconnected = previous.session.link_status !== 'ready'
  if (!connected) return null
  if (!open && !was_open) return null
  const changed = open !== was_open || state.leaderboards.observation !== previous.leaderboards.observation
  if (!reconnected && !changed) return null
  return { type: 'packet/leaderboard_observe', observation: open ? state.leaderboards.observation : null }
}

export const reduce_leaderboards = (state: LeaderboardsState, input: AppInput): LeaderboardsState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected') return initial_leaderboards_state()
  if (input.type === 'leaderboards/select' || input.type === 'leaderboards/refresh') {
    const selected = input.type === 'leaderboards/select' ? input : state.observation
    return {
      observation: { metric: selected.metric, season: selected.season, id: state.observation.id + 1 },
      snapshot: null,
      error: false,
    }
  }
  if (input.type !== 'server/packet') return state
  return fold_snapshot(state, input.packet)
}

const fold_snapshot = (
  state: LeaderboardsState,
  packet: Extract<AppInput, { type: 'server/packet' }>['packet']
): LeaderboardsState => {
  if (packet.type === 'packet/leaderboard_error')
    return packet.observation.id === state.observation.id ? { ...state, error: true } : state
  if (packet.type !== 'packet/leaderboard') return state
  const { snapshot } = packet
  if (snapshot.observation.id !== state.observation.id) return state
  if (snapshot.checkpoint < (state.snapshot?.checkpoint ?? 0)) return state
  return { ...state, snapshot, error: false }
}

const leaderboards: AppModule = {
  name: 'leaderboards',
  reduce: (state, input) => {
    const leaderboards = reduce_leaderboards(state.leaderboards, input)
    return leaderboards === state.leaderboards ? state : { ...state, leaderboards }
  },
}

export default leaderboards
