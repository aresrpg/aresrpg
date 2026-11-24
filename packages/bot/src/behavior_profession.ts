// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  acquisition_estimator,
  acquisition_average_seconds,
  best_recipe_for_job_progression,
  compare_recipe_progress,
  gatherable_catalog,
  gather_xp,
  gather_time_ms,
  tier_unlock_level,
  job_level_from_xp,
  job_slugs,
  type AcquisitionContent,
  type RecipeProgressionInput,
} from '@aresrpg/immutable'
import { craft_stack_plan } from '@aresrpg/protocol/inventory'

import items from '../../../seed/content/items.json'
import recipes from '../../../seed/content/recipes.json'
import mobs from '../../../seed/content/mobs.json'
import worlds from '../../../seed/content/worlds.json'
import dungeons from '../../../seed/content/dungeons.json'
import spells from '../../../seed/content/spells.json'

import { profession_inventory } from './actor_inventory.ts'
import { recipe_job, profession_recipes } from './catalog.ts'
import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { nearest_gather, type SelectedAction } from './behavior_targets.ts'
import { identifier, nonempty, object_schema, type Schema } from './gameplay_schema.ts'
import type { WorldSelection } from './behavior_world.ts'

export type ProfessionSelection = Readonly<{
  type: 'profession'
  character_id: string
  world: string
  order: 'best_progress'
  /** The jobs to pick work from; every job when absent. */
  jobs?: readonly string[]
}>
const profession_properties = {
  type: { const: 'profession' },
  character_id: identifier,
  world: nonempty,
  order: { const: 'best_progress' },
} as const
export const PROFESSION_SELECTION_SCHEMA: Schema = {
  ...object_schema({
    ...profession_properties,
    jobs: { type: 'array', minItems: 1, uniqueItems: true, items: { oneOf: job_slugs.map((job) => ({ const: job })) } },
  }),
  required: Object.keys(profession_properties),
}
const acquisition = acquisition_estimator({
  items,
  recipes,
  mobs,
  worlds,
  dungeons,
  spells,
} as unknown as AcquisitionContent)
const progression_recipes = profession_recipes.map((recipe) => ({ ...recipe, job: recipe_job(recipe.output_type)! }))
const input_seconds = (item_type: string) => {
  const estimate = acquisition(item_type).best
  return estimate ? acquisition_average_seconds(estimate) : null
}
type Inventory = ReturnType<typeof profession_inventory>
type Character = ReturnType<typeof owned_character>
const feasible_craft = (character: Character, inventory: Inventory, jobs: readonly string[]) => {
  const feasible = (recipe: RecipeProgressionInput) =>
    craft_stack_plan(recipe.inputs, 1, inventory, new Set(), character.kiosk) !== null
  const [choice] = job_slugs
    .filter((job) => jobs.includes(job))
    .flatMap((job) => {
      const best = best_recipe_for_job_progression(
        progression_recipes,
        job,
        job_level_from_xp(Number(character.jobs[job] ?? 0)),
        input_seconds,
        feasible
      )
      return best ? [best] : []
    })
    .toSorted(compare_recipe_progress)
  return choice
    ? { kind: 'craft' as const, payload: { character_id: character.id, output_type: choice.output_type, attempts: 1 } }
    : undefined
}
const available_tools = (character: Character, inventory: Inventory) =>
  [
    ...character.equipment.filter(({ slot }) => slot === 'tool').map((tool) => ({ ...tool, equipped: true })),
    ...inventory
      .filter((item) => item.category.startsWith('tool_') && item.level <= character.level)
      .map((tool) => ({ ...tool, equipped: false })),
  ].toSorted((a, b) => Number(b.equipped) - Number(a.equipped) || a.id.localeCompare(b.id))
const choose_resource = (
  character: Character,
  inventory: Inventory,
  context: GameplayContext,
  jobs: readonly string[]
): SelectedAction | undefined => {
  const tools = available_tools(character, inventory)
  if (!tools.length) throw new Error('tool_unavailable')
  const candidates = gatherable_catalog
    .filter((resource) => jobs.includes(resource.job))
    .flatMap((resource) => {
      const level = job_level_from_xp(Number(character.jobs[resource.job] ?? 0))
      const tool = tools.find(({ category }) => category === `tool_${resource.job.toLowerCase()}`)
      if (!tool || level < tier_unlock_level(resource.tier)) return []
      const action = nearest_gather(character.id, resource.item_type, context)
      return action
        ? [
            {
              action,
              tool,
              item_type: resource.item_type,
              score: gather_xp(tier_unlock_level(resource.tier)) / gather_time_ms(level),
            },
          ]
        : []
    })
    .toSorted((a, b) => b.score - a.score || a.item_type.localeCompare(b.item_type))
  const [selected] = candidates
  if (!selected) return undefined
  return selected.tool.equipped
    ? selected.action
    : {
        kind: 'equip_item',
        payload: { character_id: character.id, item_id: selected.tool.id, slot: 'tool' },
      }
}
/** One ordinary action, reconsidered after the executor's existing receipt barrier. No private run state. */
export const select_profession = (action: ProfessionSelection, context: GameplayContext): WorldSelection => {
  const character = owned_character(context, action.character_id)
  if (character.world !== action.world) throw new Error('target_outside_area')
  const inventory = profession_inventory(context.snapshot.inventory, character.kiosk)
  if (inventory.some((item) => !item.version)) throw new Error('inventory_unavailable')
  const jobs = action.jobs ?? job_slugs
  const selected = feasible_craft(character, inventory, jobs) ?? choose_resource(character, inventory, context, jobs)
  return selected ? { status: 'action', action: selected } : { status: 'failure', code: 'resource_unavailable' }
}
