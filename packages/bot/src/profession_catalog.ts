// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  craft_job_of,
  craft_required_level,
  craft_xp_at_level,
  craft_success_percent,
  job_slugs,
  job_level_from_xp,
  job_xp_for_level,
  gatherable_of,
  tier_unlock_level,
  gather_xp,
  gather_quantity_bounds,
} from '@aresrpg/immutable'
import { live_resource_packs, live_mob_groups } from '@aresrpg/protocol'
import type { SeedRecipe } from '@aresrpg/sdk/seed'

import items from '../../../seed/content/items.json'
import recipes from '../../../seed/content/recipes.json'
import mobs from '../../../seed/content/mobs.json'

import type { ActorSnapshot } from './actor_snapshot.ts'
import { profession_inventory } from './actor_inventory.ts'

export const profession_recipes = recipes as unknown as readonly SeedRecipe[]
export const profession_item = (item_type: string) => items.find((item) => item.item_type === item_type)
export const profession_recipe = (output_type: string) =>
  profession_recipes.find((recipe) => recipe.output_type === output_type)
export const recipe_job = (output_type: string) => {
  const item = profession_item(output_type)
  return item ? craft_job_of(item.category, profession_recipe(output_type)?.job) : undefined
}
export const acquisition_sources = (item_type: string) => ({
  gather: gatherable_of(item_type),
  recipe: profession_recipe(item_type) ?? null,
  drops: mobs.flatMap((mob) =>
    mob.loot
      .filter((loot) => loot.item_type === item_type)
      .map((loot) => ({ mob_type: mob.mob_type, level_min: mob.level_min, level_max: mob.level_max, ...loot }))
  ),
})
export const profession_knowledge = (snapshot: ActorSnapshot, requested?: readonly string[]) => ({
  ...(requested?.length === 0 ? { recipe_outputs: profession_recipes.map(({ output_type }) => output_type) } : {}),
  source: 'seed/content plus immutable game rules; live Move validation remains authoritative',
  inventory_ready: Boolean(snapshot.inventory?.loaded && snapshot.inventory.listings && snapshot.inventory.trades),
  characters: snapshot.characters.map((character) => ({
    character_id: character.id,
    jobs: job_slugs.map((job) => {
      const xp = Number(character.jobs[job] ?? '0')
      const level = job_level_from_xp(xp)
      return { job, xp, level, next_level_xp: job_xp_for_level(level + 1) ?? null }
    }),
    available_inventory: (() => {
      try {
        return profession_inventory(snapshot.inventory, character.kiosk)
      } catch (error) {
        return { error: String(error) }
      }
    })(),
    equipped_tool: character.equipment.find(({ slot }) => slot === 'tool') ?? null,
  })),
  recipes: profession_recipes
    .filter(({ output_type }) => requested?.includes(output_type))
    .map((recipe) => ({
      ...recipe,
      job: recipe_job(recipe.output_type),
      required_level: craft_required_level(Object.keys(recipe.inputs).length),
      xp_at_level: job_slugs.includes(recipe_job(recipe.output_type)!)
        ? snapshot.characters.map((character) => {
            const level = job_level_from_xp(Number(character.jobs[recipe_job(recipe.output_type)!] ?? '0'))
            return {
              character_id: character.id,
              xp_per_attempt: craft_xp_at_level(Object.keys(recipe.inputs).length, level),
              success_percent: craft_success_percent(level),
            }
          })
        : [],
      ingredients: Object.keys(recipe.inputs).map((item_type) => ({ item_type, ...acquisition_sources(item_type) })),
    })),
  zones: Object.values(snapshot.zones).map(({ zone, spawns }) => ({
    world: zone.world,
    zone_x: zone.zx,
    zone_z: zone.zz,
    resources: spawns
      ? live_resource_packs(spawns.resources, zone).map((pack) => {
          const resource = gatherable_of(pack.item_type)
          const required_level = resource ? tier_unlock_level(resource.tier) : null
          return {
            ...pack,
            ...resource,
            required_level,
            xp_per_harvest: required_level ? gather_xp(required_level) : null,
            yield_bounds_at_unlock: required_level ? gather_quantity_bounds(required_level, required_level) : null,
          }
        })
      : null,
    mobs: spawns ? live_mob_groups(spawns.mobs, zone) : null,
  })),
})
