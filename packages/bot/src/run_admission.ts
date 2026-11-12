// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command, Lane } from './control.ts'
import type { ControlTransaction } from './store.ts'
import { run_ref_of, run_key, same_run } from './run_ref.ts'
import { assert_combat_admission } from './combat_admission.ts'
import type { CombatRun } from './combat_control.ts'
import { assert_behavior_admission } from './behavior_control.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { profession_bounds } from './profession_plan.ts'
import type { ProfessionRun } from './profession_control.ts'

export const assert_run_admission = async (tx: ControlTransaction, command: Command, lane: Lane, now: number) => {
  const ref = run_ref_of(command)
  if (!ref) return
  if (!same_run(command, lane)) throw new Error('execution_not_authorized')
  const key = run_key(ref)
  switch (ref.kind) {
    case 'profession':
      return assert_profession_admission(await tx.get<ProfessionRun>(key), command, lane, now)
    case 'combat':
      return assert_combat_admission(await tx.get<CombatRun>(key), command, lane)
    case 'behavior':
      return assert_behavior_admission(await tx.get<BehaviorRun>(key), command, lane)
  }
}

export const assert_profession_admission = (run: ProfessionRun | null, command: Command, lane: Lane, now: number) => {
  if (!run) throw new Error('profession_execution_not_authorized')
  const valid = [
    run.grant_id === command.grant_id,
    run.bot_id === command.bot_id,
    run.last_command_id === command.id,
    lane.profession_run_id === run.id,
    ['active', 'waiting'].includes(run.status),
    profession_bounds(run.plan).deadline_ms > now,
    run.actions_started <= profession_bounds(run.plan).max_actions,
  ]
  if (!valid.every(Boolean)) throw new Error('profession_execution_not_authorized')
}
