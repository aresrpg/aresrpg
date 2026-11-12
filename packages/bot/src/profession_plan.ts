// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { job_level_from_xp, craft_required_level, craft_xp_at_level } from '@aresrpg/immutable'
import type { HostedObjective } from '@aresrpg/protocol'

import { profession_recipe, acquisition_sources } from './profession_catalog.ts'
import { profession_inventory } from './actor_inventory.ts'
import { nearest_gather } from './behavior_targets.ts'
import { validate_profession_action } from './profession_actions.ts'
import type { GameplayContext } from './gameplay_context.ts'

export type ProfessionPlan = Readonly<{
  objective?: HostedObjective
  character_id: string
  job: string
  target_level: number
  recipe_output: string
  gather_item_types: readonly string[]
  max_actions?: number
  deadline_ms?: number
}>
/** Missing caller bounds impose no service-selected action or wall-clock cutoff. */
export const profession_bounds = (plan: ProfessionPlan) => ({
  max_actions: plan.max_actions ?? Infinity,
  deadline_ms: plan.deadline_ms ?? Infinity,
})
export type PlanIssue = Readonly<{
  code: string
  path: string
  message: string
  remedy: string
  requirements?: unknown
}>
export const plan_issue = (
  code: string,
  path: string,
  message: string,
  remedy: string,
  requirements?: unknown
): PlanIssue => ({ code, path, message, remedy, ...(requirements === undefined ? {} : { requirements }) })
export type ProfessionNext = Readonly<{
  state: 'action' | 'completed' | 'waiting' | 'awaiting_ai'
  progress: Readonly<{
    xp: number
    level: number
    target_level: number
    missing: readonly Readonly<{ item_type: string; quantity: number }>[]
  }>
  action?: Readonly<{ kind: import('./gameplay.ts').GameplayActionName; payload: Readonly<Record<string, unknown>> }>
  issue?: PlanIssue
}>
const missing_inputs = (plan: ProfessionPlan, context: GameplayContext) => {
  const character = context.snapshot.characters.find(({ id }) => id === plan.character_id)!
  const inventory = profession_inventory(context.snapshot.inventory, character.kiosk)
  return Object.entries(profession_recipe(plan.recipe_output)!.inputs).flatMap(([item_type, quantity]) => {
    const held = inventory.filter((item) => item.item_type === item_type).reduce((total, row) => total + row.amount, 0)
    return held < quantity ? [{ item_type, quantity: quantity - held }] : []
  })
}
const candidate_action = (
  plan: ProfessionPlan,
  missing: ProfessionNext['progress']['missing'],
  context: GameplayContext
) => {
  if (missing.length === 0)
    return {
      kind: 'craft' as const,
      payload: { character_id: plan.character_id, output_type: plan.recipe_output, attempts: 1 },
    }
  const gather = missing.find(({ item_type }) => plan.gather_item_types.includes(item_type))
  return gather ? nearest_gather(plan.character_id, gather.item_type, context) : undefined
}
export const next_profession_action = (plan: ProfessionPlan, context: GameplayContext): ProfessionNext => {
  const character = context.snapshot.characters.find(({ id }) => id === plan.character_id)
  const xp = Number(character?.jobs[plan.job] ?? 0)
  const progress = {
    xp,
    level: job_level_from_xp(xp),
    target_level: plan.target_level,
    missing: [] as ProfessionNext['progress']['missing'],
  }
  const blocked = (issue: PlanIssue): ProfessionNext => ({ state: 'awaiting_ai', progress, issue })
  if (!character)
    return blocked(
      plan_issue(
        'character_authority_mismatch',
        'character_id',
        'The character is not in this bot roster.',
        'Observe again and select an owned character.'
      )
    )
  if ([character.ambush, character.active_fight].some(Boolean))
    return blocked(
      plan_issue(
        'combat_required',
        'character_id',
        'The character needs protector or fight handling.',
        'Use the existing resolve_ambush/fight tools, then explicitly resume this run.',
        { ambush: character.ambush, fight: character.active_fight }
      )
    )
  if (progress.level >= plan.target_level) return { state: 'completed', progress }
  const slots = Object.keys(profession_recipe(plan.recipe_output)!.inputs).length
  if ([progress.level < craft_required_level(slots), craft_xp_at_level(slots, progress.level) === 0].some(Boolean))
    return blocked(
      plan_issue(
        'recipe_level_required',
        'recipe_output',
        'The recipe is locked or no longer grants XP.',
        'Choose an accessible XP-bearing recipe in a new plan.'
      )
    )
  try {
    const missing = missing_inputs(plan, context)
    const current = { ...progress, missing }
    const action = candidate_action(plan, missing, context)
    if (!action)
      return {
        state: 'awaiting_ai',
        progress: current,
        issue: plan_issue(
          'acquisition_required',
          'recipe_output',
          'Required ingredients need discovery, looting or another recipe.',
          'Use the returned acquisition sources with world/fight tools; this run never buys items or invents loot.',
          missing.map((row) => ({ ...row, ...acquisition_sources(row.item_type) }))
        ),
      }
    validate_profession_action({
      ...context,
      command: { ...context.command, kind: action.kind, payload: action.payload },
    })
    return { state: 'action', progress: current, action }
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Errors are returned as explicit typed blockers with remedies, never success.
  } catch (error) {
    const code = error instanceof Error ? error.message : 'plan_unavailable'
    const waiting = ['needs_resync', 'travel_not_ready', 'inventory_unavailable'].includes(code)
    return {
      state: waiting ? 'waiting' : 'awaiting_ai',
      progress,
      issue: plan_issue(
        code,
        'live',
        'The next action is not currently admitted.',
        waiting
          ? 'Wait for a fresh server baseline, chain clock or travel/root release.'
          : 'Resolve the requirement and explicitly resume the run.'
      ),
    }
  }
}
