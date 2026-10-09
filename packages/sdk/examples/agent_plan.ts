// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Offline examples: no signer, network request, or transaction.

import {
  craft_batch_limit,
  craft_job_of,
  craft_required_level,
  craft_success_percent,
  craft_xp_at_level,
  gatherable_of,
  world_size,
} from '@aresrpg/immutable'
import { character_checkpoint, travel_proof_ready, type CharacterRow } from '@aresrpg/protocol'

import items from '../../../seed/content/items.json'
import recipes from '../../../seed/content/recipes.json'
import mobs from '../../../seed/content/mobs.json'
import worlds from '../../../seed/content/worlds.json'

type Recipe = Readonly<{ output_type: string; inputs: Readonly<Record<string, number | undefined>>; job?: string }>
type Checkpoint = Readonly<
  Pick<
    CharacterRow,
    'world' | 'checkpoint_world' | 'x' | 'z' | 'at_ms' | 'pet' | 'equipment' | 'ambush' | 'dungeon_run'
  >
>

const integer_in_range = (value: number, minimum: number, maximum: number): boolean =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum

/** Invert the existing integer travel predicate, including its rounding and both-end pet rule. */
export const earliest_travel_ms = (
  character: Checkpoint,
  target: Readonly<{ x: number; z: number }>
): number | null => {
  const { x, z, at_ms } = character
  const coordinates = [x, z, target.x, target.z]
  if (
    character_checkpoint(character) === null ||
    [character.ambush, character.dungeon_run].some(Boolean) ||
    !coordinates.every((value) => integer_in_range(value!, 0, world_size - 1)) ||
    !integer_in_range(at_ms!, 0, Number.MAX_SAFE_INTEGER)
  )
    return null
  const ready = (now_ms: number) =>
    travel_proof_ready({
      from_x: x!,
      from_z: z!,
      from_ms: at_ms!,
      pet_at_start: character.pet === true,
      to_x: target.x,
      to_z: target.z,
      now_ms,
      pet_now: character.equipment.some(({ slot }) => slot === 'pet'),
    })
  let low = at_ms!
  let high = Number.MAX_SAFE_INTEGER
  if (!ready(high)) return null
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (ready(middle)) high = middle
    else low = middle + 1
  }
  return low
}

const sources_of = (item_type: string) => ({
  craftable: recipes.some((row) => row.output_type === item_type),
  gathering: worlds.flatMap((world) =>
    world.resources
      .filter((row) => row.item_type === item_type || gatherable_of(row.item_type)?.rare_item_type === item_type)
      .map((row) => ({ world: world.world, entry_level: world.entry_level, ...gatherable_of(row.item_type), ...row }))
  ),
  drops: mobs.flatMap((mob) =>
    mob.loot
      .filter((drop) => drop.item_type === item_type)
      .map((drop) => ({ mob: mob.mob_type, role: mob.role, ...drop }))
  ),
})

export const recipe_plan = (output_type: string, job_level: number, attempts = 1) => {
  if (!integer_in_range(job_level, 1, 100)) throw new Error('Job level must be 1–100')
  const recipe: Recipe | undefined = recipes.find((row) => row.output_type === output_type)
  const item = items.find((row) => row.item_type === output_type)
  if (!recipe || !item) throw new Error(`No authored recipe and item for ${output_type}`)
  const maximum = craft_batch_limit(item.category)
  if (!integer_in_range(attempts, 1, maximum))
    throw new Error(`This recipe allows 1–${maximum} attempts per transaction`)
  const ingredients = Object.entries(recipe.inputs).map(([item_type, quantity]) => ({
    item_type,
    quantity: quantity! * attempts,
    sources: sources_of(item_type),
  }))
  const required_level = craft_required_level(ingredients.length)
  return {
    output_type,
    job: craft_job_of(item.category) ?? recipe.job,
    required_level,
    eligible: job_level >= required_level,
    attempts,
    initial_success_percent_display: craft_success_percent(job_level),
    initial_xp_per_attempt: craft_xp_at_level(ingredients.length, job_level),
    ingredients,
    note: 'Authored sources only; inspect live availability, custody, prices, and batch level changes before spending.',
  }
}

if (import.meta.main) {
  const [output_type = 'recall_potion', level = '1', attempts = '1'] = Bun.argv.slice(2)
  console.log(JSON.stringify(recipe_plan(output_type, Number(level), Number(attempts)), null, 2))
}
