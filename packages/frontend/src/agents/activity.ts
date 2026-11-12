// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_checkpoint, type CharacterRow, type HostedAgentActivity } from '@aresrpg/protocol'

import type { SessionState } from '../modules/session.ts'

import { owner_connected } from './owner_state.ts'

/** Owner status is scoped to the exact observed wallet and character, never the last displayed task. */
export const current_agent_activity = (session: SessionState): HostedAgentActivity | null => {
  const { request, status } = session.agent_view
  const { selected_character_id } = session
  const { response, phase } = session.agent_connection
  if (![status === 'ready', session.link_status === 'ready', ['ready', 'checking'].includes(phase)].every(Boolean))
    return null
  if (!owner_connected(session)) return null
  if (request?.pairing.address !== response!.bot!.address) return null
  const { activity } = response!
  if (
    !activity ||
    (activity.character_ids.length && !activity.character_ids.some((id) => id === selected_character_id))
  )
    return null
  return activity
}

export type AgentActivity =
  | Readonly<{ kind: 'level'; level: number }>
  | Readonly<{ kind: 'profession' | 'travel' | 'fight_entered' | 'fight_left' }>

const changed_location = (before: Readonly<CharacterRow>, after: Readonly<CharacterRow>): boolean =>
  !!character_checkpoint(before) &&
  !!character_checkpoint(after) &&
  (after.at_ms ?? 0) >= (before.at_ms ?? 0) &&
  [before.world !== after.world, before.x !== after.x, before.z !== after.z].some(Boolean)

/** Accepted indexed snapshots establish activity; initial reads and duplicate delivery stay silent. */
export const fold_agent_activity = (
  history: readonly AgentActivity[],
  before: Readonly<CharacterRow> | null | undefined,
  after: Readonly<CharacterRow> | null | undefined,
  previous_status = 'ready',
  failed = false
): readonly AgentActivity[] => {
  if (previous_status !== 'ready' || failed || !before || !after || before.id !== after.id) return []
  const observations: readonly Readonly<{ changed: boolean; event: AgentActivity }>[] = [
    { changed: changed_location(before, after), event: { kind: 'travel' } },
    {
      changed: Object.entries(after.jobs).some(([job, xp]) => BigInt(xp) > BigInt(before.jobs[job] ?? '0')),
      event: { kind: 'profession' },
    },
    {
      changed: before.active_fight?.id !== after.active_fight?.id,
      event: { kind: after.active_fight ? 'fight_entered' : 'fight_left' },
    },
    { changed: after.level > before.level, event: { kind: 'level', level: after.level } },
  ]
  const changes = observations.filter(({ changed }) => changed).map(({ event }) => event)
  // The approved compact overlay shows two confirmed lines plus the derived current state.
  return changes.length ? [...history, ...changes].slice(-2) : history
}
