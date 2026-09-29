// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { capture_analytics } from '../analytics.ts'
import { character_creation_insufficient } from '../character_creation_funding.ts'
import type { AppModule, AppState } from '../store.ts'

type AnalyticsEvent = Readonly<{ name: string; properties?: Readonly<Record<string, string | number>> }>
type Milestone = Readonly<{ reached: boolean; event: AnalyticsEvent }>

const session_milestones = ({ session, navigation }: AppState): readonly Milestone[] => [
  { reached: session.auth_request === 'google', event: { name: 'login_started', properties: { method: 'google' } } },
  {
    reached: typeof session.auth_request === 'object' && session.auth_request !== null,
    event: { name: 'login_started', properties: { method: 'wallet' } },
  },
  { reached: session.auth_status === 'authenticated', event: { name: 'login_completed' } },
  { reached: Boolean(session.auth_error), event: { name: 'login_failed' } },
  { reached: navigation.dialog === 'character_create', event: { name: 'character_creation_opened' } },
  {
    reached: session.sui_balance_mist !== null && !character_creation_insufficient(session.sui_balance_mist),
    event: { name: 'creation_funds_available' },
  },
  ...(['submitted', 'failed', 'confirmed'] as const).map((status) => ({
    reached: session.character_creation?.status === status,
    event: { name: `character_creation_${status}` },
  })),
]

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

export const analytics_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const before = [...session_milestones(previous), ...companion_milestones(previous)]
  return [
    ...[...session_milestones(state), ...companion_milestones(state)]
      .filter((milestone, index) => milestone.reached && !before[index]!.reached)
      .map(({ event }) => event),
    ...(state.adventure.character && !previous.adventure.character ? [{ name: 'demo_started' }] : []),
    ...adventure_events(state, previous),
  ]
}

const observe: NonNullable<AppModule['observe']> = ({ events }) => {
  events.on('STATE_UPDATED', (state, previous) => {
    for (const event of analytics_events(state, previous))
      capture_analytics(event.name, { ...event.properties, locale: state.locale, demo_version: 2 })
  })
}

export default Object.freeze({ name: 'analytics', reduce: undefined, observe }) satisfies AppModule
