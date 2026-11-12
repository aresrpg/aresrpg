// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ControlTransaction } from './store.ts'
import type { Command, Lane } from './control.ts'
import type { GameplayContext } from './gameplay_context.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { next_behavior_action } from './behavior_plan.ts'
import { cleared_run } from './run_ref.ts'

/** Accepted, unprepared drafts may refresh targets within the same tree leaf. A changed branch
 * retires that draft; it can never inherit its command ID or be counted as successful execution. */
export const retain_behavior_draft = async (
  tx: ControlTransaction,
  run: BehaviorRun,
  current: Command,
  lane: Lane,
  context: GameplayContext
): Promise<Command | null | Error> => {
  const next = next_behavior_action(run, null, context)
  const { node } = current.behavior_binding!
  if ([next.state === 'waiting', next.record.activation?.node === node].every(Boolean)) return null
  if ([next.state === 'action', next.node === node].every(Boolean)) {
    const refreshed: Command = {
      ...current,
      ...next.action!,
      observation_revision: lane.observation_revision,
      action_baseline: undefined,
      fight_baseline: undefined,
    }
    await tx.put(`command:${current.id}`, refreshed)
    await tx.put(`behavior:${run.id}`, next.record)
    return refreshed
  }
  const status = next.state === 'action' ? 'active' : next.state
  await tx.put(`behavior:${run.id}`, {
    ...next.record,
    status,
    last_command_id: null,
    pending_node: null,
    activation: null,
    issue: next.issue,
  })
  await tx.put(`command:${current.id}`, {
    ...current,
    status: 'cancelled',
    error: 'behavior_changed_before_preparation',
  })
  await tx.put(current.lane_key, {
    ...lane,
    active_command: null,
    ...(!['active', 'waiting', 'awaiting_ai'].includes(status) ? cleared_run : {}),
    decision_revision: lane.decision_revision + 1,
  })
  return next.diagnostic ?? null
}
