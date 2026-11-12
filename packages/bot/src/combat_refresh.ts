// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command, Lane } from './control.ts'
import { assert_lease } from './control.ts'
import { assert_live_grant, type Bot, type Grant, type BotConfig } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import type { JournalBinding } from './transaction_journal.ts'
import type { CombatRun } from './combat_control.ts'
import { assert_combat_admission } from './combat_admission.ts'
import { next_combat_action } from './combat_plan.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'

/** Refresh only accepted drafts that have never crossed durable preparation. The run's
 * immutable profile is the accepted intent; signed bytes are never replanned here. */
export const refresh_combat_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  if (!command.combat_run_id) return command
  const key = `combat:${command.combat_run_id}`
  return store.transaction(
    [key, command.lane_key, `command:${command.id}`, `grant:${command.grant_id}`, `bot:${command.bot_id}`],
    async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
      const current = await tx.get<Command>(`command:${command.id}`)
      const run = await tx.get<CombatRun>(key)
      const grant = await tx.get<Grant>(`grant:${command.grant_id}`)
      if (!grant) throw new Error('invalid_token')
      assert_live_grant(config, grant, await tx.get<Bot>(`bot:${command.bot_id}`), now)
      const valid = [
        current?.status === 'accepted',
        current?.fingerprint === command.fingerprint,
        !lane.pending,
        !lane.paused,
        !lane.transport_stopped,
        !lane.needs_resync,
        !lane.reconciliation_command,
        lane.active_command === command.id,
        lane.decision_revision === command.decision_revision,
        lane.observation_revision === context.snapshot.observation_revision,
        grant.scopes.includes('bot:play'),
      ].every(Boolean)
      if (!valid) throw new Error('execution_not_authorized')
      assert_combat_admission(run, command, lane)
      if (!gameplay_observation_ready(context)) return null
      const next = next_combat_action(run!, {
        ...context,
        command: { ...command, observation_revision: lane.observation_revision },
      })
      return retain_draft(tx, run!, current!, lane, next)
    }
  )
}

const retain_draft = async (
  tx: ControlTransaction,
  run: CombatRun,
  current: Command,
  lane: Lane,
  next: ReturnType<typeof next_combat_action>
): Promise<Command | null> => {
  if (next.state === 'waiting') return null
  if (!next.action) {
    const issue = next.issue ?? 'fight_changed'
    await tx.put(`combat:${run.id}`, { ...run, status: 'awaiting_ai', issue })
    await tx.put(`command:${current.id}`, { ...current, status: 'cancelled', error: issue })
    await tx.put(current.lane_key, {
      ...lane,
      active_command: null,
      combat_run_id: null,
      decision_revision: lane.decision_revision + 1,
    })
    return null
  }
  const refreshed: Command = {
    ...current,
    ...next.action,
    observation_revision: lane.observation_revision,
    fight_baseline: undefined,
    action_baseline: undefined,
  }
  await tx.put(`command:${current.id}`, refreshed)
  return refreshed
}

/** A stale prepare refusal is still an accepted intent, not a failed or uncertain transaction. */
export const stale_combat_draft = (command: Command, lane: Lane, error: unknown): boolean =>
  [
    command.combat_run_id,
    command.status === 'accepted',
    !lane.pending,
    !lane.paused,
    !lane.transport_stopped,
    lane.combat_run_id === command.combat_run_id,
    lane.active_command === command.id,
    lane.decision_revision === command.decision_revision,
    lane.observation_revision !== command.observation_revision,
    error instanceof Error && ['needs_resync', 'execution_not_authorized'].includes(error.message),
  ].every(Boolean)
