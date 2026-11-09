// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  job_max_level,
  job_level_from_xp,
  is_job_slug,
  craft_required_level,
  craft_xp_at_level,
  gatherable_of,
} from '@aresrpg/immutable'
import { live_resource_packs } from '@aresrpg/protocol'

import { object_schema, identifier, nonempty, matches } from './gameplay_schema.ts'
import { profession_recipe, recipe_job, acquisition_sources } from './profession_catalog.ts'
import { profession_inventory } from './actor_inventory.ts'
import { hash_secret } from './security.ts'
import { validate_profession_action } from './profession_actions.ts'
import type { GameplayContext } from './gameplay_context.ts'

export const PROFESSION_PLAN_SCHEMA = object_schema({
  character_id: identifier,
  job: nonempty,
  target_level: { type: 'integer', minimum: 1, maximum: job_max_level },
  recipe_output: nonempty,
  gather_item_types: { type: 'array', items: nonempty },
  max_actions: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  deadline_ms: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
})
export type ProfessionPlan = Readonly<{
  character_id: string
  job: string
  target_level: number
  recipe_output: string
  gather_item_types: readonly string[]
  max_actions: number
  deadline_ms: number
}>
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
export const profession_plan_errors = (value: unknown, now: number): readonly PlanIssue[] => {
  const shape_errors = profession_shape_errors(value)
  if (shape_errors.length) return shape_errors
  const plan = value as ProfessionPlan
  const recipe = profession_recipe(plan.recipe_output)
  return [
    !is_job_slug(plan.job)
      ? plan_issue(
          'unknown_job',
          'job',
          'Unknown profession.',
          'Use a job from bot_observe planning_context.professions.'
        )
      : null,
    !recipe
      ? plan_issue(
          'unknown_recipe',
          'recipe_output',
          'Unknown authored recipe.',
          'Select an output from the profession catalog.'
        )
      : null,
    recipe && recipe_job(plan.recipe_output) !== plan.job
      ? plan_issue(
          'recipe_job_mismatch',
          'recipe_output',
          'This recipe grants XP to another profession.',
          'Choose a recipe whose effective job matches the goal.'
        )
      : null,
    plan.deadline_ms <= now
      ? plan_issue(
          'deadline_expired',
          'deadline_ms',
          'The deadline has passed.',
          'Provide a future absolute UTC epoch timestamp in milliseconds.'
        )
      : null,
    plan.gather_item_types.some((item_type) => !gatherable_of(item_type) || !recipe?.inputs[item_type])
      ? plan_issue(
          'invalid_gather_target',
          'gather_item_types',
          'An allowed gather target is not a direct recipe ingredient with a gathering source.',
          'Only approve gathering identities required by this recipe.'
        )
      : null,
  ].filter((issue): issue is PlanIssue => issue !== null)
}
export type ProfessionNext = Readonly<{
  state: 'action' | 'completed' | 'waiting' | 'awaiting_ai'
  progress: Readonly<{
    xp: number
    level: number
    target_level: number
    missing: readonly Readonly<{ item_type: string; quantity: number }>[]
  }>
  action?: Readonly<{ kind: 'gather' | 'craft'; payload: Readonly<Record<string, unknown>> }>
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
const gather_action = (plan: ProfessionPlan, item_type: string, context: GameplayContext) => {
  const character = context.snapshot.characters.find(({ id }) => id === plan.character_id)!
  const window = context.snapshot.tracked_zones[character.id]
  return Object.values(context.snapshot.zones)
    .flatMap((row) => {
      if (
        !row.spawns ||
        row.zone.world !== character.world ||
        window?.world !== character.world ||
        !window.zones.some(({ zx, zz }) => zx === row.zone.zx && zz === row.zone.zz)
      )
        return []
      return live_resource_packs(row.spawns.resources, row.zone)
        .filter((pack) => pack.item_type === item_type)
        .map((pack) => ({
          distance: Math.hypot(pack.x - character.x!, pack.z - character.z!),
          kind: 'gather' as const,
          payload: {
            character_id: character.id,
            world: row.zone.world,
            zone_x: row.zone.zx,
            zone_z: row.zone.zz,
            pack_index: pack.index,
            item_type,
            zone_checkpoint_id: hash_secret(JSON.stringify(row)),
          },
        }))
    })
    .toSorted((a, b) => a.distance - b.distance)[0]
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
  return gather ? gather_action(plan, gather.item_type, context) : undefined
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
export const validate_profession_plan = (value: unknown, now: number, context?: GameplayContext) => {
  const errors = profession_plan_errors(value, now)
  const plan = errors.length === 0 ? (value as ProfessionPlan) : null
  const next = plan && context ? next_profession_action(plan, context) : null
  return {
    valid: errors.length === 0,
    static: { status: errors.length ? 'invalid' : 'valid', errors },
    live: { status: context ? 'observed' : 'not_checked', next, executable_now: next?.state === 'action' },
    simulation: {
      status: 'not_run',
      reason:
        'Validation performs no SDK preparation, signing or transaction. Execution still uses SDK simulation and final live checks.',
    },
    limits: plan
      ? {
          max_actions: plan.max_actions,
          deadline_ms: plan.deadline_ms,
          crafting_attempts_per_action: 1,
          purchases: false,
          automatic_combat: false,
          automatic_recipe_recursion: false,
        }
      : null,
  }
}

const profession_shape_errors = (value: unknown): readonly PlanIssue[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [
      plan_issue(
        'invalid_plan',
        'plan',
        'The plan must be a JSON object.',
        'Use the published profession plan schema, not executable code.'
      ),
    ]
  const record = value as Record<string, unknown>
  const properties = PROFESSION_PLAN_SCHEMA.properties!
  return [
    ...Object.entries(properties).flatMap(([key, schema]) =>
      matches(schema, record[key])
        ? []
        : [
            plan_issue(
              Object.hasOwn(record, key) ? 'invalid_field' : 'missing_field',
              key,
              'A required plan field is missing or has an invalid value.',
              'Use the exact type and bounds in the published schema.',
              schema
            ),
          ]
    ),
    ...Object.keys(record)
      .filter((key) => !Object.hasOwn(properties, key))
      .map((key) =>
        plan_issue(
          'unknown_field',
          key,
          'This field is not part of the bounded plan.',
          'Remove it. No arbitrary script, network request or signing operation is accepted.'
        )
      ),
  ]
}
