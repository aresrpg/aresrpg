// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a hero can gather or craft, by the game's own profession rules. Nothing here ranks, prices or
// estimates income: the only arithmetic is how many tries an amount takes.
import {
  craft_required_level,
  craft_success_percent,
  craft_xp_at_level,
  gather_quantity_bounds,
  gather_time_ms,
  gather_xp,
  gatherable_of,
  job_kind_of,
  job_slugs,
  tier_unlock_level,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import type { RaidBag } from '@aresrpg/protocol/strategies'

import { content_catalog } from '../content/catalog.ts'

import { job_level, strongest_first } from './account.ts'
import { held_in_kiosk, work_tool, type WorkPick } from './strategies.ts'

type Hero = Readonly<CharacterRow>

/** The profession a pick works in: the one it names, or the one of its resource or recipe. */
export const work_job = (work: WorkPick): string | null => {
  if (work.mode === 'auto') return work.job
  return work.mode === 'gather'
    ? (gatherable_of(work.item_type)?.job ?? null)
    : (content_catalog.item(work.item_type)?.recipe?.job ?? null)
}

/** The hero with the highest level in a job; equal levels go to the strongest hero. Null with no hero. */
export const best_worker = (heroes: readonly Hero[], job: string): Readonly<{ hero: Hero; level: number }> | null => {
  const [hero] = strongest_first(heroes).toSorted((left, right) => job_level(right, job) - job_level(left, job))
  return hero ? { hero, level: job_level(hero, job) } : null
}
/** Every profession with its kind and the best of the given heroes for it. */
export const job_options = (heroes: readonly Hero[]) =>
  job_slugs.map((job) => ({ job, gathers: job_kind_of(job) === 'gathering', worker: best_worker(heroes, job) }))

/** The resources of a world, each with the profession level its tier opens. */
export const resource_rows = (world: string) =>
  (content_catalog.world(world)?.resources ?? []).map((resource) => ({
    ...resource,
    required_level: tier_unlock_level(resource.tier),
  }))
/** The recipes of a profession, each with the level its ingredient count opens. */
export const recipe_rows = (job: string) =>
  (content_catalog.job(job)?.recipes ?? []).map(({ output_type, inputs }) => ({
    item_type: output_type,
    inputs,
    required_level: craft_required_level(Object.keys(inputs).length),
  }))

/** One harvest of a resource by this hero, by the chain's rules; null for an item that is not harvested. */
export const gather_facts = (hero: Hero, item_type: string) => {
  const resource = gatherable_of(item_type)
  if (!resource) return null
  const { job, rare_item_type, protector } = resource
  const [level, required_level] = [job_level(hero, job), tier_unlock_level(resource.tier)]
  const [min, max] = gather_quantity_bounds(level, required_level)
  return {
    job,
    level,
    required_level,
    unlocked: level >= required_level,
    quantity: { min, max },
    seconds: gather_time_ms(level) / 1_000,
    xp: gather_xp(required_level),
    rare_item_type,
    protector,
  }
}
/** One try of a recipe by this hero, by the chain's rules; null for an item with no recipe. */
export const craft_facts = (hero: Hero, item_type: string) => {
  const recipe = content_catalog.item(item_type)?.recipe
  if (!recipe) return null
  const { job, ingredients } = recipe
  const [level, required_level] = [job_level(hero, job), craft_required_level(ingredients.length)]
  return {
    job,
    level,
    required_level,
    unlocked: level >= required_level,
    percent: craft_success_percent(level),
    xp: craft_xp_at_level(ingredients.length, level),
    ingredients,
  }
}

type Tries = (hero: Hero, item_type: string, amount: number) => number | null
const TRIES: Readonly<Record<Exclude<WorkPick['mode'], 'auto'>, Tries>> = {
  // A harvest yields between its two bounds: the middle of them is the average.
  gather: (hero, item_type, amount) => {
    const facts = gather_facts(hero, item_type)
    return facts && Math.ceil((amount * 2) / (facts.quantity.min + facts.quantity.max))
  },
  // A successful try makes one item.
  craft: (hero, item_type, amount) => {
    const facts = craft_facts(hero, item_type)
    return facts && Math.ceil((amount * 100) / facts.percent)
  },
}
/** About how many harvests or tries an amount takes on average. Null without an amount to reach. */
export const work_tries = (hero: Hero, work: WorkPick): number | null =>
  work.mode !== 'auto' && work.goal.kind === 'amount' ? TRIES[work.mode](hero, work.item_type, work.goal.amount) : null

export type WorkNeeds = Readonly<{
  /** The tool the work needs: which one the hero would use and whether it wears it; `item_type` is
   * null when it has none. Null for work that needs no tool. */
  tool: Readonly<{ job: string; item_type: string | null; worn: boolean }> | null
  /** What the tries consume, against the hero's own kiosk: a hero crafts only from there. */
  materials: readonly Readonly<{ item_type: string; need: number; have: number; missing: number }>[]
}>
const NO_NEEDS: WorkNeeds = Object.freeze({ tool: null, materials: [] })
const tool_need = (bag: RaidBag, hero: Hero, item_type: string): WorkNeeds => {
  const job = gatherable_of(item_type)?.job
  if (!job) return NO_NEEDS
  return { tool: { job, item_type: null, worn: false, ...work_tool(bag, hero, job) }, materials: [] }
}
const material_needs = (bag: RaidBag, hero: Hero, item_type: string, tries: number): WorkNeeds => ({
  tool: null,
  materials: (content_catalog.item(item_type)?.recipe?.ingredients ?? []).map((ingredient) => {
    const [need, have] = [ingredient.quantity * tries, held_in_kiosk(bag, hero, ingredient.item_type)]
    return { item_type: ingredient.item_type, need, have, missing: Math.max(0, need - have) }
  }),
})
/**
 * What the chosen work needs from this hero's own kiosk. Harvesting needs the tool of its profession.
 * A recipe needs its ingredients: for the tries an amount takes on average, else for one try.
 */
export const work_needs = (bag: RaidBag, hero: Hero, work: WorkPick): WorkNeeds => {
  if (work.mode === 'auto') return NO_NEEDS
  return work.mode === 'gather'
    ? tool_need(bag, hero, work.item_type)
    : material_needs(bag, hero, work.item_type, work_tries(hero, work) ?? 1)
}
