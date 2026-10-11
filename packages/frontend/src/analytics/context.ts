// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { adventure_quest } from '../adventure/quest.ts'
import { is_admin_address } from '../admin_access.ts'
import { next_quest } from '../journey/model.ts'
import { character_creation_surface } from '../modules/character_creation.ts'
import type { AppState } from '../store.ts'

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | null>>

const onboarding_stage = ({ session, navigation, adventure, analytics }: AppState): string => {
  if (adventure.character && adventure.phase !== 'entered') return `demo_${adventure_quest(adventure)}`
  if (!session.wallet) return 'login'
  const creation = character_creation_surface(session, navigation)
  if (creation) return creation
  if (!session.selected_character_id) return 'character_selection'
  return analytics.loading?.stage === 'ready' ? 'gameplay' : 'world_loading'
}

/** Both reporting transports read this projection; neither keeps a second onboarding state. */
export const analytics_context = (state: AppState): AnalyticsProperties => {
  const { session, navigation, journey } = state
  const stage = onboarding_stage(state)
  return {
    surface: stage.startsWith('demo_') ? 'demo' : navigation.page,
    onboarding_step: stage,
    locale: state.locale,
    authenticated: session.wallet !== null,
    is_internal: is_admin_address(session.wallet?.address ?? null),
    automation_active: state.automation.run !== null,
    quality: state.settings.quality,
    journey_step: journey.ready ? (next_quest(journey.completed)?.id ?? 'complete') : 'unknown',
  }
}

/** A pseudonym, not anonymization: a public address can still be matched by recomputing its hash. */
export const analytics_identity = async (network: string, address: string): Promise<string> => {
  const input = new TextEncoder().encode(`aresrpg:analytics:v1:${network}:${address.toLowerCase()}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return `player_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
