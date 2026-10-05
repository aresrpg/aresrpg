// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket, LeaderboardMetric, LeaderboardObservation, LeaderboardSnapshot } from '@aresrpg/protocol'

import {
  initial_inspection,
  reduce_inspection,
  fold_inspection,
  inspection_request,
  type InspectionState,
  type InspectionInput,
} from '../leaderboards/inspection.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export type LeaderboardsState = Readonly<{
  observation: LeaderboardObservation
  snapshot: LeaderboardSnapshot | null
  error: boolean
  inspection: InspectionState
}>
export type LeaderboardsInput =
  | InspectionInput
  | Readonly<{ type: 'leaderboards/select'; metric: LeaderboardMetric }>
  | Readonly<{ type: 'leaderboards/refresh' }>

export const initial_leaderboards_state = (): LeaderboardsState => ({
  observation: { metric: 'xp', id: 0 },
  snapshot: null,
  error: false,
  inspection: initial_inspection(),
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
  if (['auth/disconnected', 'auth/rejected'].includes(input.type))
    return { ...initial_leaderboards_state(), inspection: initial_inspection(state.inspection.id) }
  if (input.type.startsWith('leaderboards/inspect'))
    return { ...state, inspection: reduce_inspection(state.inspection, input as InspectionInput) }
  if (input.type === 'leaderboards/select' || input.type === 'leaderboards/refresh') {
    const selected = input.type === 'leaderboards/select' ? input : state.observation
    return {
      ...state,
      observation: { metric: selected.metric, id: state.observation.id + 1 },
      snapshot: null,
      error: false,
    }
  }
  if (input.type !== 'server/packet') return state
  const inspection = fold_inspection(state.inspection, input.packet)
  return fold_snapshot(inspection === state.inspection ? state : { ...state, inspection }, input.packet)
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
    const next = reduce_leaderboards(state.leaderboards, input)
    const leaderboards =
      state.navigation.page !== 'leaderboard' && next.inspection.target
        ? { ...next, inspection: initial_inspection(next.inspection.id + 1) }
        : next
    return leaderboards === state.leaderboards ? state : { ...state, leaderboards }
  },
}

export default leaderboards

export const inspection_subscription = (state: AppState, previous: AppState): ClientPacket | null =>
  state.session.link_status === 'ready' && state.leaderboards.inspection.id !== previous.leaderboards.inspection.id
    ? inspection_request(state.leaderboards.inspection)
    : null
