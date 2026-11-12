import type { CombatRun } from './combat_control.ts'
import type { ProfessionRun } from './profession_control.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { assert_run_admission } from './run_admission.ts'
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_keys, run_ref_of, same_run } from './run_ref.ts'
import { retain_behavior_draft } from './behavior_refresh.ts'
import type { Command, Lane } from './control.ts'
import { assert_lease } from './control.ts'
import { assert_live_grant, type Bot, type Grant, type BotConfig } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import type { JournalBinding } from './transaction_journal.ts'
import { next_profession_action } from './profession_plan.ts'
import { step_observation } from './action_receipts.ts'
import { next_combat_action } from './combat_plan.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'

/** Refresh only accepted drafts that have never crossed durable preparation. The run's
 * immutable plan or profile is the accepted intent; signed bytes are never replanned here. */
export const refresh_run_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  const [key] = run_keys(command)
  if (!key) return command
  const result = await store.transaction(
    [key, command.lane_key, `command:${command.id}`, `grant:${command.grant_id}`, `bot:${command.bot_id}`],
    async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
      const current = await tx.get<Command>(`command:${command.id}`)
      if (!current) throw new Error('execution_not_authorized')
      const grant = await tx.get<Grant>(`grant:${command.grant_id}`)
      if (!grant) throw new Error('invalid_token')
      assert_live_grant(config, grant, await tx.get<Bot>(`bot:${command.bot_id}`), now)
      const valid = [
        current.status === 'accepted',
        current.fingerprint === command.fingerprint,
        !lane.pending,
        !lane.paused,
        !lane.transport_stopped,
        !lane.needs_resync,
        !lane.reconciliation_command,
        lane.active_command === command.id,
        lane.decision_revision === command.decision_revision,
        lane.observation_revision === context.snapshot.observation_revision,
        same_run(command, lane),
        grant.scopes.includes('bot:play'),
      ].every(Boolean)
      if (!valid) throw new Error('execution_not_authorized')
      await assert_run_admission(tx, current!, lane, now)
      if (!gameplay_observation_ready(context)) return null
      if (command.run_ref?.kind === 'behavior') {
        const run = await tx.get<BehaviorRun>(key)
        return retain_behavior_draft(tx, run!, current!, lane, {
          ...context,
          command: { ...current!, observation_revision: lane.observation_revision },
        })
      }
      if (command.profession_run_id) {
        const run = await tx.get<ProfessionRun>(key)
        const fresh = { ...context, command: { ...command, observation_revision: lane.observation_revision } }
        const next = next_profession_action(run!.plan, fresh)
        return retain_profession_draft(tx, run!, current!, lane, next, fresh)
      }
      const run = await tx.get<CombatRun>(key)
      const next = next_combat_action(run!, {
        ...context,
        command: { ...command, observation_revision: lane.observation_revision },
      })
      return retain_draft(tx, run!, current!, lane, next)
    }
  )
  if (result instanceof Error) throw result
  return result
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
export const stale_run_draft = (command: Command, lane: Lane, error: unknown): boolean =>
  [
    run_ref_of(command),
    command.status === 'accepted',
    !lane.pending,
    !lane.paused,
    !lane.transport_stopped,
    same_run(command, lane),
    lane.active_command === command.id,
    lane.decision_revision === command.decision_revision,
    lane.observation_revision !== command.observation_revision,
    error instanceof Error && ['needs_resync', 'execution_not_authorized'].includes(error.message),
  ].every(Boolean)

const retain_profession_draft = async (
  tx: ControlTransaction,
  run: ProfessionRun,
  current: Command,
  lane: Lane,
  next: ReturnType<typeof next_profession_action>,
  context: GameplayContext
): Promise<Command | null> => {
  if (next.state === 'waiting') return null
  if (!next.action) {
    await tx.put(`profession:${run.id}`, {
      ...run,
      status: next.state,
      issue: next.issue,
      progress: next.progress,
      last_command_id: null,
      last_observation: undefined,
    })
    await tx.put(`command:${current.id}`, {
      ...current,
      status: 'cancelled',
      error: next.issue?.code ?? 'target_reached',
    })
    await tx.put(current.lane_key, {
      ...lane,
      active_command: null,
      profession_run_id: null,
      decision_revision: lane.decision_revision + 1,
    })
    return null
  }
  const refreshed: Command = {
    ...current,
    ...next.action,
    observation_revision: lane.observation_revision,
    action_baseline: undefined,
  }
  await tx.put(`command:${current.id}`, refreshed)
  await tx.put(`profession:${run.id}`, {
    ...run,
    last_observation: step_observation(next.action, context),
    progress: next.progress,
    issue: undefined,
  })
  return refreshed
}
