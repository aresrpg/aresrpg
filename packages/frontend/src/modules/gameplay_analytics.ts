// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the game measures of play: onboarding, crafting, quests, fights, movement and world loading.
import { bind_analytics_context, capture_analytics, type AnalyticsEvent } from '../analytics.ts'
import { site_analytics_context, type AnalyticsProperties } from '../analytics/context.ts'
import { engagement_activity, movement_sample } from '../analytics/activity.ts'
import {
  initial_gameplay_analytics_state,
  reduce_gameplay_analytics,
  type GameplayAnalyticsInput,
  type GameplayAnalyticsState,
} from '../analytics/gameplay_state.ts'
import { gameplay_events } from '../analytics/gameplay.ts'
import { analytics_available } from '../analytics.ts'
import { feedback_events, observe_feedback } from '../analytics/feedback.ts'
import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { character_creation_insufficient } from '../character_creation_funding.ts'
import type { AppModule, AppState } from '../store.ts'
import { next_quest } from '../journey/model.ts'

import { character_creation_surface } from './character_creation.ts'
export type { GameplayAnalyticsInput, GameplayAnalyticsState }

type Milestone = Readonly<{ reached: boolean; event: AnalyticsEvent }>

const creation_milestones = ({ session, navigation }: AppState): readonly Milestone[] => {
  const creation = character_creation_surface(session, navigation)
  return [
    { reached: creation === 'welcome', event: { name: 'character_creation_welcome_opened' } },
    { reached: creation === 'character_create', event: { name: 'character_creation_opened' } },
    {
      reached: session.sui_balance_mist !== null && !character_creation_insufficient(session.sui_balance_mist),
      event: { name: 'creation_funds_available' },
    },
    ...(['submitted', 'failed', 'confirmed'] as const).map((status) => ({
      reached: session.character_creation?.status === status,
      event: { name: `character_creation_${status}` },
    })),
  ]
}

const onboarding_stage = ({ session, navigation, gameplay_analytics }: AppState): string => {
  if (!session.wallet) return 'login'
  const creation = character_creation_surface(session, navigation)
  if (creation) return creation
  if (!session.selected_character_id) return 'character_selection'
  return gameplay_analytics.loading?.stage === 'ready' ? 'gameplay' : 'world_loading'
}

/** Both reporting transports read this projection; neither keeps a second onboarding state. */
export const game_analytics_context = (state: AppState): AnalyticsProperties => ({
  ...site_analytics_context(state),
  surface: state.navigation.page,
  onboarding_step: onboarding_stage(state),
  automation_active: state.automation.run !== null,
  quality: state.settings.quality,
  journey_step: state.journey.ready ? (next_quest(state.journey.completed)?.id ?? 'complete') : 'unknown',
})

const completed_events = (
  name: string,
  next: readonly string[] | null,
  previous: readonly string[] | null
): readonly AnalyticsEvent[] =>
  previous === null
    ? []
    : (next ?? []).filter((id) => !previous.includes(id)).map((quest_id) => ({ name, properties: { quest_id } }))

const quest_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] =>
  previous.journey.ready && state.journey.identity === previous.journey.identity
    ? completed_events('quest_completed', state.journey.completed, previous.journey.completed)
    : []

const craft_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const craft = state.session.craft_result
  if (state.session.wallet !== previous.session.wallet || !craft) return []
  if (craft.digest === previous.session.craft_result?.digest) return []
  const { output_type, attempts, successes, job } = craft
  const journey: AnalyticsProperties = state.journey.ready
    ? { journey_step: next_quest(state.journey.completed)?.id ?? 'complete' }
    : {}
  return [
    { name: 'craft_completed', properties: { output_type, attempts, successes, job, ...journey, control: 'manual' } },
  ]
}

export const gameplay_analytics_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const domains = ['gameplay_analytics', 'fight', 'session', 'navigation', 'journey', 'world'] as const
  if (domains.every((domain) => state[domain] === previous[domain])) return []
  const before = creation_milestones(previous)
  return [
    ...feedback_events(state.gameplay_analytics.feedback, previous.gameplay_analytics.feedback),
    ...craft_events(state, previous),
    ...gameplay_events(state, previous),
    ...creation_milestones(state)
      .filter((milestone, index) => milestone.reached && !before[index]!.reached)
      .map(({ event }) => event),
    ...quest_events(state, previous),
  ]
}

const observe: NonNullable<AppModule['observe']> = (context) => {
  const { events, dispatch, get_state, signal } = context
  if (analytics_available()) observe_feedback(context)
  // The game's projection replaces the site's for every event this document sends.
  const unbind_context = bind_analytics_context(() => game_analytics_context(get_state()))
  let sampled_at = -Infinity
  const stop_pose = subscribe_pose(() => {
    const at_ms = performance.now()
    if (at_ms - sampled_at < 1_000) return
    sampled_at = at_ms
    const state = get_state()
    const { wallet } = state.session
    if (!wallet) return
    const visible = globalThis.document?.visibilityState !== 'hidden'
    dispatch({
      type: 'analytics/movement_sample',
      wallet,
      sample: movement_sample(state, read_pose(), at_ms, visible),
    })
  })
  signal.addEventListener(
    'abort',
    () => {
      stop_pose()
      unbind_context()
    },
    { once: true }
  )
  events.on('STATE_UPDATED', (state, previous) => {
    const observed = gameplay_analytics_events(state, previous)
    for (const event of observed) capture_analytics(event.name, event.properties)
    const activity = observed.map(({ name, properties }) => engagement_activity(name, properties)).find(Boolean)
    if (activity && state.session.wallet && globalThis.document?.visibilityState !== 'hidden')
      dispatch({
        type: 'analytics/activity_observed',
        wallet: state.session.wallet,
        activity,
        at_ms: performance.now(),
      })
  })
  events.on('STATE_UPDATED', (state) => {
    const { wallet, selected_character_id, characters } = state.session
    const world = characters.find(({ id }) => id === selected_character_id)?.world
    if (wallet && world && state.gameplay_analytics.loading?.world !== world)
      dispatch({ type: 'analytics/world_loading', wallet, world, stage: 'assets', at_ms: performance.now() })
  })
}

export default Object.freeze({
  name: 'gameplay_analytics',
  initial: () => ({ gameplay_analytics: initial_gameplay_analytics_state() }),
  reduce: reduce_gameplay_analytics,
  observe,
}) satisfies AppModule
