// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'
import { type CharacterRow, live_resource_packs, live_mob_groups } from '@aresrpg/protocol'
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
import type { SeedRecipe } from '@aresrpg/sdk/seed'
import {
  CONTRACT_CONSTANTS,
  spell_level_of,
  weapon_level_of,
  type HydratedFightCheckpoint,
  type SpellLevel,
} from '@aresrpg/fight'

import spells from '../../../seed/content/spells.json'
import items from '../../../seed/content/items.json'
import recipes from '../../../seed/content/recipes.json'
import mobs from '../../../seed/content/mobs.json'

import type { ActorSnapshot } from './actor_snapshot.ts'
import {
  fight_checkpoint_id,
  gameplay_json,
  gameplay_observed_ms,
  hydrate_gameplay_fight,
  type GameplayContext,
} from './gameplay_context.ts'

export const catalog_spell = (name: string) => spells.find((spell) => spell.name === name)

/** Entitlement only; current cast legality belongs to the fight twin. */
export const learned_spell_rank = (
  name: string,
  character: Readonly<Pick<CharacterRow, 'classe' | 'level' | 'spells'>>
): number | null => {
  const spell = catalog_spell(name)
  const rank = character.spells[name] ?? 1
  return spell?.classe === character.classe && spell.unlock_level <= character.level && spell.levels[rank - 1]
    ? rank
    : null
}
/** Every spell a hero knows with its rank. The chain row holds only the raised ones: a spell unlocked
 * and never raised is known at rank 1, and a reader of the row alone would take it for unknown. */
export const learned_spells = (character: Readonly<Pick<CharacterRow, 'classe' | 'level' | 'spells'>>) =>
  Object.fromEntries(
    spells
      .flatMap(({ name }) => {
        const rank = learned_spell_rank(name, character)
        return rank === null ? [] : [[name, rank] as const]
      })
      .toSorted(([left], [right]) => left.localeCompare(right))
  )
/** Mirrors progression::raise_spell: one rank costs the current rank; authored levels own the cap. */
export const spell_upgrade_quote = (name: string, character: Readonly<CharacterRow>) => {
  const rank = learned_spell_rank(name, character)
  return rank !== null && catalog_spell(name)?.levels[rank] ? { cost: rank, next_rank: rank + 1 } : null
}
const numeric_codes = (codes: Readonly<Record<string, bigint>>) =>
  Object.fromEntries(Object.entries(codes).map(([name, value]) => [name, Number(value)]))

const spell_knowledge = (characters: readonly CharacterRow[], requested: readonly string[]) => ({
  source: 'seed/content/spells.json and Move-derived fight vocabulary; live Move validation remains authoritative',
  ...(requested.length === 0
    ? { catalog: spells.map(({ name, classe, unlock_level }) => ({ name, classe, unlock_level })) }
    : {
        definitions: spells
          .filter(({ name }) => requested.includes(name))
          .map((spell) => ({
            ...spell,
            characters: characters.map((character) => ({
              character_id: character.id,
              learned_rank: learned_spell_rank(spell.name, character),
              available_spell_points: character.available_spell_points,
              upgrade: spell_upgrade_quote(spell.name, character),
            })),
          })),
        effect_kinds: numeric_codes(EFFECT_KINDS),
        area_shapes: numeric_codes(AREA_SHAPES),
        target_filters: numeric_codes(TARGET_FILTERS),
        stat_channels: numeric_codes(CHANNELS),
      }),
})
export const profession_recipes = recipes as unknown as readonly SeedRecipe[]
export const profession_item = (item_type: string) => items.find((item) => item.item_type === item_type)
export const profession_recipe = (output_type: string) =>
  profession_recipes.find((recipe) => recipe.output_type === output_type)
export const recipe_job = (output_type: string) => {
  const item = profession_item(output_type)
  return item ? craft_job_of(item.category, profession_recipe(output_type)?.job) : undefined
}
const acquisition_sources = (item_type: string) => ({
  gather: gatherable_of(item_type),
  recipe: profession_recipe(item_type) ?? null,
  drops: mobs.flatMap((mob) =>
    mob.loot
      .filter((loot) => loot.item_type === item_type)
      .map((loot) => ({ mob_type: mob.mob_type, level_min: mob.level_min, level_max: mob.level_max, ...loot }))
  ),
})
const profession_knowledge = (snapshot: ActorSnapshot, requested?: readonly string[]) => ({
  source: 'seed/content plus immutable game rules; live Move validation remains authoritative',
  inventory_ready: Boolean(snapshot.inventory?.loaded && snapshot.inventory.listings && snapshot.inventory.trades),
  characters: snapshot.characters.map((character) => ({
    character_id: character.id,
    jobs: job_slugs.map((job) => {
      const xp = Number(character.jobs[job] ?? '0')
      const level = job_level_from_xp(xp)
      return { job, xp, level, next_level_xp: job_xp_for_level(level + 1) ?? null }
    }),
    equipped_tool: character.equipment.find(({ slot }) => slot === 'tool') ?? null,
  })),
  // An empty request lists every recipe in one light line; a named recipe comes with its details.
  recipes: profession_recipes
    .filter(({ output_type }) => requested?.length === 0 || requested?.includes(output_type))
    .map((recipe) => ({
      output_type: recipe.output_type,
      job: recipe_job(recipe.output_type),
      required_level: craft_required_level(Object.keys(recipe.inputs).length),
      ...(requested?.length === 0 ? {} : recipe_details(recipe, snapshot)),
    })),
})
const recipe_details = (recipe: SeedRecipe, snapshot: ActorSnapshot) => ({
  ...recipe,
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
})
/** One zone as a planner reads it: where it is, and its live resource packs and monster groups. */
export const zone_knowledge = ({ zone, spawns }: ActorSnapshot['zones'][string]) => ({
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
})
type Context = Pick<GameplayContext, 'snapshot' | 'address' | 'now' | 'freshness_ms'>
type Definition = Readonly<Record<string, unknown>>
type Seat = Readonly<{
  fighter_idx: string
  character_id: string
  spells: readonly Readonly<{ name: string; definition: Definition }>[]
  weapon: Definition | null
}>
type Knowledge = Readonly<{
  professions?: ReturnType<typeof profession_knowledge>
  spells?: ReturnType<typeof spell_knowledge>
  available: boolean
  reason?: string
  guides: typeof guides
  timing: typeof timing
  fights: Readonly<
    Record<string, Readonly<{ checkpoint_id: string; active_fighter_idx: string | null; seats: readonly Seat[] }>>
  >
}>
const guides = Object.freeze({
  combat: 'https://aresrpg.world/agents/combat.txt',
  world: 'https://aresrpg.world/agents/world.txt',
})
const timing = Object.freeze({
  placement_force_ms: CONTRACT_CONSTANTS.placement_force_ms.toString(),
  turn_min_ms: CONTRACT_CONSTANTS.turn_min_ms.toString(),
  turn_max_ms: CONTRACT_CONSTANTS.turn_max_ms.toString(),
})
const wire_definition = (level: SpellLevel): Definition => JSON.parse(gameplay_json(level)) as Definition
const owned_seats = (context: Context, checkpoint: HydratedFightCheckpoint): readonly Seat[] =>
  checkpoint.contract.fighters.flatMap((fighter, index) => {
    if (fighter.kind.type !== 'player') return []
    const character_id = fighter.kind.character
    const character = context.snapshot.characters.find((row) => row.id === character_id)
    if (!character?.active_fight) return []
    const owns = [
      fighter.kind.owner === context.address,
      !fighter.settled,
      !fighter.forfeited,
      character.custody === 'fight',
      character.active_fight.id === checkpoint.contract.id,
      character.active_fight.seat === index,
    ].every(Boolean)
    if (!owns) return []
    const seat = BigInt(index)
    const weapon = weapon_level_of(checkpoint, seat)
    return [
      {
        fighter_idx: seat.toString(),
        character_id,
        weapon: weapon ? wire_definition(weapon) : null,
        spells: Object.keys(checkpoint.sources.spells).flatMap((name) => {
          const level = spell_level_of(checkpoint, seat, name)
          return level ? [{ name, definition: wire_definition(level) }] : []
        }),
      },
    ]
  })
/** Read-only planning context from the same authored content and fight twin used for validation.
 * It grants no authority; every write is independently rechecked at signing and submission. */
export const gameplay_knowledge = (
  context: Context,
  recipes?: readonly string[],
  spells?: readonly string[]
): Knowledge => {
  try {
    gameplay_observed_ms(context)
  } catch {
    return { available: false, reason: 'needs_resync', guides, timing, fights: {} }
  }
  const fights = Object.fromEntries(
    Object.entries(context.snapshot.fights).flatMap(([id, row]) => {
      const checkpoint = hydrate_gameplay_fight(row)
      const seats = owned_seats(context, checkpoint)
      if (seats.length === 0) return []
      const active = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
      return [[id, { checkpoint_id: fight_checkpoint_id(row), active_fighter_idx: active?.toString() ?? null, seats }]]
    })
  )
  return {
    available: true,
    guides,
    timing,
    fights,
    professions: profession_knowledge(context.snapshot, recipes),
    ...(spells ? { spells: spell_knowledge(context.snapshot.characters, spells) } : {}),
  }
}
