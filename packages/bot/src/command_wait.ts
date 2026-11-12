// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_lease, type Command, type Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { assert_profession_admission, type JournalBinding } from './transaction_journal.ts'
import type { ProfessionRun } from './profession_control.ts'

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
  const keys = [
    command.lane_key,
    `command:${command.id}`,
    ...(command.profession_run_id ? [`profession:${command.profession_run_id}`] : []),
  ]
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
    if (command.profession_run_id)
      assert_profession_admission(
        await tx.get<ProfessionRun>(`profession:${command.profession_run_id}`),
        command,
        lane,
        now
      )
    if (!gameplay_observation_ready(context)) {
      if (!current!.waiting_for_resume) await tx.put(`command:${command.id}`, { ...current!, waiting_for_resume: true })
      return null
    }
    const next = { ...current!, waiting_for_resume: false, observation_revision: snapshot.observation_revision }
    await tx.put(`command:${command.id}`, next)
    return next
  })
}
