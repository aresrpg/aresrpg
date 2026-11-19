// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_checkpoint, type AgentStatus, type CharacterRow, type HostedObjective } from '@aresrpg/protocol'

import type { SessionState } from '../modules/session.ts'

import { owner_connected } from './owner_state.ts'

type WalletState = AgentStatus['state']
export type HeroActivity = Readonly<{ status: WalletState; objective: HostedObjective | null; issue?: string }>
/** Run statuses that say a hero is being played. An ended run says nothing. */
const PLAYED: readonly string[] = ['active', 'waiting', 'awaiting_ai', 'paused'] satisfies readonly WalletState[]
const stopped = ({ ready, state }: AgentStatus): WalletState | null => {
  if (!ready) return 'unavailable'
  return state === 'paused' || state === 'unavailable' ? state : null
}

/** The hero a direct command in flight acts for; null when none is in flight or it acts for the wallet. */
const commanded = ({ direct }: AgentStatus): string | null => {
  const hero = direct && ['accepted', 'executing'].includes(direct.status) ? direct.payload.character_id : null
  return typeof hero === 'string' ? hero : null
}
/** The wallet's work belongs to other heroes: their runs, or a direct command for one of them. */
const others_work = (status: AgentStatus, played: number, hero: string | null): boolean => {
  const target = commanded(status)
  return target === null ? played > 0 : target !== hero
}

/**
 * What the bot's pushed status says about one hero. A stopped wallet is said first; then the hero's
 * own run with its objective; the wallet's state describes a hero with no run only when the wallet's
 * work is not another hero's: a direct command in flight for this hero, or no hero played at all.
 */
export const hero_activity = (status: AgentStatus, hero: string | null): HeroActivity | null => {
  const halted = stopped(status)
  const played = status.runs.filter((run) => PLAYED.includes(run.status))
  const run = played.find(({ character_id }) => character_id === hero)
  if (run) return { status: halted ?? (run.status as WalletState), objective: run.objective ?? null, issue: run.issue }
  if (halted) return { status: halted, objective: null }
  return others_work(status, played.length, hero) ? null : { status: status.state, objective: null }
}

/** The bot's own status, scoped to the exact observed wallet and character, never the last displayed task. */
export const current_agent_activity = (session: SessionState): HeroActivity | null => {
  const { request, status: view } = session.agent_view
  const { status } = session.agent_inventory
  if (![view === 'ready', session.link_status === 'ready', owner_connected(session)].every(Boolean)) return null
  if (!status || request?.pairing.address !== session.inventory_pairing?.address) return null
  return hero_activity(status, session.selected_character_id)
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
