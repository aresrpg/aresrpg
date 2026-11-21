// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the seed says about where heroes go: pure selectors over the one content catalogue. Every
// figure is a seed fact or the chain's own rule; nothing here is an estimate or a price.
import { client_world_position, world_city_areas } from '@aresrpg/engine/data'
import {
  PET_SPEED_MULTIPLIER,
  SPEED_BUDGET_BLOCKS_PER_SECOND,
  type CharacterRow,
  type ItemRow,
} from '@aresrpg/protocol'
import { area_has_zone, difficulties, type RaidBag, type StrategyArea } from '@aresrpg/protocol/strategies'

import { content_catalog, type SeedDungeon } from '../content/catalog.ts'
import { world_places, type WorldPlace } from '../encyclopedia/world_locations.ts'

import { hero_items } from './account.ts'
import { AREA_LOOKUPS, stands_in, type Difficulty } from './strategies.ts'

type Hero = Readonly<CharacterRow>
export type LevelBand = Readonly<{ min: number; max: number }>
/** One loot row of a monster: the seed's base rate. The game scales it with the monster's level, so a
 * view prints it as "about". */
export type PlaceDrop = Readonly<{ item_type: string; mob_type: string; chance_bp: number }>

/** A world with monsters, and whether a hero is high enough to enter it. A hero is still sent only
 * inside the world it stands in. */
export const quest_worlds = (heroes: readonly Hero[]) =>
  content_catalog.worlds
    .filter(({ mobs }) => mobs.length > 0)
    .map(({ world, entry_level }) => ({
      world,
      entry_level,
      open: heroes.some(({ level }) => level >= entry_level),
    }))

const PLACES: Readonly<Record<string, readonly WorldPlace[]>> = Object.freeze(
  Object.fromEntries(
    content_catalog.worlds.map((world) => [
      world.world,
      world_places(world, content_catalog.mobs, content_catalog.dungeons).filter(({ mob_types }) => mob_types.length),
    ])
  )
)
/** The cities and biomes of a world that hold monsters. */
export const quest_places = (world: string): readonly WorldPlace[] => PLACES[world] ?? []
/** A place as a Start names it. */
export const place_area = (world: string, { kind, id }: Readonly<Pick<WorldPlace, 'kind' | 'id'>>): StrategyArea =>
  kind === 'city' ? { world, city: id } : { world, biome: id }

const mobs_of = (mob_types: readonly string[]) =>
  [...new Set(mob_types)].flatMap((mob_type) => content_catalog.mob(mob_type)?.mob ?? [])
/** The lowest and highest level of the monsters given; null when there is none. */
export const place_levels = (mob_types: readonly string[]): LevelBand | null => {
  const mobs = mobs_of(mob_types)
  return mobs.length
    ? { min: Math.min(...mobs.map((mob) => mob.level_min)), max: Math.max(...mobs.map((mob) => mob.level_max)) }
    : null
}
/** Everything those monsters drop, most frequent first. */
export const place_drops = (mob_types: readonly string[]): readonly PlaceDrop[] =>
  mobs_of(mob_types)
    .flatMap(({ mob_type, loot }) => loot.map(({ item_type, chance_bp }) => ({ item_type, mob_type, chance_bp })))
    .toSorted((left, right) => right.chance_bp - left.chance_bp || left.item_type.localeCompare(right.item_type))
const is_key = (item_type: string): boolean => content_catalog.dungeons.some(({ key }) => key === item_type)
/** The dungeon keys those monsters drop. */
export const key_drops = (mob_types: readonly string[]): readonly PlaceDrop[] =>
  place_drops(mob_types).filter(({ item_type }) => is_key(item_type))
/** The drop that is not a key with the lowest seed rate; null when those monsters drop nothing else. */
export const rarest_drop = (mob_types: readonly string[]): PlaceDrop | null =>
  place_drops(mob_types).findLast(({ item_type }) => !is_key(item_type)) ?? null
/** The monsters that drop a key, most frequent first, with where each one lives. */
export const key_sources = (key: string) =>
  (content_catalog.item(key)?.dropped_by ?? [])
    .map(({ mob, drop }) => ({
      mob_type: mob.mob_type,
      chance_bp: drop.chance_bp,
      locations: content_catalog.mob(mob.mob_type)?.locations ?? [],
    }))
    .toSorted((left, right) => right.chance_bp - left.chance_bp)

export type DungeonRoom = Readonly<{
  /** Counted from 1, as a hero's chain row counts it. */
  room: number
  /** The last room holds the boss. */
  boss: boolean
  mob_types: readonly string[]
  levels: LevelBand | null
  drops: readonly PlaceDrop[]
}>
/** The rooms of a dungeon in order, each with its monsters, their level band and what they drop. */
export const dungeon_rooms = ({ rooms }: SeedDungeon): readonly DungeonRoom[] =>
  rooms.map((mobs, index) => {
    const mob_types = [...new Set(mobs.map(({ mob_type }) => mob_type))]
    return {
      room: index + 1,
      boss: index === rooms.length - 1,
      mob_types,
      levels: place_levels(mob_types),
      drops: place_drops(mob_types),
    }
  })

type CityArea = ReturnType<typeof world_city_areas>[number]
const city_area = ({ world, city }: StrategyArea): CityArea | null =>
  world_city_areas(world).find(({ id }) => id === city) ?? null
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)
/**
 * The least time a hero needs on foot to reach a city, by the chain's own walking rule: the straight
 * distance from its checkpoint to the nearest point of the city, at the game's speed, faster with a
 * pet. Null while the hero's checkpoint is unknown, in another world, or for a place that is no city.
 * It is a floor, never an arrival time: the bot walks zone by zone.
 */
export const walk_seconds = (hero: Hero, area: StrategyArea): number | null => {
  const city = city_area(area)
  const known = [city !== null, hero.world === area.world, hero.checkpoint_world === area.world].every(Boolean)
  if (!known || !Number.isFinite(hero.x) || !Number.isFinite(hero.z)) return null
  // City footprints are in client coordinates; a checkpoint is in chain coordinates.
  const [x, z] = client_world_position(hero.x!, hero.z!)
  const { min_x, max_x, min_z, max_z } = city!
  const distance = Math.hypot(x - clamp(x, min_x, max_x), z - clamp(z, min_z, max_z))
  return Math.ceil(distance / (SPEED_BUDGET_BLOCKS_PER_SECOND * (hero.pet ? PET_SPEED_MULTIPLIER : 1)))
}

/**
 * Whether a difficulty can be played in a place. A difficulty is a band of distance from the world
 * centre and a city stands at one distance: outside the band the bot finds no zone and the run waits.
 * A world or a biome spans every distance.
 */
export const difficulty_fits = (area: StrategyArea, difficulty: Difficulty): boolean => {
  if (!area.city) return true
  const { min_distance, max_distance } = difficulties[difficulty]
  return area_has_zone({ ...area, min_distance, max_distance }, AREA_LOOKUPS)
}

/** The potion that takes a hero to a city at once; null when the seed authors none for it. */
export const city_potion = (city: string): string | null =>
  content_catalog.items.find(({ consumable }) => consumable?.type === 'city' && consumable.city === city)?.item_type ??
  null
/**
 * The potion row one hero can drink to stand in the chosen city now, from its own kiosk. Null when
 * the place is no city, when the hero already stands in it, or when it holds no such potion: a hero
 * that would gain nothing is never offered one.
 */
export const travel_potion = (bag: RaidBag, hero: Hero, area: StrategyArea): ItemRow | null => {
  const potion = area.city ? city_potion(area.city) : null
  if (!potion || hero.world !== area.world || stands_in(area, hero)) return null
  return hero_items(bag, hero.kiosk).find((item) => item.item_type === potion && item.version) ?? null
}
