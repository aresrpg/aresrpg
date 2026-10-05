// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { TransactionExecution } from '@aresrpg/sdk'

import { capture_analytics, type AnalyticsEvent } from '../analytics.ts'
import type { AuthSession } from '../auth.ts'
import { adventure_completed_quests } from '../adventure/quest.ts'
import { character_creation_insufficient } from '../character_creation_funding.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { next_quest } from '../journey/model.ts'

import { character_creation_surface } from './character_creation.ts'
import { holds_character_seat } from './fight_identity.ts'

export type AnalyticsState = TransactionExecution | null
export type AnalyticsInput = Readonly<{
  type: 'analytics/transaction_executed'
  wallet: AuthSession
  execution: TransactionExecution
}>

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/connected' || input.type === 'auth/disconnected')
    return state.analytics ? { ...state, analytics: null } : state
  if (input.type !== 'analytics/transaction_executed') return state
  if (input.wallet !== state.session.wallet || input.execution.digest === state.analytics?.digest) return state
  return { ...state, analytics: input.execution }
}

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

const fight_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const owner = state.session.wallet?.address ?? null
  if (state.fight.mode !== 'remote' || state.session.wallet !== previous.session.wallet) return []
  return Object.values(state.fight.cached).flatMap((checkpoint): readonly AnalyticsEvent[] => {
    const before = previous.fight.cached[checkpoint.contract.id]
    const started = before?.contract.round === 0n && checkpoint.contract.round > 0n
    const participating = state.session.characters.some(({ id }) => holds_character_seat(checkpoint, id, owner))
    return started && participating ? [{ name: 'fight_started' }] : []
  })
}

const receipt_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  if (state.session.wallet !== previous.session.wallet) return []
  const journey_step: Readonly<Record<string, string>> = state.journey.ready
    ? { journey_step: next_quest(state.journey.completed)?.id ?? 'complete' }
    : {}
  return [
    {
      name: 'transaction_executed',
      current: state.analytics,
      before: previous.analytics,
      fields: ['outcome', 'gas_mist'],
    },
    {
      name: 'craft_completed',
      current: state.session.craft_result,
      before: previous.session.craft_result,
      fields: ['output_type', 'attempts', 'successes'],
    },
  ].flatMap(({ name, current, before, fields }): readonly AnalyticsEvent[] => {
    if (!current || current.digest === before?.digest) return []
    const properties = Object.fromEntries(Object.entries(current).filter(([key]) => fields.includes(key)))
    return [{ name, properties: { ...properties, ...journey_step } }]
  })
}

export const analytics_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const domains = ['analytics', 'fight', 'session', 'navigation', 'adventure', 'journey'] as const
  if (domains.every((domain) => state[domain] === previous[domain])) return []
  const before = [...session_milestones(previous), ...companion_milestones(previous)]
  return [
    ...receipt_events(state, previous),
    ...fight_events(state, previous),
    ...[...session_milestones(state), ...companion_milestones(state)]
      .filter((milestone, index) => milestone.reached && !before[index]!.reached)
      .map(({ event }) => event),
    ...(state.adventure.character && !previous.adventure.character ? [{ name: 'demo_started' }] : []),
    ...adventure_events(state, previous),
    ...quest_events(state, previous),
  ]
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  let unsubscribe: (() => void) | undefined
  const bind = (wallet: AuthSession | null): void => {
    unsubscribe?.()
    unsubscribe = wallet?.on_transaction((execution) =>
      dispatch({ type: 'analytics/transaction_executed', wallet, execution })
    )
  }
  bind(get_state().session.wallet)
  signal.addEventListener('abort', () => unsubscribe?.(), { once: true })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) bind(state.session.wallet)
    for (const event of analytics_events(state, previous))
      capture_analytics(event.name, { ...event.properties, locale: state.locale })
  })
}

export default Object.freeze({ name: 'analytics', reduce, observe }) satisfies AppModule
