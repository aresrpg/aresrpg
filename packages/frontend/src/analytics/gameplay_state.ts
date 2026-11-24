// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AuthSession } from '../auth.ts'
import type { AppInput, AppState } from '../store.ts'
import type { LoadingProgress } from '../game/core/loading_progress.ts'

import { activity_due, manually_moved, type MovementSample } from './activity.ts'
import { fold_fight_observation, observe_fight, type FightObservation } from './fights.ts'
import { feedback_target, type FeedbackState, type FeedbackInput } from './feedback.ts'

/** What the game measures of play: movement, activity, fights, onboarding feedback and world loading. */
export type GameplayAnalyticsState = Readonly<{
  /** The last observed wallet lifetime scopes measurements; session alone owns authentication. */
  scope: AuthSession | null
  movement: MovementSample | null
  moved_at: number | null
  active: Readonly<{ at_ms: number; activity: string }> | null
  fights: Readonly<Record<string, FightObservation>>
  feedback: FeedbackState
  loading: Readonly<{
    world: string
    stage: LoadingProgress['stage']
    started_at_ms: number
    duration_ms: number
  }> | null
}>

type WalletGameplayInput = Readonly<{ wallet: AuthSession }> &
  (
    | Readonly<{ type: 'analytics/movement_sample'; sample: MovementSample | null }>
    | Readonly<{ type: 'analytics/activity_observed'; at_ms: number; activity: string }>
    | Readonly<{ type: 'analytics/world_loading'; world: string; stage: LoadingProgress['stage']; at_ms: number }>
  )
export type GameplayAnalyticsInput = WalletGameplayInput | FeedbackInput

export const initial_gameplay_analytics_state = (): GameplayAnalyticsState => ({
  scope: null,
  movement: null,
  moved_at: null,
  active: null,
  fights: {},
  feedback: 'pending',
  loading: null,
})

type HandledInput =
  | GameplayAnalyticsInput
  | Extract<
      AppInput,
      {
        type: 'fight/checkpoint_confirmed' | 'fight/uncached'
      }
    >
type Handlers = {
  readonly [T in HandledInput['type']]: (
    state: AppState,
    input: Extract<HandledInput, { type: T }>
  ) => GameplayAnalyticsState
}
// Exhaustive input routing belongs to this reducer. Each handler projects just its observed slice.
const HANDLERS: Handlers = {
  'analytics/activity_observed': ({ gameplay_analytics: analytics }, input) =>
    activity_due(analytics.active?.at_ms ?? null, input.at_ms)
      ? { ...analytics, active: { at_ms: input.at_ms, activity: input.activity } }
      : analytics,
  'analytics/movement_sample': ({ gameplay_analytics: analytics }, { sample }) => {
    if (!sample) return analytics.movement ? { ...analytics, movement: null } : analytics
    const moved = manually_moved(analytics.movement, sample) && activity_due(analytics.moved_at, sample.at_ms)
    return { ...analytics, movement: sample, moved_at: moved ? sample.at_ms : analytics.moved_at }
  },
  'analytics/world_loading': ({ gameplay_analytics: analytics }, input) => {
    const previous = analytics.loading?.world === input.world ? analytics.loading : null
    if (previous && ['ready', input.stage].includes(previous.stage)) return analytics
    const started_at_ms = previous?.started_at_ms ?? input.at_ms
    return {
      ...analytics,
      loading: {
        world: input.world,
        stage: input.stage,
        started_at_ms,
        duration_ms: Math.max(0, Math.round(input.at_ms - started_at_ms)),
      },
    }
  },
  'analytics/feedback_loaded': ({ gameplay_analytics: analytics }, { seen }) =>
    analytics.feedback === 'pending' ? { ...analytics, feedback: seen ? 'done' : 'available' } : analytics,
  'analytics/feedback_offered': (state, { stage }) =>
    state.gameplay_analytics.feedback === 'available' && feedback_target(state) === stage
      ? { ...state.gameplay_analytics, feedback: { stage, answer: null } }
      : state.gameplay_analytics,
  'analytics/feedback_answered': ({ gameplay_analytics: analytics }, { answer }) =>
    typeof analytics.feedback === 'object' && analytics.feedback.answer === null
      ? { ...analytics, feedback: { ...analytics.feedback, answer } }
      : analytics,
  'fight/checkpoint_confirmed': (state, input) => {
    const next = observe_fight(state, input.checkpoint)
    if (!next) return state.gameplay_analytics
    const fights = fold_fight_observation(state.gameplay_analytics.fights, input.checkpoint.contract.id, next)
    return fights === state.gameplay_analytics.fights
      ? state.gameplay_analytics
      : { ...state.gameplay_analytics, fights }
  },
  'fight/uncached': ({ gameplay_analytics: analytics }, { fight }) =>
    analytics.fights[fight]
      ? { ...analytics, fights: Object.fromEntries(Object.entries(analytics.fights).filter(([id]) => id !== fight)) }
      : analytics,
}

const handled_input = (input: AppInput): input is HandledInput => Object.hasOwn(HANDLERS, input.type)
export const reduce_gameplay_analytics = (state: AppState, input: AppInput): AppState => {
  if (state.gameplay_analytics.scope !== state.session.wallet)
    return {
      ...state,
      gameplay_analytics: {
        ...initial_gameplay_analytics_state(),
        scope: state.session.wallet,
        feedback: state.gameplay_analytics.feedback,
      },
    }
  if (!handled_input(input)) return state
  if ('wallet' in input && input.wallet !== state.session.wallet) return state
  const gameplay_analytics = HANDLERS[input.type](state, input as never)
  return gameplay_analytics === state.gameplay_analytics ? state : { ...state, gameplay_analytics }
}
