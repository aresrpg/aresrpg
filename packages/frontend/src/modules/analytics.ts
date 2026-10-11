// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  analytics_available,
  bind_analytics_context,
  capture_analytics,
  identify_analytics,
  reset_analytics_identity,
  type AnalyticsEvent,
} from '../analytics.ts'
import { analytics_context, analytics_identity, type AnalyticsProperties } from '../analytics/context.ts'
import { engagement_activity, movement_sample } from '../analytics/activity.ts'
import { create_replay_observer, replay_eligible } from '../analytics/replay.ts'
import { reduce_analytics } from '../analytics/state.ts'
import { gameplay_events } from '../analytics/gameplay.ts'
import { feedback_events, observe_feedback } from '../analytics/feedback.ts'
import { env } from '../env.ts'
import { is_admin_address } from '../admin_access.ts'
import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { report_error } from '../reporting.ts'
import type { AuthSession } from '../auth.ts'
import { adventure_completed_quests } from '../adventure/quest.ts'
import { character_creation_insufficient } from '../character_creation_funding.ts'
import type { AppModule, AppState } from '../store.ts'
import { next_quest } from '../journey/model.ts'

import { character_creation_surface } from './character_creation.ts'
export type { AnalyticsState, AnalyticsInput } from '../analytics/state.ts'

type Milestone = Readonly<{ reached: boolean; event: AnalyticsEvent }>

const session_milestones = ({ session, navigation }: AppState): readonly Milestone[] => {
  const creation = character_creation_surface(session, navigation)
  return [
    { reached: session.auth_request === 'google', event: { name: 'login_started', properties: { method: 'google' } } },
    {
      reached: typeof session.auth_request === 'object' && session.auth_request !== null,
      event: { name: 'login_started', properties: { method: 'wallet' } },
    },
    { reached: session.auth_status === 'authenticated', event: { name: 'login_completed' } },
    { reached: Boolean(session.auth_error), event: { name: 'login_failed' } },
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

const adventure_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const next = state.adventure
  const before = previous.adventure
  if (next.phase === before.phase) return []
  const encounter = before.encounter + 1
  switch (next.phase) {
    case 'fighting':
      return [{ name: 'demo_fight_started', properties: { encounter } }]
    case 'reward':
      return [
        {
          name: 'demo_fight_completed',
          properties: {
            encounter,
            outcome: next.result?.winner === 0 ? 'victory' : 'defeat',
          },
        },
      ]
    case 'complete':
      return [{ name: 'demo_completed' }]
    default:
      return []
  }
}

const adventure_combat_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const current = state.fight.checkpoint
  const before = previous.fight.checkpoint
  if (!current || !before) return []
  if (
    state.adventure.phase !== 'fighting' ||
    current.contract.id !== `adventure_${state.adventure.encounter}` ||
    before.contract.id !== current.contract.id
  )
    return []
  return before.contract.round === 0n && current.contract.round > 0n
    ? [{ name: 'demo_combat_started', properties: { encounter: state.adventure.encounter + 1 } }]
    : []
}

const companion_milestones = ({ adventure }: AppState): readonly Milestone[] => [
  { reached: adventure.companion !== null, event: { name: 'demo_sceat_recruited' } },
  { reached: adventure.switched_companion, event: { name: 'demo_character_switched' } },
  { reached: adventure.followed, event: { name: 'demo_follow_enabled' } },
]

const completed_events = (
  name: string,
  next: readonly string[],
  previous: readonly string[]
): readonly AnalyticsEvent[] =>
  next.filter((id) => !previous.includes(id)).map((quest_id) => ({ name, properties: { quest_id } }))

const quest_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => [
  ...completed_events(
    'demo_quest_completed',
    adventure_completed_quests(state.adventure),
    adventure_completed_quests(previous.adventure)
  ),
  ...(previous.journey.ready && state.journey.identity === previous.journey.identity
    ? completed_events('quest_completed', state.journey.completed, previous.journey.completed)
    : []),
]

const receipt_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  if (state.session.wallet !== previous.session.wallet) return []
  const journey_step: Readonly<Record<string, string>> = state.journey.ready
    ? { journey_step: next_quest(state.journey.completed)?.id ?? 'complete' }
    : {}
  return [
    {
      name: 'transaction_executed',
      current: state.analytics.execution,
      before: previous.analytics.execution,
      fields: ['outcome', 'gas_mist'],
      metadata: {} as AnalyticsProperties,
    },
    {
      name: 'craft_completed',
      current: state.session.craft_result,
      before: previous.session.craft_result,
      fields: ['output_type', 'attempts', 'successes', 'job'],
      metadata: { control: 'manual' },
    },
  ].flatMap(({ name, current, before, fields, metadata }): readonly AnalyticsEvent[] => {
    if (!current || current.digest === before?.digest) return []
    const properties = Object.fromEntries(Object.entries(current).filter(([key]) => fields.includes(key)))
    return [
      {
        name,
        properties: {
          ...properties,
          ...journey_step,
          ...metadata,
        },
      },
    ]
  })
}

export const analytics_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const domains = [
    'analytics',
    'fight',
    'session',
    'navigation',
    'adventure',
    'journey',
    'world',
    'marketplace',
  ] as const
  if (domains.every((domain) => state[domain] === previous[domain])) return []
  const before = [...session_milestones(previous), ...companion_milestones(previous)]
  return [
    ...feedback_events(state.analytics.feedback, previous.analytics.feedback),
    ...receipt_events(state, previous),
    ...gameplay_events(state, previous),
    ...[...session_milestones(state), ...companion_milestones(state)]
      .filter((milestone, index) => milestone.reached && !before[index]!.reached)
      .map(({ event }) => event),
    ...(state.adventure.character && !previous.adventure.character ? [{ name: 'demo_started' }] : []),
    ...adventure_events(state, previous),
    ...adventure_combat_events(state, previous),
    ...quest_events(state, previous),
  ]
}

const observe: NonNullable<AppModule['observe']> = (context) => {
  const { events, dispatch, get_state, signal } = context
  if (analytics_available()) observe_feedback(context)
  let unsubscribe: (() => void) | undefined
  const unbind_context = bind_analytics_context(() => analytics_context(get_state()))
  const observe_replay = create_replay_observer()
  const sync_replay = (state: AppState): void =>
    observe_replay(analytics_available() && replay_eligible(state, globalThis.location?.pathname ?? '/'))
  sync_replay(get_state())
  const bind = (wallet: AuthSession | null): void => {
    unsubscribe?.()
    unsubscribe = wallet?.on_transaction((execution) =>
      dispatch({ type: 'analytics/transaction_executed', wallet, execution })
    )
    if (!wallet || !analytics_available()) return
    void analytics_identity(env.network, wallet.address).then(
      (identity) => {
        if (!signal.aborted) dispatch({ type: 'analytics/identity_resolved', wallet, identity })
      },
      (error: unknown) => report_error(error, { area: 'analytics_identity' })
    )
  }
  bind(get_state().session.wallet)
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
      unsubscribe?.()
      stop_pose()
      unbind_context()
      observe_replay(false)
    },
    { once: true }
  )
  events.on('STATE_UPDATED', (state, previous) => {
    sync_replay(state)
    if (state.session.wallet !== previous.session.wallet) {
      if (previous.session.wallet) reset_analytics_identity()
      bind(state.session.wallet)
    }
    if (state.analytics.identity && state.analytics.identity !== previous.analytics.identity)
      identify_analytics(state.analytics.identity, is_admin_address(state.session.wallet?.address ?? null))
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const observed = analytics_events(state, previous)
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
    if (wallet && world && state.analytics.loading?.world !== world)
      dispatch({ type: 'analytics/world_loading', wallet, world, stage: 'assets', at_ms: performance.now() })
  })
}

export default Object.freeze({ name: 'analytics', reduce: reduce_analytics, observe }) satisfies AppModule
