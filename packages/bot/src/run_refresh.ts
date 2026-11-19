// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_hosted, run_key, run_keys } from './run_ref.ts'
import { assert_run_admission } from './behavior_control.ts'
import { retain_behavior_draft } from './behavior_refresh.ts'
import type { BehaviorRun } from './behavior_script.ts'
import type { Command, Lane } from './control.ts'
import { assert_lease } from './control.ts'
import { assert_live_grant, type Bot, type Grant, type BotConfig } from './model.ts'
import type { ControlStore } from './store.ts'
import type { JournalBinding } from './transaction_lifecycle.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'

/** Refresh only accepted drafts that have never crossed preparation; signed bytes are never replanned
 * here. A run's draft is chosen again from its immutable tree. A direct command keeps its typed
 * payload and only binds to the observation it is about to be validated against. */
export const refresh_run_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  const result = await store.transaction(
    [
      ...run_keys(command),
      command.lane_key,
      `command:${command.id}`,
      `grant:${command.grant_id}`,
      `bot:${command.bot_id}`,
    ],
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
        grant.scopes.includes('bot:play'),
      ].every(Boolean)
      if (!valid) throw new Error('execution_not_authorized')
      await assert_run_admission(tx, current, lane)
      if (!gameplay_observation_ready(context)) return null
      const fresh: Command = { ...current, observation_revision: lane.observation_revision }
      if (current.run_id)
        return retain_behavior_draft(tx, (await tx.get<BehaviorRun>(run_key(current.run_id)))!, current, lane, {
          ...context,
          command: fresh,
        })
      await tx.put(`command:${current.id}`, fresh)
      return fresh
    }
  )
  if (result instanceof Error) throw result
  return result
}

/** A stale prepare refusal is still an accepted intent, not a failed or uncertain transaction:
 * a run's draft and a direct command alike keep the slot and bind to the next observation. */
export const stale_run_draft = (command: Command, lane: Lane, error: unknown): boolean =>
  [
    command.status === 'accepted',
    !lane.pending,
    !lane.paused,
    !lane.transport_stopped,
    run_hosted(command, lane),
    lane.active_command === command.id,
    lane.decision_revision === command.decision_revision,
    lane.observation_revision !== command.observation_revision,
    error instanceof Error && ['needs_resync', 'execution_not_authorized'].includes(error.message),
  ].every(Boolean)
