import { assert_run_admission } from './run_admission.ts'
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { refresh_run_command } from './run_refresh.ts'
import { assert_live_grant, type BotConfig, type Bot, type Grant } from './model.ts'
import { bind_action_baseline } from './action_reconciliation.ts'
import { validate_gameplay } from './gameplay.ts'
import { assert_lease, type Command, type Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import type { JournalBinding } from './transaction_journal.ts'
import { run_keys } from './run_ref.ts'

/** Retain an accepted intent, never an execution retry. The existing scheduler samples the
 * server-pushed freeze state; the ordinary gameplay and SDK gates revalidate on release. */
export const wait_for_contract = async (
  store: ControlStore,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  const { snapshot } = context
  if (!command.waiting_for_resume && snapshot.ready) return command
  const keys = [command.lane_key, `command:${command.id}`, ...run_keys(command)]
  return store.transaction(keys, async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
    const current = await tx.get<Command>(`command:${command.id}`)
    const valid = [
      current?.status === 'accepted',
      current?.fingerprint === command.fingerprint,
      lane.active_command === command.id,
      lane.decision_revision === command.decision_revision,
      !lane.paused,
      !lane.pending,
    ].every(Boolean)
    if (!valid) throw new Error('execution_not_authorized')
    await assert_run_admission(tx, command, lane, now)
    if (!gameplay_observation_ready(context)) {
      if (!current!.waiting_for_resume) await tx.put(`command:${command.id}`, { ...current!, waiting_for_resume: true })
      return null
    }
    const next = { ...current!, waiting_for_resume: false, observation_revision: snapshot.observation_revision }
    await tx.put(`command:${command.id}`, next)
    return next
  })
}

export const ready_gameplay_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
) => {
  const command = await wait_for_contract(store, binding, context, now)
  return command ? refresh_run_command(store, config, { ...binding, command }, context, now) : null
}

export const refresh_signed_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  digest: string,
  now: number
) => {
  const original = binding.command
  const { snapshot } = context
  const refreshed = bind_action_baseline({ ...original, observation_revision: snapshot.observation_revision }, context)
  validate_gameplay({ ...context, command: refreshed })
  const keys = [original.lane_key, `command:${original.id}`, `grant:${original.grant_id}`, `bot:${original.bot_id}`]
  return store.transaction(keys, async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(original.lane_key), binding.actor_id, binding.fence, now)
    const current = await tx.get<Command>(`command:${original.id}`)
    const grant = await tx.get<Grant>(`grant:${original.grant_id}`)
    if (!current || !grant) throw new Error('PENDING_COMMAND_MISSING')
    assert_live_grant(config, grant, await tx.get<Bot>(`bot:${original.bot_id}`), now)
    const unchanged = [
      lane.pending?.phase === 'signed',
      lane.pending?.digest === digest,
      lane.pending?.command_id === original.id,
      lane.pending?.grant_id === original.grant_id,
      lane.observation_revision === snapshot.observation_revision,
      lane.decision_revision === original.decision_revision,
      current.fingerprint === original.fingerprint,
      current.observation_revision === original.observation_revision,
      !lane.paused,
      !lane.needs_resync,
    ]
    if (!unchanged.every(Boolean)) throw new Error('SIGNED_RESUME_CONFLICT')
    const next = { ...current, ...refreshed }
    await tx.put(`command:${original.id}`, next)
    return next
  })
}
