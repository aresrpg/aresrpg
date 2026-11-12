// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { planning_blocker } from './planning_failure.ts'
import type { Command } from './control.ts'
import type { CombatRun } from './combat_control.ts'
import type { ProfessionRun } from './profession_control.ts'
import type { BehaviorRun } from './behavior_script.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { next_behavior_action } from './behavior_plan.ts'
import { next_combat_action } from './combat_plan.ts'
import { next_profession_action, profession_bounds, type PlanIssue } from './profession_plan.ts'
import { step_observation } from './action_receipts.ts'
import type { SelectedAction } from './behavior_targets.ts'

export type Run = CombatRun | ProfessionRun | BehaviorRun
export type RunDecision = Readonly<{
  state: 'action' | 'waiting' | 'awaiting_ai' | 'completed'
  action?: SelectedAction
  issue?: string | PlanIssue
  record: Run
  diagnostic?: Error
}>
export const run_bounds = (run: Run) =>
  'plan' in run ? profession_bounds(run.plan) : { max_actions: Infinity, deadline_ms: Infinity }
export const run_revision = (run: Run) => ('script' in run ? run.revision : 0)
export const run_decision = (run: Run, previous: Command | null, context: GameplayContext): RunDecision => {
  if ('script' in run) return next_behavior_action(run, previous, context)
  if ('plan' in run) {
    const next = next_profession_action(run.plan, context)
    return {
      ...next,
      record: {
        ...run,
        progress: next.progress,
        ...(next.action ? { last_observation: step_observation(next.action, context) } : {}),
      },
    }
  }
  try {
    const next = next_combat_action(run, context)
    return [next.state === 'completed', previous?.kind !== 'fight_settle'].every(Boolean)
      ? { state: 'awaiting_ai', issue: 'custody_changed', record: run }
      : { ...next, record: run }
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- The run yields an explicit durable issue; no command is admitted.
  } catch (error) {
    return planning_blocker(error, 'combat', run)
  }
}
export const behavior_binding = (run: Run) =>
  'script' in run ? { behavior_binding: { revision: run.revision, node: run.pending_node! } } : {}
