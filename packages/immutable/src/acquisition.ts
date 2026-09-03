// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  craft_required_level,
  craft_slot_capacity,
  craft_xp_at_level,
  gather_quantity_bounds,
  gather_time_ms,
  job_max_level,
  tier_unlock_level,
} from './experience.ts'
import { gatherable_catalog } from './gathering.ts'
import { dofus_weapon_damage_envelope } from './item_power.ts'
import { item_stat_center, weapon_categories } from './item.ts'

export type AcquisitionRange = Readonly<{ minimum_seconds: number; maximum_seconds: number }>
export type AcquisitionIngredient = Readonly<{
  item_type: string
  quantity: number
  unit: AcquisitionRange | null
  total: AcquisitionRange | null
}>
export type AcquisitionRoute = Readonly<{
  kind: 'craft' | 'gather' | 'rare_gather' | 'mob'
  source: string
  range: AcquisitionRange
}>
export type AcquisitionEstimate = Readonly<{
  best: AcquisitionRange | null
  craft: AcquisitionRange | null
  routes: readonly AcquisitionRoute[]
  ingredients: readonly AcquisitionIngredient[]
  craft_success_percent: number | null
  cycle: boolean
}>
export type AcquisitionTargetStatus = 'below' | 'within' | 'above' | 'unavailable'
export type RecipeProgressionIssue = Readonly<{
  job: string
  level: number
  slot_capacity: number
  reachable_recipe_count: number
}>
export type RecipeProgressionInput = EconomyRecipe & Readonly<{ job: string }>
export type RecipeProgressRecommendation = Readonly<{
  output_type: string
  xp: number
  acquisition_seconds: number
  xp_per_second: number
}>

type EconomyItem = Readonly<{ item_type: string; category: string; level: number }>
type EconomyRecipe = Readonly<{ output_type: string; inputs: Readonly<Record<string, number>> }>
type EconomyDrop = Readonly<{ item_type: string; chance_bp: number; min_qty: number; max_qty: number }>
type EconomyMob = Readonly<{
  mob_type: string
  family: string
  role: string
  level_min: number
  level_max: number
  hp: number
  resistances: Readonly<Record<string, number>>
  loot: readonly EconomyDrop[]
}>
type EconomyWorld = Readonly<{
  cities?: readonly Readonly<{ dungeon: string }>[]
  mobs: readonly Readonly<{ mob_type: string }>[] | Readonly<Record<string, number>>
  resources: readonly Readonly<{ item_type: string }>[]
}>
type EconomyDungeon = Readonly<{
  dungeon: string
  rooms: readonly (readonly Readonly<{ mob_type: string }>[])[]
}>
type EconomySpellEffect = Readonly<{
  kind: number
  stat: number
  turns: number
  area_shape: number
  area_size: number
}>
type EconomySpell = Readonly<{
  classe: string
  unlock_level: number
  levels: readonly Readonly<{ effects: readonly EconomySpellEffect[] }>[]
}>
export type AcquisitionContent = Readonly<{
  items: readonly EconomyItem[]
  recipes: readonly EconomyRecipe[]
  mobs: readonly EconomyMob[]
  worlds: readonly EconomyWorld[]
  dungeons: readonly EconomyDungeon[]
  spells?: readonly EconomySpell[]
}>

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air'] as const)
const WEAPON_AP = Object.freeze({ daggers: 3, spear: 4, bow: 4, axe: 5, sword: 5 })
const PLAYER_AP = 6
const FARMED_MOBS_PER_FIGHT = 5
const FIGHT_FLOOR_SECONDS = 20
const EXTRA_ROUND_SECONDS = 15
const PROTECTOR_CHANCE = 0.02
const PROTECTOR_BAG_QUANTITY = 50
const RARE_GATHER_CHANCE = 0.001
export const archimob_appearance_bp = 100
// The estimator's established farming profile models five eligible targets per fight. Runtime
// groups vary and may mix families; only the on-chain per-member 1% rule is exact.
const ARCHIMOB_PROFILE_FAILED_FIGHTS = 10_000 / (archimob_appearance_bp * FARMED_MOBS_PER_FIGHT) - 1
const BOSS_PRELIMINARY_FIGHTS = 6
const role_round_floor = (role: string): number => (role === 'boss' ? 3 : role === 'archi' ? 2 : 1)

const range = (minimum_seconds: number, maximum_seconds: number): AcquisitionRange =>
  Object.freeze({
    minimum_seconds: Math.min(minimum_seconds, maximum_seconds),
    maximum_seconds: Math.max(minimum_seconds, maximum_seconds),
  })

const scaled = (base: number, low: number, high: number, level: number): number =>
  high === low ? base : Math.floor((base * (6 * (high - low) + 10 * (level - low))) / (10 * (high - low)))

const scaled_resistance = (encoded: number, low: number, high: number, level: number): number => {
  const deviation = encoded - item_stat_center
  if (deviation >= 0) return scaled(deviation, low, high, level)
  if (high === low) return deviation
  return -Math.floor((Math.abs(deviation) * (16 * (high - low) - 10 * (level - low))) / (10 * (high - low)))
}

const player_profile = (item_level: number): Readonly<{ level: number; elemental_stat: number }> =>
  item_level <= 100
    ? Object.freeze({ level: 50, elemental_stat: 400 })
    : Object.freeze({ level: 150, elemental_stat: 600 })

const player_turn_damage = (item_level: number): number => {
  const profile = player_profile(item_level)
  const damage_per_ap = weapon_categories.map(
    (category) => dofus_weapon_damage_envelope(profile.level, category, WEAPON_AP[category])?.average_median ?? 0
  )
  const average = damage_per_ap.reduce((sum, damage) => sum + damage, 0) / damage_per_ap.length
  return average * PLAYER_AP * (1 + profile.elemental_stat / 100)
}

const effect_area_coverage = ({ area_shape, area_size }: EconomySpellEffect): number => {
  if (area_shape === 0) return 1
  if (area_shape === 6) return FARMED_MOBS_PER_FIGHT
  const broad = [1, 5, 8, 9].includes(area_shape)
  return Math.min(FARMED_MOBS_PER_FIGHT, 1 + area_size * (broad ? 1 : 0.5))
}

const player_area_coverage = (content: AcquisitionContent, item_level: number): number => {
  const profile = player_profile(item_level)
  const classes = new Set((content.spells ?? []).map(({ classe }) => classe))
  if (classes.size === 0) return 1
  const coverage = [...classes].map((classe) =>
    Math.max(
      1,
      ...(content.spells ?? [])
        .filter((spell) => spell.classe === classe && spell.unlock_level <= profile.level)
        .flatMap(({ levels }) =>
          (levels.at(-1)?.effects ?? [])
            .filter(({ kind, stat, turns }) => kind === 0 || (kind === 6 && stat === 12 && turns === 0))
            .map(effect_area_coverage)
        )
    )
  )
  return coverage.reduce((sum, value) => sum + value, 0) / coverage.length
}

const fight_seconds_at = (mob: EconomyMob, item_level: number, level: number, content: AcquisitionContent): number => {
  const count = mob.role === 'normal' ? FARMED_MOBS_PER_FIGHT : 1
  const average_resistance =
    ELEMENTS.map((element) =>
      scaled_resistance(mob.resistances[element] ?? item_stat_center, mob.level_min, mob.level_max, level)
    ).reduce((sum, resistance) => sum + resistance, 0) / ELEMENTS.length
  const damage = Math.max(1, player_turn_damage(item_level) * (1 - average_resistance / 100))
  const coverage = count === 1 ? 1 : player_area_coverage(content, item_level)
  const pack_hp = scaled(mob.hp, mob.level_min, mob.level_max, level) * count
  const turns = Math.max(role_round_floor(mob.role), Math.ceil(pack_hp / (damage * coverage)))
  return FIGHT_FLOOR_SECONDS + (turns - 1) * EXTRA_ROUND_SECONDS
}

const family_fight_range = (mob: EconomyMob, item_level: number, content: AcquisitionContent): AcquisitionRange => {
  const family = content.mobs.filter(({ family, role }) => family === mob.family && role === 'normal')
  if (family.length === 0) return range(FIGHT_FLOOR_SECONDS, FIGHT_FLOOR_SECONDS)
  return range(
    family.reduce((sum, candidate) => sum + fight_seconds_at(candidate, item_level, candidate.level_min, content), 0) /
      family.length,
    family.reduce((sum, candidate) => sum + fight_seconds_at(candidate, item_level, candidate.level_max, content), 0) /
      family.length
  )
}

const encounter_overhead = (mob: EconomyMob, item_level: number, content: AcquisitionContent): AcquisitionRange => {
  const encounter_count =
    mob.role === 'archi' ? ARCHIMOB_PROFILE_FAILED_FIGHTS : mob.role === 'boss' ? BOSS_PRELIMINARY_FIGHTS : 0
  const family = family_fight_range(mob, item_level, content)
  return range(family.minimum_seconds * encounter_count, family.maximum_seconds * encounter_count)
}

const mob_drop_range = (
  mob: EconomyMob,
  drop: EconomyDrop,
  item_level: number,
  content: AcquisitionContent
): AcquisitionRange => {
  const count = mob.role === 'normal' ? FARMED_MOBS_PER_FIGHT : 1
  const quantity = (drop.min_qty + drop.max_qty) / 2
  const overhead = encounter_overhead(mob, item_level, content)
  const seconds_per_unit = (level: number, overhead_seconds: number): number => {
    const chance_scale =
      mob.level_min === mob.level_max
        ? 1
        : (8 * (mob.level_max - mob.level_min) + 4 * (level - mob.level_min)) / (10 * (mob.level_max - mob.level_min))
    const chance = Math.min(1, (drop.chance_bp * chance_scale) / 10_000)
    return (
      (overhead_seconds + fight_seconds_at(mob, item_level, level, content)) /
      Math.max(Number.EPSILON, count * chance * quantity)
    )
  }
  return range(
    seconds_per_unit(mob.level_min, overhead.minimum_seconds),
    seconds_per_unit(mob.level_max, overhead.maximum_seconds)
  )
}

const best_range = (routes: readonly AcquisitionRoute[]): AcquisitionRange | null =>
  routes.length === 0
    ? null
    : range(
        Math.min(...routes.map(({ range: row }) => row.minimum_seconds)),
        Math.min(...routes.map(({ range: row }) => row.maximum_seconds))
      )

const craft_probability = (level: number): number => Math.min(0.99, 0.5 + (Math.max(1, level) - 1) * 0.005)

const placed_mob_types = (content: AcquisitionContent): ReadonlySet<string> => {
  const dungeon_ids = new Set(content.worlds.flatMap(({ cities = [] }) => cities.map(({ dungeon }) => dungeon)))
  return new Set([
    ...content.worlds.flatMap(({ mobs }) =>
      Array.isArray(mobs) ? mobs.map(({ mob_type }) => mob_type) : Object.keys(mobs)
    ),
    ...content.dungeons
      .filter(({ dungeon }) => dungeon_ids.has(dungeon))
      .flatMap(({ rooms }) => rooms.flatMap((room) => room.map(({ mob_type }) => mob_type))),
  ])
}

const mob_is_available = (mob: EconomyMob, available: ReadonlySet<string>, content: AcquisitionContent): boolean =>
  available.has(mob.mob_type) ||
  (mob.role === 'archi' &&
    content.mobs.some(
      ({ mob_type, family, role }) => family === mob.family && role === 'normal' && available.has(mob_type)
    ))

const gather_routes = (
  item: EconomyItem,
  content: AcquisitionContent,
  mobs: ReadonlyMap<string, EconomyMob>,
  placed_resources: ReadonlySet<string>
): readonly AcquisitionRoute[] => {
  const gatherable = gatherable_catalog.find(
    ({ item_type, rare_item_type }) => item.item_type === item_type || item.item_type === rare_item_type
  )
  if (!gatherable || !placed_resources.has(gatherable.item_type)) return Object.freeze([])
  const required_level = tier_unlock_level(gatherable.tier)
  const [minimum_yield, maximum_yield] = gather_quantity_bounds(100, required_level)
  const base_seconds = gather_time_ms(100) / 1_000
  const protector = mobs.get(gatherable.protector)
  const protector_range = protector
    ? range(
        fight_seconds_at(protector, item.level, protector.level_min, content),
        fight_seconds_at(protector, item.level, protector.level_max, content)
      )
    : range(0, 0)
  const node_seconds = range(
    base_seconds + PROTECTOR_CHANCE * protector_range.minimum_seconds,
    base_seconds + PROTECTOR_CHANCE * protector_range.maximum_seconds
  )
  const rare = item.item_type === gatherable.rare_item_type
  const output = rare
    ? range(node_seconds.minimum_seconds / RARE_GATHER_CHANCE, node_seconds.maximum_seconds / RARE_GATHER_CHANCE)
    : range(
        node_seconds.minimum_seconds / (maximum_yield + PROTECTOR_CHANCE * PROTECTOR_BAG_QUANTITY),
        node_seconds.maximum_seconds / (minimum_yield + PROTECTOR_CHANCE * PROTECTOR_BAG_QUANTITY)
      )
  return Object.freeze([
    Object.freeze({ kind: rare ? 'rare_gather' : 'gather', source: gatherable.item_type, range: output }),
  ])
}

const ingredient_estimate = (
  item_type: string,
  quantity: number,
  unit: AcquisitionRange | null
): AcquisitionIngredient =>
  Object.freeze({
    item_type,
    quantity,
    unit,
    total: unit ? range(unit.minimum_seconds * quantity, unit.maximum_seconds * quantity) : null,
  })

const craft_range = (
  recipe: EconomyRecipe | undefined,
  level: number,
  ingredients: readonly AcquisitionIngredient[]
): AcquisitionRange | null => {
  if (!recipe || ingredients.some(({ total }) => total === null)) return null
  const success = craft_probability(Math.max(level, craft_required_level(ingredients.length)))
  return range(
    ingredients.reduce((sum, { total }) => sum + total!.minimum_seconds, 0) / success,
    ingredients.reduce((sum, { total }) => sum + total!.maximum_seconds, 0) / success
  )
}

const recipe_success = (recipe: EconomyRecipe | undefined, level: number): number | null =>
  recipe ? craft_probability(Math.max(level, craft_required_level(Object.keys(recipe.inputs).length))) : null
const craft_routes = (item_type: string, craft: AcquisitionRange | null): readonly AcquisitionRoute[] =>
  craft ? [Object.freeze({ kind: 'craft', source: item_type, range: craft })] : []
const percent = (value: number | null): number | null => (value === null ? null : value * 100)

export const acquisition_estimator = (content: AcquisitionContent): ((item_type: string) => AcquisitionEstimate) => {
  const items = new Map(content.items.map((item) => [item.item_type, item]))
  const recipes = new Map(content.recipes.map((recipe) => [recipe.output_type, recipe]))
  const mobs = new Map(content.mobs.map((mob) => [mob.mob_type, mob]))
  const available_mobs = placed_mob_types(content)
  const placed_resources = new Set(
    content.worlds.flatMap(({ resources }) => resources.map(({ item_type }) => item_type))
  )
  const drops = new Map<string, readonly Readonly<{ mob: EconomyMob; drop: EconomyDrop }>[]>()
  for (const mob of content.mobs) {
    for (const drop of mob.loot) {
      const previous = drops.get(drop.item_type) ?? Object.freeze([])
      drops.set(drop.item_type, Object.freeze([...previous, Object.freeze({ mob, drop })]))
    }
  }
  const cache = new Map<string, AcquisitionEstimate>()
  const estimate = (item_type: string, visiting: ReadonlySet<string>): AcquisitionEstimate => {
    const cached = cache.get(item_type)
    if (cached) return cached
    if (visiting.has(item_type))
      return Object.freeze({
        best: null,
        craft: null,
        routes: Object.freeze([]),
        ingredients: Object.freeze([]),
        craft_success_percent: null,
        cycle: true,
      })
    const item = items.get(item_type)
    if (!item)
      return Object.freeze({
        best: null,
        craft: null,
        routes: Object.freeze([]),
        ingredients: Object.freeze([]),
        craft_success_percent: null,
        cycle: false,
      })
    const next_visiting = new Set([...visiting, item_type])
    const direct_routes = [
      ...gather_routes(item, content, mobs, placed_resources),
      ...(drops.get(item_type) ?? [])
        .filter(({ mob }) => mob_is_available(mob, available_mobs, content))
        .map(({ mob, drop }) =>
          Object.freeze({
            kind: 'mob' as const,
            source: mob.mob_type,
            range: mob_drop_range(mob, drop, item.level, content),
          })
        ),
    ]
    const recipe = recipes.get(item_type)
    const ingredients = Object.freeze(
      Object.entries(recipe?.inputs ?? {}).map(([input_type, quantity]) =>
        ingredient_estimate(input_type, quantity, estimate(input_type, next_visiting).best)
      )
    )
    const cycle = ingredients.some(({ item_type: input_type }) => estimate(input_type, next_visiting).cycle)
    const success = recipe_success(recipe, item.level)
    const craft = craft_range(recipe, item.level, ingredients)
    const routes = Object.freeze([...direct_routes, ...craft_routes(item_type, craft)])
    const result = Object.freeze({
      best: best_range(routes),
      craft,
      routes,
      ingredients,
      craft_success_percent: percent(success),
      cycle,
    })
    cache.set(item_type, result)
    return result
  }
  return (item_type) => estimate(item_type, new Set())
}

export const item_acquisition = (content: AcquisitionContent, item_type: string): AcquisitionEstimate =>
  acquisition_estimator(content)(item_type)

export const acquisition_catalog = (content: AcquisitionContent): Readonly<Record<string, AcquisitionEstimate>> => {
  const estimate = acquisition_estimator(content)
  return Object.freeze(Object.fromEntries(content.items.map(({ item_type }) => [item_type, estimate(item_type)])))
}

const reachable_recipe_outputs = (
  recipes: readonly RecipeProgressionInput[],
  recipes_by_output: ReadonlyMap<string, RecipeProgressionInput>,
  job: string,
  level: number
): ReadonlySet<string> => {
  const candidates = recipes.filter(
    (recipe) => recipe.job === job && craft_required_level(Object.keys(recipe.inputs).length) <= level
  )
  const extend = (reachable: ReadonlySet<string>): ReadonlySet<string> => {
    const unlocked = candidates.filter(
      (recipe) =>
        !reachable.has(recipe.output_type) &&
        Object.keys(recipe.inputs).every((input_type) => {
          const producer = recipes_by_output.get(input_type)
          return !producer || producer.job !== job || reachable.has(input_type)
        })
    )
    return unlocked.length === 0
      ? reachable
      : extend(new Set([...reachable, ...unlocked.map(({ output_type }) => output_type)]))
  }
  return extend(new Set())
}

/** Simulate each profession independently from level 1 through 99. Other professions are valid
 * external suppliers; only same-job recipe dependencies can deadlock this job's XP route. */
export const recipe_progression_issues = (
  recipes: readonly RecipeProgressionInput[],
  jobs: readonly string[]
): readonly RecipeProgressionIssue[] => {
  const recipes_by_output = new Map(recipes.map((recipe) => [recipe.output_type, recipe]))
  const levels = Array.from({ length: job_max_level - 1 }, (_, index) => index + 1)
  return Object.freeze(
    jobs.flatMap((job) => {
      const blocked = levels.find((level) => {
        const reachable = reachable_recipe_outputs(recipes, recipes_by_output, job, level)
        return !recipes.some(
          (recipe) =>
            recipe.job === job &&
            reachable.has(recipe.output_type) &&
            craft_xp_at_level(Object.keys(recipe.inputs).length, level) > 0
        )
      })
      if (blocked === undefined) return []
      const reachable = reachable_recipe_outputs(recipes, recipes_by_output, job, blocked)
      return [
        Object.freeze({
          job,
          level: blocked,
          slot_capacity: craft_slot_capacity(blocked),
          reachable_recipe_count: reachable.size,
        }),
      ]
    })
  )
}

const recipe_acquisition_seconds = (
  recipe: RecipeProgressionInput,
  input_seconds: (item_type: string) => number | null
): number | null => {
  const rows = Object.entries(recipe.inputs).map(([item_type, quantity]) => {
    const seconds = input_seconds(item_type)
    return seconds === null ? null : seconds * quantity
  })
  return rows.some((seconds) => seconds === null) ? null : rows.reduce<number>((sum, seconds) => sum + seconds!, 0)
}

/** One removable recommendation: reachable now, still grants XP, and maximizes XP per expected
 * active second spent obtaining one attempt's inputs. Owned inventory deliberately does not enter. */
export const best_recipe_for_job_progression = (
  recipes: readonly RecipeProgressionInput[],
  job: string,
  level: number,
  input_seconds: (item_type: string) => number | null
): RecipeProgressRecommendation | null => {
  if (level >= job_max_level) return null
  const recipes_by_output = new Map(recipes.map((recipe) => [recipe.output_type, recipe]))
  const reachable = reachable_recipe_outputs(recipes, recipes_by_output, job, level)
  return (
    recipes
      .filter((recipe) => recipe.job === job && reachable.has(recipe.output_type))
      .flatMap((recipe): readonly RecipeProgressRecommendation[] => {
        const xp = craft_xp_at_level(Object.keys(recipe.inputs).length, level)
        const acquisition_seconds = recipe_acquisition_seconds(recipe, input_seconds)
        if (xp <= 0 || acquisition_seconds === null) return []
        return [
          Object.freeze({
            output_type: recipe.output_type,
            xp,
            acquisition_seconds,
            xp_per_second: xp / Math.max(1, acquisition_seconds),
          }),
        ]
      })
      .sort(
        (left, right) =>
          right.xp_per_second - left.xp_per_second ||
          right.xp - left.xp ||
          left.acquisition_seconds - right.acquisition_seconds ||
          left.output_type.localeCompare(right.output_type)
      )[0] ?? null
  )
}

export const acquisition_average_seconds = (value: AcquisitionRange): number =>
  (value.minimum_seconds + value.maximum_seconds) / 2

/** Provisional authoring band. Its deliberately broad ×½..×2 window warns about outliers
 * while playtesting tunes the per-kind effort constants. */
export const acquisition_target_range = (item: EconomyItem): AcquisitionRange => {
  const seconds_per_level_slot =
    item.category === 'resource'
      ? 5
      : ['hat', 'cloak', 'belt', 'boots', 'amulet', 'ring', 'sword', 'daggers', 'bow', 'spear', 'axe'].includes(
            item.category
          )
        ? 30
        : 15
  const target = Math.max(1, item.level) * craft_slot_capacity(item.level) * seconds_per_level_slot
  return range(target / 2, target * 2)
}

export const acquisition_target_status = (
  actual: AcquisitionRange | null,
  target: AcquisitionRange
): AcquisitionTargetStatus => {
  if (!actual) return 'unavailable'
  const average = acquisition_average_seconds(actual)
  if (average < target.minimum_seconds) return 'below'
  if (average > target.maximum_seconds) return 'above'
  return 'within'
}
