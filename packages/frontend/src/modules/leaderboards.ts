// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  ClientPacket,
  LeaderboardMetric,
  LeaderboardObservation,
  LeaderboardSnapshot,
  ServerPacket,
} from '@aresrpg/protocol'

import {
  initial_inspection,
  reduce_inspection,
  fold_inspection,
  inspection_request,
  type InspectionState,
  type InspectionInput,
} from '../leaderboards/inspection.ts'
import { copy_text } from '../i18n/copy.ts'
import { link_accepted } from '../server_link.ts'
import type { AppInput, SiteContext, SiteModule, SiteState } from '../store.ts'
import { toast } from '../toast.ts'

import { observe_subscriptions } from './session.ts'

/** The board the view reads: asked for, read, or refused by the server. */
export type LeaderboardBoard =
  | Readonly<{ status: 'waiting' }>
  | Readonly<{ status: 'ready'; snapshot: LeaderboardSnapshot }>
  | Readonly<{ status: 'failed' }>

export type LeaderboardsState = Readonly<{
  /** The rankings on screen; null while no rankings view is on screen. The socket follows it. */
  observation: LeaderboardObservation | null
  board: LeaderboardBoard
  inspection: InspectionState
}>
export type LeaderboardsInput =
  | InspectionInput
  | Readonly<{ type: 'leaderboards/observed'; metric: LeaderboardMetric | null }>
  | Readonly<{ type: 'leaderboards/refresh' }>

const WAITING: LeaderboardBoard = Object.freeze({ status: 'waiting' })

export const initial_leaderboards_state = (): LeaderboardsState => ({
  observation: null,
  board: WAITING,
  inspection: initial_inspection(),
})

/** The board a visit opens on. */
export const FIRST_BOARD: LeaderboardMetric = 'xp'

/** The board the view shows: the one it observes, or the first one before it does. */
export const board_metric = ({ observation }: Pick<LeaderboardsState, 'observation'>): LeaderboardMetric =>
  observation?.metric ?? FIRST_BOARD

/** The board on screen, or none yet. */
export const shown_snapshot = ({ board }: Pick<LeaderboardsState, 'board'>): LeaderboardSnapshot | null =>
  board.status === 'ready' ? board.snapshot : null

const packet_of = (observation: LeaderboardObservation | null): ClientPacket => ({
  type: 'packet/leaderboard_observe',
  observation,
})

/** The view's one observation: sent when it changes, and again as soon as a new link is accepted. */
export const leaderboard_subscription = (state: SiteState, previous: SiteState): ClientPacket | null => {
  const { observation } = state.leaderboards
  if (!link_accepted(state.session.link_status)) return null
  const unchanged = link_accepted(previous.session.link_status)
    ? observation === previous.leaderboards.observation
    : observation === null
  return unchanged ? null : packet_of(observation)
}

const ask = (state: LeaderboardsState, metric: LeaderboardMetric): LeaderboardsState => ({
  ...state,
  observation: { metric, id: (state.observation?.id ?? 0) + 1 },
  board: WAITING,
})

/** A view that leaves releases the profile it opened. */
const leave = (state: LeaderboardsState): LeaderboardsState =>
  state.observation === null
    ? state
    : {
        ...state,
        observation: null,
        board: WAITING,
        inspection: state.inspection.target ? initial_inspection(state.inspection.id + 1) : state.inspection,
      }

/** Another viewer: the board stays on screen without the old viewer's own row, and the view asks again. */
const change_viewer = (state: LeaderboardsState): LeaderboardsState => ({
  observation: state.observation && { ...state.observation, id: state.observation.id + 1 },
  board:
    state.board.status === 'ready' ? { status: 'ready', snapshot: { ...state.board.snapshot, self: null } } : WAITING,
  inspection: initial_inspection(state.inspection.id),
})

/** A view that leaves and comes back counts again from one: a packet answers it only for the same board and id. */
const answers = (observation: LeaderboardObservation | null, packet: LeaderboardObservation): boolean =>
  observation !== null && observation.id === packet.id && observation.metric === packet.metric

const fold_board = (state: LeaderboardsState, packet: Readonly<ServerPacket>): LeaderboardsState => {
  if (packet.type === 'packet/leaderboard_error')
    return answers(state.observation, packet.observation) ? { ...state, board: { status: 'failed' } } : state
  if (packet.type !== 'packet/leaderboard') return state
  const { snapshot } = packet
  if (!answers(state.observation, snapshot.observation)) return state
  const shown = shown_snapshot(state)
  if (shown && snapshot.checkpoint < shown.checkpoint) return state
  return { ...state, board: { status: 'ready', snapshot } }
}

const identity_changed = (state: SiteState, input: AppInput): boolean =>
  input.type === 'auth/disconnected' ||
  input.type === 'auth/rejected' ||
  (input.type === 'auth/connected' && state.session.wallet === input.session)

/** The view shows a board, another one, or none. */
const observe_board = (state: LeaderboardsState, metric: LeaderboardMetric | null): LeaderboardsState => {
  if (metric === null) return leave(state)
  return metric === state.observation?.metric ? state : ask(state, metric)
}

const fold_packet = (state: LeaderboardsState, packet: Readonly<ServerPacket>): LeaderboardsState => {
  const inspection = fold_inspection(state.inspection, packet)
  return fold_board(inspection === state.inspection ? state : { ...state, inspection }, packet)
}

export const reduce_leaderboards = (state: LeaderboardsState, input: AppInput): LeaderboardsState => {
  if (input.type === 'leaderboards/observed') return observe_board(state, input.metric)
  if (input.type === 'leaderboards/refresh') return state.observation ? ask(state, state.observation.metric) : state
  if (input.type.startsWith('leaderboards/inspect'))
    return { ...state, inspection: reduce_inspection(state.inspection, input as InspectionInput) }
  return input.type === 'server/packet' ? fold_packet(state, input.packet) : state
}

/** A board the server refuses is a toast with a retry, for as long as the refusal holds. */
const observe_refusal = ({ events, dispatch, signal }: SiteContext): void => {
  let dismiss = (): void => undefined
  events.on('STATE_UPDATED', (state, previous) => {
    const failed = state.leaderboards.board.status === 'failed'
    if (failed === (previous.leaderboards.board.status === 'failed')) return
    dismiss()
    dismiss = () => undefined
    if (!failed || !state.copy) return
    const text = copy_text(state.copy.leaderboard_page)
    dismiss = toast.persistent(text('unavailable'), 'error', {
      label: text('retry'),
      onClick: () => dispatch({ type: 'leaderboards/refresh' }),
    })
  })
  // eslint-disable-next-line functional/prefer-tacit -- the remover changes with each refusal, so the abort reads it when it fires.
  signal.addEventListener('abort', () => dismiss(), { once: true })
}

export const inspection_subscription = (state: SiteState, previous: SiteState): ClientPacket | null =>
  link_accepted(state.session.link_status) && state.leaderboards.inspection.id !== previous.leaderboards.inspection.id
    ? inspection_request(state.leaderboards.inspection)
    : null

const leaderboards: SiteModule = {
  name: 'leaderboards',
  initial: () => ({ leaderboards: initial_leaderboards_state() }),
  observe: (context) => {
    observe_refusal(context)
    observe_subscriptions(context, [leaderboard_subscription, inspection_subscription])
  },
  reduce: (state, input) => {
    const next = identity_changed(state, input) ? change_viewer(state.leaderboards) : state.leaderboards
    const leaderboards = reduce_leaderboards(next, input)
    return leaderboards === state.leaderboards ? state : { ...state, leaderboards }
  },
}

export default leaderboards
