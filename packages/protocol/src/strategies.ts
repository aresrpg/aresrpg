// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { center_distance, job_slugs, mob_group_size_bounds, world_center, world_size } from '@aresrpg/immutable'
import { chain_to_client_coordinate } from '@aresrpg/immutable/world'

import catalogue from '../../../seed/content/strategies.json'
import mobs from '../../../seed/content/mobs.json'
import worlds from '../../../seed/content/worlds.json'

import { available_inventory_items, encumbered_asset_ids } from './inventory.ts'
import type { CharacterRow, ItemRow, ListingRow, TradeRow } from './packets.ts'
import { ZONE_SIZE } from './zone.ts'

/** Where a hero plays: a whole world, one city of it, or one biome of it outside cities. It fences the
 * hero's targets, and a hero that stands outside it walks to it. */
export type StrategyArea = Readonly<{ world: string }> &
  (
    | Readonly<{ city?: never; biome?: never }>
    | Readonly<{ city: string; biome?: never }>
    | Readonly<{ biome: string; city?: never }>
  )
/** What one hero brings to its own tree. */
export type StrategyBuild = Readonly<{
  /** A combat profile for this hero, such as a healer's; the catalogue's profile otherwise. */
  profile?: unknown
}>
/** How hard a hunt is: the group sizes the hero engages, and how far from the world centre, in blocks,
 * it goes for them. The distance is the one the population rule draws groups by. */
export type StrategyDifficulty = Readonly<{
  min_size: number
  max_size: number
  min_distance: number
  max_distance: number
}>
/** What a client chooses for one hero. Everything else in a script is authored in `seed/`. A field
 * left out keeps its default, which never ends or narrows a run. */
export type StrategyBinding = StrategyBuild &
  Partial<StrategyDifficulty> &
  Readonly<{
    character: string
    title: string
    area: StrategyArea
    /** Teammates of the same wallet; each runs its own copy of the tree and nobody leads. */
    allies?: readonly string[]
    dungeon?: string
    /** The monsters a hunt engages; every seed monster otherwise. */
    mob_types?: readonly string[]
    /** A raid ends once its hero saw this many dungeon runs end. */
    runs?: number
    /** The run ends once the network fees it paid reach this many MIST. */
    fee_cap_mist?: string
    /** The one resource a hero harvests, or the output of the one recipe it crafts. */
    item?: string
    /** The item type of the tool that harvests `item`. */
    tool?: string
    /** The job whose level `target_level` compares. */
    job?: string
    target_level?: number
    /** The amount of `item` in the hero's own kiosk that ends the run. */
    target_quantity?: number
    /** The jobs the bot may pick work from; every job otherwise. */
    jobs?: readonly string[]
  }>
/** What a team shares: every choice that is not a hero's own. */
export type StrategyScope = Omit<StrategyBinding, 'character' | 'allies' | keyof StrategyBuild>
/** A script as the bot takes it. `strategy` names the catalogue entry a tree was bound from: the bot
 * keeps it with the run and reports it back. A tree authored by hand has none. */
export type StrategyScript = Readonly<{
  version: '1'
  strategy?: string
  objective: Readonly<{ title: string }>
  tree: unknown
}>
export const { strategies } = catalogue
/** A run in one of these states holds its hero: it plays, or it is blocked and waits for its author.
 * A new tree for that hero replaces it; in any other state the hero is free to start one. */
export const run_live = ({ status }: Readonly<{ status: string }>): boolean =>
  ['active', 'waiting', 'awaiting_ai'].includes(status)

/** The widest band of distance from the world centre on which the population rule draws only groups
 * of these sizes. The rule never shrinks a group with distance, so the band is one interval. */
const size_band = ({ min_size, max_size }: Pick<StrategyDifficulty, 'min_size' | 'max_size'>): StrategyDifficulty => {
  const inside = (distance: number) => {
    const [low, high] = mob_group_size_bounds(BigInt(distance))
    return low >= BigInt(min_size) && high <= BigInt(max_size)
  }
  const distances = Array.from({ length: world_center + 1 }, (_, distance) => distance).filter(inside)
  return { min_size, max_size, min_distance: distances[0]!, max_distance: distances.at(-1)! }
}
/** The three difficulty levels: their group sizes are authored in seed, their distances follow from them. */
export const difficulties = Object.freeze({
  easy: size_band(catalogue.difficulty.easy),
  medium: size_band(catalogue.difficulty.medium),
  hard: size_band(catalogue.difficulty.hard),
})

/** A value no counter, level or amount reaches: a cap or an objective left out never ends a run. */
const NEVER = Number.MAX_SAFE_INTEGER
/** What a binding may leave out: no teammate, the catalogue's profile, every monster and every job,
 * groups of any size, no cap and no objective. A catalogue entry may state its own `defaults` over these. */
const UNBOUND = {
  allies: [],
  profile: catalogue.profile,
  mob_types: mobs.map(({ mob_type }) => mob_type),
  min_size: 1,
  max_size: NEVER,
  runs: NEVER,
  // The largest u64: no sum of fees reaches it.
  fee_cap_mist: '18446744073709551615',
  job: job_slugs[0],
  target_level: NEVER,
  target_quantity: NEVER,
  jobs: job_slugs,
}
const chosen = (fields: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
/** The area a script is bound with: the chosen place, narrowed to the difficulty's distance band. */
const bound_area = ({ area, min_distance, max_distance }: StrategyBinding) => ({
  ...area,
  ...chosen({ min_distance, max_distance }),
})
/** The one binder of seed-authored hosted-bot trees: a script acts for exactly one hero. A tree names
 * each field of its binding as `$field`, beside `$world`. A field with no default must be bound. */
export const bind_strategy = (id: string, binding: StrategyBinding): StrategyScript => {
  const preset = strategies.find((entry) => entry.id === id)
  if (!preset) throw new Error('unknown_strategy')
  if (![binding.character, binding.title].every(Boolean)) throw new Error('strategy_identity_required')
  const fields: Readonly<Record<string, unknown>> = {
    ...UNBOUND,
    ...('defaults' in preset ? preset.defaults : {}),
    ...chosen(binding),
    world: binding.area.world,
    area: bound_area(binding),
  }
  // The fields go in with one pass: a bound value is never read again for placeholders.
  const text = JSON.stringify(preset.tree).replace(/"\$(\w+)"/g, (_token, name: string) => {
    if (!Object.hasOwn(fields, name)) throw new Error('strategy_field_required')
    return JSON.stringify(fields[name])
  })
  return { version: '1', strategy: id, objective: { title: binding.title }, tree: JSON.parse(text) as unknown }
}
/** A team is one script per hero: each names the others as allies and brings its own build. */
export const bind_team = (
  id: string,
  heroes: readonly (Pick<StrategyBinding, 'character'> & StrategyBuild)[],
  scope: StrategyScope
): readonly StrategyScript[] =>
  heroes.map((hero) =>
    bind_strategy(id, {
      ...scope,
      ...hero,
      allies: heroes.flatMap(({ character }) => (character === hero.character ? [] : [character])),
    })
  )

/** The world whose city holds a dungeon's portal: a hero raids that dungeon only from there. */
export const dungeon_world = (dungeon: string): string | undefined =>
  worlds.find(({ cities }) => cities.some((city) => city.dungeon === dungeon))?.world

/** The engine's city lookup in client coordinates. It is passed in because the engine imports this package. */
type CityAt = (world: string, x: number, z: number) => Readonly<{ id: string; dungeon: string }> | null
export type HeroPlace = Readonly<{ world: string; city?: string; dungeon?: string }>
/** Where the bot's authoritative checkpoint places a hero: its world and, inside a city, that city
 * and its dungeon. Never a transient pose or a destination; null while unknown. */
export const hero_place = (
  { world, checkpoint_world, x, z }: Readonly<Partial<Record<'world' | 'checkpoint_world' | 'x' | 'z', unknown>>>,
  city_at: CityAt
): HeroPlace | null => {
  // A world the seed names is a string and a finite number is a number: both are checked here.
  const known = [
    world === checkpoint_world,
    Number.isFinite(x),
    Number.isFinite(z),
    worlds.some((entry) => entry.world === world),
  ].every(Boolean)
  if (!known) return null
  const city = city_at(
    world as string,
    chain_to_client_coordinate(x as number),
    chain_to_client_coordinate(z as number)
  )
  return { world: world as string, city: city?.id, dungeon: city?.dungeon }
}

/** A place with the distance band a difficulty adds to it, as the binder writes it into a tree. */
export type BoundArea = StrategyArea & Partial<Pick<StrategyDifficulty, 'min_distance' | 'max_distance'>>
/** The engine's lookups, passed in because the engine imports this package. `city_at` reads client coordinates. */
export type AreaLookups = Readonly<{
  city_at: CityAt
  biome_at: (world: string, zone_x: number, zone_z: number) => string | null
}>
/** A zone belongs to a band by its centre, as the population rule sizes its groups. */
const band_contains = (
  { min_distance = 0, max_distance = world_size }: BoundArea,
  zone_x: number,
  zone_z: number
): boolean => {
  const distance = center_distance((zone_x + 0.5) * ZONE_SIZE, (zone_z + 0.5) * ZONE_SIZE)
  return distance >= min_distance && distance <= max_distance
}
/**
 * Whether a chain position lies inside a place: the one rule the bot fences targets and travel with and
 * the pages tell "walks there first" with. A city is its footprint; a biome is the land outside cities,
 * taken by zone, so a zone whose centre is in a city belongs to that city.
 */
export const area_contains = (area: BoundArea, world: string, x: number, z: number, lookups: AreaLookups): boolean => {
  if (world !== area.world || ![x, z].every((value) => Number.isFinite(value) && value >= 0 && value < world_size))
    return false
  const zone_x = Math.floor(x / ZONE_SIZE)
  const zone_z = Math.floor(z / ZONE_SIZE)
  if (!band_contains(area, zone_x, zone_z)) return false
  const city_of = (at_x: number, at_z: number) =>
    lookups.city_at(world, chain_to_client_coordinate(at_x), chain_to_client_coordinate(at_z))
  if (area.city) return city_of(x, z)?.id === area.city
  if (!area.biome) return true
  if (city_of((zone_x + 0.5) * ZONE_SIZE, (zone_z + 0.5) * ZONE_SIZE)) return false
  return lookups.biome_at(world, zone_x, zone_z) === area.biome
}
/** Whether a place holds a zone at all: a zone belongs to it by its centre, which is where the bot's
 * travel goal lands. A place with no zone, such as a city outside its difficulty band, cannot be reached. */
export const area_has_zone = (area: BoundArea, lookups: AreaLookups): boolean => {
  const zones = Array.from({ length: Math.ceil(world_size / ZONE_SIZE) }, (_, index) => (index + 0.5) * ZONE_SIZE)
  return zones.some((x) => zones.some((z) => area_contains(area, area.world, x, z, lookups)))
}

/** What a wallet holds as the bot observes it: every item, with the listings and trades that lock some. */
export type RaidBag = Readonly<{
  items: readonly ItemRow[]
  listings: readonly ListingRow[]
  trades: readonly TradeRow[]
}>
/** The keys of one kiosk a raid can burn: certified on chain and neither listed nor in a trade. */
export const raid_keys = (bag: RaidBag, key: string, kiosk: string): readonly ItemRow[] =>
  available_inventory_items(bag.items, encumbered_asset_ids(bag.listings, bag.trades), kiosk).filter(
    (item) => item.version && item.item_type === key
  )
/** Entering burns a key for good. Of the listed heroes, in their order, those who can be in this
 * dungeon run: already inside it, or one hero per usable key of its kiosk. A hero the wallet does not
 * hold cannot. The bot enters only when this is the whole team; a client trims its team to it. */
export const raid_entrants = (
  raid: Readonly<{
    dungeon: string
    key: string
    team: readonly string[]
    heroes: readonly Readonly<Pick<CharacterRow, 'id' | 'kiosk' | 'dungeon_run'>>[]
    bag: RaidBag
  }>
): readonly string[] => {
  const members = raid.team.flatMap((id) => raid.heroes.find((hero) => hero.id === id) ?? [])
  const outside = members.filter((hero) => hero.dungeon_run?.dungeon !== raid.dungeon)
  const units = (kiosk: string) => raid_keys(raid.bag, raid.key, kiosk).reduce((total, { amount }) => total + amount, 0)
  const keyed = outside.filter(
    (hero, index) => outside.slice(0, index).filter(({ kiosk }) => kiosk === hero.kiosk).length < units(hero.kiosk)
  )
  return members.filter((hero) => !outside.includes(hero) || keyed.includes(hero)).map(({ id }) => id)
}
