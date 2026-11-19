// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chain_to_client_coordinate } from '@aresrpg/immutable/world'

import catalogue from '../../../seed/content/strategies.json'
import mobs from '../../../seed/content/mobs.json'
import worlds from '../../../seed/content/worlds.json'

import { available_inventory_items, encumbered_asset_ids } from './inventory.ts'
import type { CharacterRow, ItemRow, ListingRow, TradeRow } from './packets.ts'

export type StrategyArea = Readonly<{ world: string; city?: string }>
/** What one hero brings to its own tree. An empty priority list spends or wears nothing. */
export type StrategyBuild = Readonly<{
  /** A combat profile for this hero, such as a healer's; the catalogue's profile otherwise. */
  profile?: unknown
  /** Priority lists for unspent stat and spell points. */
  stats?: readonly string[]
  spells?: readonly string[]
  /** Item stats that rank owned gear, the most wanted first. */
  equipment?: readonly string[]
}>
/** What a client chooses for one hero. Everything else in a script is authored in `seed/`. */
export type StrategyBinding = StrategyBuild &
  Readonly<{
    character: string
    title: string
    area: StrategyArea
    /** Teammates of the same wallet; each runs its own copy of the tree and nobody leads. */
    allies?: readonly string[]
    dungeon?: string
  }>
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
/** What a binding may leave out: no teammate, no dungeon, the catalogue's profile, nothing to spend or wear. */
const UNBOUND = { allies: [], dungeon: '', profile: catalogue.profile, stats: [], spells: [], equipment: [] }
const chosen = (binding: StrategyBinding) =>
  Object.fromEntries(Object.entries(binding).filter(([, value]) => value !== undefined))
/** The one binder of seed-authored hosted-bot trees: a script acts for exactly one hero. A tree names
 * each field of its binding as `$field`, beside `$world`, `$mob_types` and the shared `$growth` leaves. */
export const bind_strategy = (id: string, binding: StrategyBinding): StrategyScript => {
  const preset = strategies.find((entry) => entry.id === id)
  if (!preset) throw new Error('unknown_strategy')
  if (![binding.character, binding.title].every(Boolean)) throw new Error('strategy_identity_required')
  const fields: Readonly<Record<string, unknown>> = {
    ...UNBOUND,
    ...chosen(binding),
    world: binding.area.world,
    mob_types: mobs.map(({ mob_type }) => mob_type),
  }
  // The growth leaves are authored once and name other placeholders, so they are placed first.
  // The fields then go in with one pass: a bound value is never read again for placeholders.
  const text = JSON.stringify(preset.tree)
    .replaceAll('"$growth"', () => JSON.stringify(catalogue.growth))
    .replace(/"\$(\w+)"/g, (token, name: string) =>
      Object.hasOwn(fields, name) ? JSON.stringify(fields[name]) : token
    )
  return { version: '1', strategy: id, objective: { title: binding.title }, tree: JSON.parse(text) as unknown }
}
/** A team is one script per hero: each names the others as allies and brings its own build. */
export const bind_team = (
  id: string,
  heroes: readonly (Pick<StrategyBinding, 'character'> & StrategyBuild)[],
  scope: Pick<StrategyBinding, 'title' | 'area' | 'dungeon'>
): readonly StrategyScript[] =>
  heroes.map((hero) =>
    bind_strategy(id, {
      ...scope,
      ...hero,
      allies: heroes.flatMap(({ character }) => (character === hero.character ? [] : [character])),
    })
  )

const { build, dungeon: basic_dungeon } = catalogue.basic
/** Basic mode as authored in seed: its raid target and the class it builds. */
export const basic_mode = Object.freeze({ dungeon: basic_dungeon, classe: build.classe })
/** The world whose city holds a dungeon's portal: a hero raids that dungeon only from there. */
export const dungeon_world = (dungeon: string): string | undefined =>
  worlds.find(({ cities }) => cities.some((city) => city.dungeon === dungeon))?.world
/** Basic mode plays one authored build: a hero of its class gets its priorities and profile, any
 * other hero gets nothing and keeps the catalogue's profile. */
export const basic_build = (classe: string): StrategyBuild => {
  const { classe: built, ...priorities } = build
  return classe === built ? priorities : {}
}

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
