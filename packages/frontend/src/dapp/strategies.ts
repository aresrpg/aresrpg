// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_at_position } from '@aresrpg/engine/data'
import type { CharacterRow } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import {
  basic_build,
  basic_mode,
  bind_team,
  dungeon_world,
  hero_place,
  raid_entrants,
  type HeroPlace,
  type RaidBag,
  type StrategyArea,
  type StrategyScript,
} from '@aresrpg/protocol/strategies'

import { content_catalog } from '../content/catalog.ts'

import { strongest_first } from './account.ts'

export type DappActivity = 'train' | 'gather' | 'raid'
export type Blocker = 'hero_busy' | 'hero_unknown' | 'city_required' | 'world_required' | 'key_missing' | 'team_full'
/** What one tap would do: the seed-authored tree of every hero that can go, and why the others cannot. */
export type ActivityPlan = Readonly<{
  starts: readonly Readonly<{ hero_id: string; script: StrategyScript }>[]
  blocked: readonly Readonly<{ hero_id: string; blocker: Blocker }>[]
  /** Dungeon keys the heroes left out of a raid team still need, by item type. */
  missing_keys: Readonly<Record<string, number>>
}>

/** A fight seats this many heroes on one side: the board's start cells, so a raid team is never larger. */
const RAID_TEAM = Number(CONTRACT_CONSTANTS.start_cells)
/** What Basic mode does, for the page that announces it: its raid and the build of its class. */
export const BASIC = Object.freeze({
  dungeon: basic_mode.dungeon,
  team: RAID_TEAM,
  classe: basic_mode.classe,
  ...basic_build(basic_mode.classe),
})
/** Seed owns the reviewed trees behind each activity: the one a hero plays alone, then the one heroes play together. */
const PRESETS: Readonly<Record<DappActivity, readonly [alone: string, together: string]>> = {
  train: ['fight_nearby', 'team_hunt'],
  gather: ['gather_craft', 'gather_craft'],
  raid: ['dungeon_raid', 'dungeon_raid'],
}
const ACTIVITIES = Object.keys(PRESETS) as readonly DappActivity[]
/** The activity of a run, from the catalogue entry the bot says its tree was bound from. */
export const strategy_activity = (strategy: string | null): DappActivity | null =>
  ACTIVITIES.find((activity) => strategy !== null && PRESETS[activity].includes(strategy)) ?? null

/** What heroes sent together share: the area they stand in and, for a raid, its dungeon. */
type Scope = Readonly<{ area: StrategyArea; dungeon?: string }>
/** A hero inside a dungeon goes on with that one. Otherwise Basic raids the dungeon authored in seed
 * and Advanced the dungeon of the city the hero stands in. A dungeon is entered from its own world. */
const raid_scope = (
  hero: Readonly<CharacterRow>,
  { world, dungeon: local }: HeroPlace,
  basic: boolean
): Scope | Blocker => {
  const dungeon = hero.dungeon_run?.dungeon ?? (basic ? basic_mode.dungeon : local)
  if (!dungeon || !content_catalog.dungeon(dungeon)) return 'city_required'
  return dungeon_world(dungeon) === world ? { area: { world }, dungeon } : 'world_required'
}
const SCOPES: Readonly<Record<DappActivity, typeof raid_scope>> = {
  train: (_hero, { world, city }) => (city ? { area: { world, city } } : 'city_required'),
  // Gathering keeps the whole observed world.
  gather: (_hero, { world }) => ({ area: { world } }),
  raid: raid_scope,
}

type Assessed = Readonly<{ hero: CharacterRow } & ({ scope: Scope } | { blocker: Blocker })>
/** Only an authoritative checkpoint places a hero; the dapp never picks where a hero stands. */
const assess = (activity: DappActivity, hero: Readonly<CharacterRow>, bag_known: boolean, basic: boolean): Assessed => {
  const { ambush, dungeon_run } = hero
  // A hero inside a dungeon run can only go on with that raid.
  const resuming = activity === 'raid' && Boolean(dungeon_run)
  const held = [Boolean(hero.active_fight), Boolean(ambush), Boolean(dungeon_run)].some(Boolean)
  if (held && !resuming) return { hero, blocker: 'hero_busy' }
  const place = hero_place(hero, city_at_position)
  // A raid spends keys, so it is planned only from a bag that is fully read.
  if (!place || (activity === 'raid' && !bag_known)) return { hero, blocker: 'hero_unknown' }
  const scope = SCOPES[activity](hero, place, basic)
  return typeof scope === 'string' ? { hero, blocker: scope } : { hero, scope }
}

type Team = Readonly<{ scope: Scope; heroes: readonly CharacterRow[] }>
const teams_of = (assessed: readonly Assessed[]): readonly Team[] => [
  ...assessed
    .reduce((teams, entry) => {
      if (!('scope' in entry)) return teams
      const key = JSON.stringify(entry.scope)
      return teams.set(key, { scope: entry.scope, heroes: [...(teams.get(key)?.heroes ?? []), entry.hero] })
    }, new Map<string, Team>())
    .values(),
]

const blocked_by = (heroes: readonly CharacterRow[], blocker: Blocker): ActivityPlan['blocked'] =>
  heroes.map(({ id }) => ({ hero_id: id, blocker }))
/**
 * A raid takes the strongest heroes up to a full fight side, then keeps those the shared key rule lets
 * in. The trees name exactly the heroes that enter, so the bot's own entry rule holds by construction.
 */
const raid_team = (dungeon: string, heroes: readonly CharacterRow[], bag: RaidBag) => {
  const ranked = strongest_first(heroes)
  const squad = ranked.slice(0, RAID_TEAM)
  const { key } = content_catalog.dungeon(dungeon)!
  const team = squad.map(({ id }) => id)
  const able = raid_entrants({ dungeon, key, team, heroes: squad, bag })
  const keyless = squad.filter(({ id }) => !able.includes(id))
  return {
    entering: squad.filter(({ id }) => able.includes(id)),
    blocked: [...blocked_by(keyless, 'key_missing'), ...blocked_by(ranked.slice(RAID_TEAM), 'team_full')],
    missing_keys: keyless.length ? { [key]: keyless.length } : {},
  }
}

type Sending = Readonly<{ activity: DappActivity; title: string; basic: boolean; bag: RaidBag | null }>
/** One tree per hero, each naming its teammates. Basic binds the seed's build to a hero of its class. */
const plan_team = ({ scope, heroes }: Team, { activity, title, basic, bag }: Sending): ActivityPlan => {
  const { entering, blocked, missing_keys } = scope.dungeon
    ? raid_team(scope.dungeon, heroes, bag!)
    : { entering: heroes, blocked: [], missing_keys: {} }
  const team = entering.map(({ id, classe }) => ({ character: id, ...(basic ? basic_build(classe) : {}) }))
  const scripts = bind_team(PRESETS[activity][team.length > 1 ? 1 : 0], team, { title, ...scope })
  return {
    starts: team.map(({ character }, index) => ({ hero_id: character, script: scripts[index]! })),
    blocked,
    missing_keys,
  }
}

/** Blockers are found before any tree exists; heroes that share a scope go together as one team. */
export const plan_activity = (
  activity: DappActivity,
  heroes: readonly CharacterRow[],
  bag: RaidBag | null,
  title: string,
  basic: boolean
): ActivityPlan => {
  const assessed = heroes.map((hero) => assess(activity, hero, bag !== null, basic))
  const plans = teams_of(assessed).map((team) => plan_team(team, { activity, title, basic, bag }))
  return {
    starts: plans.flatMap(({ starts }) => starts),
    blocked: [
      ...assessed.flatMap((entry) => ('blocker' in entry ? [{ hero_id: entry.hero.id, blocker: entry.blocker }] : [])),
      ...plans.flatMap(({ blocked }) => blocked),
    ],
    missing_keys: Object.fromEntries(plans.flatMap(({ missing_keys }) => Object.entries(missing_keys))),
  }
}
