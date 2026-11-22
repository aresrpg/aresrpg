// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The facts of a raid, as the Raid tab reads them: what a dungeon holds, the teams the page follows and
// how a finished raid went. Every figure is a seed fact or something this page saw; nothing is stored.
import type { CharacterRow } from '@aresrpg/protocol'
import type { StrategyArea } from '@aresrpg/protocol/strategies'

import type { AppCopy } from '../i18n/copy.ts'
import { content_catalog, titleize, type SeedDungeon, type SeedMob } from '../content/catalog.ts'

import type { DappAccount } from './account.ts'
import { dapp_text } from './copy.ts'
import { key_sources, place_area, rarest_drop, type DungeonRoom } from './places.ts'
import type { DappPosition } from './positions.ts'
import { activity_offer, type DappInput, type DappState, type RaidPick } from './state.ts'
import { plan_keys_missing, type ActivityPlan, type StartSpec } from './strategies.ts'

type Hero = Readonly<CharacterRow>
export type RaidText = (key: string, values?: Readonly<Record<string, string>>) => string
export const raid_text =
  (copy: AppCopy): RaidText =>
  (key, values) =>
    dapp_text(copy, key, values)

/** Drop rows a raid block lists before the dungeon's full table: one screen of a phone. */
export const RAID_DROPS_SHOWN = 6

/** The monster a dungeon is hunted for: the one of its last room the seed marks as a boss. */
export const dungeon_boss = ({ rooms }: SeedDungeon): SeedMob | null =>
  (rooms.at(-1) ?? [])
    .flatMap(({ mob_type }) => content_catalog.mob(mob_type)?.mob ?? [])
    .find(({ role }) => role === 'boss') ?? null
export const boss_name = (dungeon: SeedDungeon): string => dungeon_boss(dungeon)?.name ?? titleize(dungeon.dungeon)
/** The city a dungeon is entered from, as a place a hero walks to. */
export const dungeon_gates = (dungeon: string): StrategyArea | null => {
  const world = content_catalog.worlds.find(({ cities }) => cities.some((city) => city.dungeon === dungeon))
  const gates = world?.cities.find((city) => city.dungeon === dungeon)
  return world && gates ? { world: world.world, city: gates.city } : null
}
/** A raid's title, on the page and as the objective of its runs. */
export const raid_title = (text: RaidText, dungeon: SeedDungeon): string =>
  text('raid_title', { boss: boss_name(dungeon) })
/** A room as the page names it: its number among the rooms, or the boss room with the boss's name. */
export const room_title = (text: RaidText, dungeon: SeedDungeon, room: number): string =>
  room >= dungeon.rooms.length
    ? text('raid_boss_room', { boss: boss_name(dungeon) })
    : text('raid_room', { room: String(room), rooms: String(dungeon.rooms.length) })

export type RaidDrop = Readonly<{ item_type: string; chance_bp: number; rooms: readonly number[] }>
/** Every item those rooms can drop, once each at its best seed rate with the rooms it drops in, rarest first. */
export const room_drops = (rooms: readonly DungeonRoom[]): readonly RaidDrop[] => {
  const drops = rooms.flatMap(({ room, drops: rows }) => rows.map((drop) => ({ ...drop, room })))
  return [...new Set(drops.map(({ item_type }) => item_type))]
    .map((item_type) => {
      const rows = drops.filter((drop) => drop.item_type === item_type)
      return {
        item_type,
        chance_bp: Math.max(...rows.map(({ chance_bp }) => chance_bp)),
        rooms: [...new Set(rows.map(({ room }) => room))],
      }
    })
    .toSorted((left, right) => left.chance_bp - right.chance_bp || left.item_type.localeCompare(right.item_type))
}
/** What a run can drop, rarest first: the boss room's rarest drop leads, as the reason to hunt it. */
export const raid_ladder = (rooms: readonly DungeonRoom[]): readonly RaidDrop[] => {
  const drops = room_drops(rooms)
  const prize = rarest_drop(rooms.at(-1)?.mob_types ?? [])?.item_type
  return [
    ...drops.filter(({ item_type }) => item_type === prize),
    ...drops.filter(({ item_type }) => item_type !== prize),
  ]
}
/** The rooms a drop comes from, as one short label. */
export const drop_rooms = (text: RaidText, dungeon: SeedDungeon, rooms: readonly number[]): string => {
  const [first, last] = [rooms[0]!, rooms.at(-1)!]
  if (first !== last) return text('raid_rooms', { first: String(first), last: String(last) })
  return first === dungeon.rooms.length ? text('drops_boss_room') : text('drops_room', { room: String(first) })
}

/** Where the monster that drops a key most often lives, as a quest names a place; null when none drops it. */
export const key_quest_place = (key: string): StrategyArea | null => {
  const [home] = key_sources(key).flatMap(({ locations }) => locations)
  if (!home) return null
  const [city] = home.cities
  const [biome] = home.biomes
  if (city) return place_area(home.world, { kind: 'city', id: city })
  return biome ? place_area(home.world, { kind: 'biome', id: biome }) : { world: home.world }
}
/** The Quest tab, set to fight where the key drops. The player still picks who goes. */
export const key_quest_inputs = (key: string): readonly DappInput[] => {
  const place = key_quest_place(key)
  return [
    { type: 'dapp/quest_pick', pick: place ? { kind: 'fight', place } : { kind: 'fight' } },
    { type: 'dapp/tab', tab: 'quest' },
  ]
}

/** The seats after a hero takes one: it replaces the hero that sits there, or sits after the last one. */
export const seat_taken = (seats: readonly string[], seat: number, hero_id: string): readonly string[] =>
  seat < seats.length ? seats.map((id, index) => (index === seat ? hero_id : id)) : [...seats, hero_id]
export const seats_input = (hero_ids: readonly string[]): DappInput => ({ type: 'dapp/raid_pick', pick: { hero_ids } })

export type EnterStep = 'blocked' | 'confirm' | 'send'
/** What Enter does with a plan: a team short of keys is confirmed first, and a plan that starts nobody sends nothing. */
export const enter_step = (plan: ActivityPlan): EnterStep => {
  if (!plan.starts.length) return 'blocked'
  return plan_keys_missing(plan) ? 'confirm' : 'send'
}

type RaidSpec = Extract<StartSpec, { activity: 'raid' }>
/** One raid as the page follows it: the heroes one Start sent together, or those found in one dungeon. */
export type RaidParty = Readonly<{
  id: string
  /** Null for a run found in an observation whose hero stands in no dungeon. */
  dungeon: SeedDungeon | null
  live: boolean
  sent: RaidSpec | null
  positions: readonly DappPosition[]
}>
type Origin = Readonly<{ live: boolean; sent: RaidSpec | null; dungeon: string | null }>
const origin_of = (position: DappPosition, heroes: readonly Hero[]): Origin => {
  const sent = position.sent?.activity === 'raid' ? position.sent : null
  const inside = heroes.find(({ id }) => id === position.hero_id)?.dungeon_run?.dungeon
  return { live: position.finished_ms === null, sent, dungeon: sent?.dungeon ?? inside ?? null }
}
const same_origin = (left: Origin, right: Origin): boolean =>
  left.live === right.live && left.sent === right.sent && left.dungeon === right.dungeon
/**
 * The raid positions as teams. Heroes one Start sent share its spec, so they are one team; a run this
 * page only observed joins the others found in its dungeon. Running and finished teams stay apart.
 */
export const raid_parties = (positions: readonly DappPosition[], heroes: readonly Hero[]): readonly RaidParty[] =>
  positions
    .filter(({ activity }) => activity === 'raid')
    .reduce<readonly (Origin & Readonly<{ positions: readonly DappPosition[] }>)[]>((groups, position) => {
      const origin = origin_of(position, heroes)
      const known = groups.find((group) => same_origin(group, origin))
      return known
        ? groups.map((group) => (group === known ? { ...group, positions: [...group.positions, position] } : group))
        : [...groups, { ...origin, positions: [position] }]
    }, [])
    .map(({ live, sent, dungeon, positions: members }) => ({
      id: members[0]!.id,
      live,
      sent,
      dungeon: content_catalog.dungeon(dungeon ?? ''),
      positions: members,
    }))

/** Heroes whose raid start the bot has not answered yet: they belong to no position so far. */
export const raid_starting = ({ commands }: DappState): readonly string[] =>
  Object.values(commands).flatMap((command) =>
    command.kind === 'start' && command.status !== 'refused' && command.spec.activity === 'raid'
      ? [command.hero_id]
      : []
  )
export type RaidLoot = Readonly<{ item_type: string; qty: number }>
/** What a team's fights dropped, summed by item. `rooms_only` keeps the fights of dungeon rooms. */
export const party_loot = (positions: readonly DappPosition[], rooms_only: boolean): readonly RaidLoot[] => {
  const drops = positions.flatMap(({ results }) =>
    results.filter(({ room }) => !rooms_only || room !== null).flatMap(({ drops: rows }) => rows)
  )
  return [...new Set(drops.map(({ item_type }) => item_type))].map((item_type) => ({
    item_type,
    qty: drops.filter((drop) => drop.item_type === item_type).reduce((total, { qty }) => total + qty, 0),
  }))
}
/** The fights a team won and lost, each fight once whoever of the team fought it. */
export const party_fights = (positions: readonly DappPosition[]) => ({
  won: new Set(positions.flatMap(({ totals }) => totals.won)).size,
  lost: new Set(positions.flatMap(({ totals }) => totals.lost)).size,
})
export type RaidVerdict = 'won' | 'lost' | null
/**
 * How a finished raid went, from the room fights this page saw end: a boss room won is a victory, any
 * lost room without one is a defeat. A raid that ended before either says nothing: the bot does not
 * tell why a run ended.
 */
export const raid_verdict = ({ dungeon, positions }: Pick<RaidParty, 'dungeon' | 'positions'>): RaidVerdict => {
  const fights = positions.flatMap(({ results }) => results.filter(({ room }) => room !== null))
  if (dungeon && fights.some(({ room, won }) => won && room === dungeon.rooms.length)) return 'won'
  return fights.some(({ won }) => !won) ? 'lost' : null
}

export type RaidAgain = Readonly<{ spec: RaidSpec; title: string; missing: number; ready: boolean }>
/**
 * The same raid, sent again: offered for a team this page sent. It is ready only when every hero of
 * that team can enter now; `missing` counts the keys the team lacks.
 */
export const raid_again = (
  dapp: DappState,
  account: DappAccount,
  { sent, positions }: Pick<RaidParty, 'sent' | 'positions'>,
  fallback_title: string
): RaidAgain | null => {
  if (!sent) return null
  const title = positions[0]?.objective ?? fallback_title
  const { plan } = activity_offer(dapp, account, sent, title)
  // A hero that is out, or being asked about, is in no plan: the whole team goes or nobody does.
  return { spec: sent, title, missing: plan_keys_missing(plan), ready: plan.starts.length === sent.hero_ids.length }
}
/** The seats, dungeon and caps of a team, as the setup takes them back. */
export const team_pick = ({ sent, dungeon, positions }: RaidParty): Partial<RaidPick> => {
  if (sent) return { dungeon: sent.dungeon, hero_ids: sent.hero_ids, runs: sent.runs, fee_cap_mist: sent.fee_cap_mist }
  const hero_ids = positions.map(({ hero_id }) => hero_id)
  return dungeon ? { dungeon: dungeon.dungeon, hero_ids } : { hero_ids }
}
