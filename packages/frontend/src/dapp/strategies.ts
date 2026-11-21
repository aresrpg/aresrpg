// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_at_position, world_biome_at_zone } from '@aresrpg/engine/data'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { craft_required_level, tier_unlock_level } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import {
  area_contains,
  bind_team,
  difficulties,
  dungeon_world,
  hero_place,
  raid_entrants,
  type BoundArea,
  type HeroPlace,
  type RaidBag,
  type StrategyArea,
  type StrategyDifficulty,
  type StrategyScope,
  type StrategyScript,
} from '@aresrpg/protocol/strategies'

import { content_catalog } from '../content/catalog.ts'

import { hero_items, job_level } from './account.ts'

export type DappActivity = 'train' | 'gather' | 'raid'
/** One of the three difficulty levels of the shared catalogue: group sizes and how far out they are. */
export type Difficulty = keyof typeof difficulties
/** When a working hero stops by itself. A hero with no goal works until it is stopped. */
export type WorkGoal = Readonly<
  | { kind: 'until_stopped' }
  /** How many more of the item than the hero's own kiosk holds now. */
  | { kind: 'amount'; amount: number }
  | { kind: 'job_level'; level: number }
>
/** What a hero works on. `auto` lets the bot pick, inside one profession when `job` names it. */
export type WorkPick = Readonly<
  | { mode: 'auto'; job: string | null }
  | { mode: 'gather'; item_type: string; goal: WorkGoal }
  | { mode: 'craft'; item_type: string; goal: WorkGoal }
>
/** Where a fight quest goes: a world, one city or one biome of it. Null: where each hero stands. */
export type QuestPlace = StrategyArea | null
/**
 * Exactly what one Start asked for. A fee cap is the SUI, in MIST, one hero's run may pay in network
 * fees before it ends; `runs` is how many dungeon runs one hero sees end before its raid ends. Both
 * count per hero, and null means no cap.
 */
export type StartSpec = Readonly<
  (
    | { activity: 'train'; place: QuestPlace; difficulty: Difficulty | null }
    | { activity: 'gather'; work: WorkPick }
    | { activity: 'raid'; dungeon: string; runs: number | null }
  ) & { hero_ids: readonly string[]; fee_cap_mist: string | null }
>
export type Blocker =
  | 'hero_busy'
  | 'hero_unknown'
  | 'world_required'
  | 'key_missing'
  | 'work_unknown'
  | 'job_level_required'
  | 'tool_required'
/** What one Start would do: the seed-authored tree of every hero that can go, and why the others cannot. */
export type ActivityPlan = Readonly<{
  /** `walks`: the hero stands outside the place it is sent to, so its tree walks it there first. */
  starts: readonly Readonly<{ hero_id: string; script: StrategyScript; walks: boolean }>[]
  blocked: readonly Readonly<{ hero_id: string; blocker: Blocker }>[]
  /** Dungeon keys the heroes left out of a raid team still need, by item type. */
  missing_keys: Readonly<Record<string, number>>
}>
export const EMPTY_PLAN: ActivityPlan = Object.freeze({ starts: [], blocked: [], missing_keys: {} })
/** Dungeon keys a plan's raid team lacks, in all: above zero, a start is confirmed first or not offered. */
export const plan_keys_missing = ({ missing_keys }: ActivityPlan): number =>
  Object.values(missing_keys).reduce((total, count) => total + count, 0)

/** A fight seats this many heroes on one side: the board's start cells, so a raid team is never larger. */
export const RAID_TEAM = Number(CONTRACT_CONSTANTS.start_cells)
/** The catalogue entries behind each activity. */
const PRESETS: Readonly<Record<DappActivity, readonly string[]>> = {
  train: ['fight_nearby', 'team_hunt'],
  gather: ['gather_craft', 'gather_item', 'craft_item'],
  raid: ['dungeon_raid'],
}
const ACTIVITIES = Object.keys(PRESETS) as readonly DappActivity[]
/** The activity of a run, from the catalogue entry the bot says its tree was bound from. */
export const strategy_activity = (strategy: string | null): DappActivity | null =>
  ACTIVITIES.find((activity) => strategy !== null && PRESETS[activity].includes(strategy)) ?? null

/** A cap is a positive whole number: a fee as decimal MIST, runs as a count. Null is no cap. */
export const cap_valid = (cap: string | number | null): boolean => cap === null || /^[1-9]\d*$/.test(String(cap))
const goal_valid = (goal: WorkGoal): boolean =>
  goal.kind === 'until_stopped' || cap_valid(goal.kind === 'amount' ? goal.amount : goal.level)
const SPEC_RULES: { readonly [K in DappActivity]: (spec: Extract<StartSpec, { activity: K }>) => boolean } = {
  train: () => true,
  gather: ({ work }) => work.mode === 'auto' || goal_valid(work.goal),
  raid: ({ dungeon, runs }) => content_catalog.dungeon(dungeon) !== null && cap_valid(runs),
}
/** A malformed cap or goal never becomes "no cap": such a spec starts nothing. */
export const spec_valid = (spec: StartSpec): boolean =>
  cap_valid(spec.fee_cap_mist) && (SPEC_RULES[spec.activity] as (spec: StartSpec) => boolean)(spec)

export const AREA_LOOKUPS = { city_at: city_at_position, biome_at: world_biome_at_zone } as const
/** Whether a hero's checkpoint lies inside a place, by the shared area rule: outside it, the tree walks first. */
export const stands_in = (
  area: BoundArea,
  { world, checkpoint_world, x, z }: Readonly<Pick<CharacterRow, 'world' | 'checkpoint_world' | 'x' | 'z'>>
): boolean => world === checkpoint_world && area_contains(area, world ?? '', x ?? NaN, z ?? NaN, AREA_LOOKUPS)

/** What heroes sent together share. Heroes with the same scope go as one team. */
type Scope = Readonly<{
  /** The tree a hero plays alone, then the one heroes play together. */
  preset: readonly [alone: string, together: string]
  binding: Omit<StrategyScope, 'title'>
  /** Where the tree walks its hero before anything else; null for a tree that walks nowhere. */
  walk_to: BoundArea | null
}>
type Spec<K extends DappActivity> = Extract<StartSpec, { activity: K }>
type Hero = Readonly<CharacterRow>
const fee_cap = ({ fee_cap_mist }: StartSpec) => (fee_cap_mist === null ? {} : { fee_cap_mist })

/** No place: each hero fights where it stands, its city or else its world. A difficulty is a distance
 * from the world centre, so without a place it sends the hero anywhere in its world at that distance. */
const train_scope = (_hero: Hero, { world, city }: HeroPlace, spec: Spec<'train'>): Scope | Blocker => {
  const own: StrategyArea = city && !spec.difficulty ? { world, city } : { world }
  const area = spec.place ?? own
  // The bot has no way to another world: a hero is sent only inside its own.
  if (area.world !== world) return 'world_required'
  const level: Partial<StrategyDifficulty> = spec.difficulty ? difficulties[spec.difficulty] : {}
  const { min_distance, max_distance } = level
  return {
    preset: ['fight_nearby', 'team_hunt'],
    binding: { area, ...level, ...fee_cap(spec) },
    walk_to: { ...area, min_distance, max_distance },
  }
}

/** The tool a hero harvests with: the one it wears, else the best one its own kiosk holds that it can
 * wear. The tree equips a held one before the first harvest. Null when the hero has none. */
export const work_tool = (
  bag: RaidBag,
  hero: Hero,
  job: string
): Readonly<{ item_type: string; worn: boolean }> | null => {
  const category = `tool_${job.toLowerCase()}`
  const worn = hero.equipment.find((item) => item.slot === 'tool' && item.category === category)
  if (worn) return { item_type: worn.item_type, worn: true }
  const [held] = hero_items(bag, hero.kiosk)
    .filter((item) => item.category === category && item.level <= hero.level)
    .toSorted((left, right) => right.level - left.level || left.id.localeCompare(right.id))
  return held ? { item_type: held.item_type, worn: false } : null
}
/** An amount is "that many more": the bot compares the hero's own kiosk, so the count held now is added. */
const goal_fields = (goal: WorkGoal, target: Readonly<{ job: string; held: number }>) => {
  if (goal.kind === 'amount') return { target_quantity: target.held + goal.amount }
  return goal.kind === 'job_level' ? { job: target.job, target_level: goal.level } : {}
}
/** Units of one item in a hero's own kiosk: what the bot's quantity fact counts. */
export const held_in_kiosk = (bag: RaidBag, hero: Hero, item_type: string): number =>
  hero_items(bag, hero.kiosk)
    .filter((item) => item.item_type === item_type)
    .reduce((total, { amount }) => total + amount, 0)

type Work<M extends WorkPick['mode']> = Extract<WorkPick, { mode: M }>
type WorkScope<M extends WorkPick['mode']> = (
  hero: Hero,
  place: HeroPlace,
  work: Work<M>,
  bag: RaidBag
) => Scope | Blocker
/** A hero harvests a resource of its own world, at the level its tier opens, with a tool of its job. */
const gather_scope: WorkScope<'gather'> = (hero, { world }, { item_type, goal }, bag) => {
  const resource = content_catalog.world(world)?.resources.find((row) => row.item_type === item_type)
  if (!resource) return 'work_unknown'
  const { job, tier } = resource
  if (job_level(hero, job) < tier_unlock_level(tier)) return 'job_level_required'
  const tool = work_tool(bag, hero, job)
  if (!tool) return 'tool_required'
  const held = held_in_kiosk(bag, hero, item_type)
  return {
    preset: ['gather_item', 'gather_item'],
    // The whole world of the hero is its area, so it never stands outside it.
    binding: { area: { world }, item: item_type, tool: tool.item_type, ...goal_fields(goal, { job, held }) },
    walk_to: null,
  }
}
/** A hero crafts a recipe of the level its ingredient count opens. Missing materials never block a
 * start: the run waits for them and continues by itself. */
const craft_scope: WorkScope<'craft'> = (hero, { world }, { item_type, goal }, bag) => {
  const recipe = content_catalog.item(item_type)?.recipe
  if (!recipe) return 'work_unknown'
  const { job, ingredients } = recipe
  if (job_level(hero, job) < craft_required_level(ingredients.length)) return 'job_level_required'
  const held = held_in_kiosk(bag, hero, item_type)
  return {
    preset: ['craft_item', 'craft_item'],
    binding: { area: { world }, item: item_type, ...goal_fields(goal, { job, held }) },
    walk_to: null,
  }
}
const WORK_SCOPES: { readonly [M in WorkPick['mode']]: WorkScope<M> } = {
  // The bot picks across its whole world; a named profession narrows what it picks from.
  auto: (_hero, { world }, { job }) => ({
    preset: ['gather_craft', 'gather_craft'],
    binding: { area: { world }, ...(job === null ? {} : { jobs: [job] }) },
    walk_to: null,
  }),
  gather: gather_scope,
  craft: craft_scope,
}
const gather = (hero: Hero, place: HeroPlace, spec: Spec<'gather'>, bag: RaidBag | null): Scope | Blocker => {
  const scope = (WORK_SCOPES[spec.work.mode] as WorkScope<WorkPick['mode']>)(hero, place, spec.work, bag!)
  return typeof scope === 'string' ? scope : { ...scope, binding: { ...scope.binding, ...fee_cap(spec) } }
}

/** A dungeon is entered from its own world; the bot walks the hero to its portal from anywhere in it. */
const raid_scope = (_hero: Hero, { world }: HeroPlace, spec: Spec<'raid'>): Scope | Blocker => {
  const { dungeon, runs } = spec
  if (dungeon_world(dungeon) !== world) return 'world_required'
  const { city } = content_catalog.world(world)!.cities.find((row) => row.dungeon === dungeon)!
  return {
    preset: ['dungeon_raid', 'dungeon_raid'],
    binding: { area: { world }, dungeon, ...(runs === null ? {} : { runs }), ...fee_cap(spec) },
    walk_to: { world, city },
  }
}
type ScopeOf<K extends DappActivity> = (
  hero: Hero,
  place: HeroPlace,
  spec: Spec<K>,
  bag: RaidBag | null
) => Scope | Blocker
const SCOPES: { readonly [K in DappActivity]: ScopeOf<K> } = { train: train_scope, gather, raid: raid_scope }

/** A raid spends keys, and one resource or recipe reads the hero's own kiosk: both wait for a bag fully read. */
const needs_bag = (spec: StartSpec): boolean =>
  spec.activity === 'raid' || (spec.activity === 'gather' && spec.work.mode !== 'auto')
/** A hero that stands inside a run of this dungeon: a raid of it goes on with that run and burns no key. */
export const raid_resumes = (dungeon: string, { dungeon_run }: Readonly<Pick<CharacterRow, 'dungeon_run'>>): boolean =>
  dungeon_run?.dungeon === dungeon
/** A hero inside the chosen dungeon goes on with that run; any other fight, ambush or dungeon holds it. */
const held = (spec: StartSpec, hero: Hero): boolean => {
  const resuming = spec.activity === 'raid' && raid_resumes(spec.dungeon, hero)
  return !resuming && [Boolean(hero.active_fight), Boolean(hero.ambush), Boolean(hero.dungeon_run)].some(Boolean)
}
type Assessed = Readonly<{ hero: Hero } & ({ scope: Scope } | { blocker: Blocker })>
/** Only an authoritative checkpoint places a hero. */
const assess = (spec: StartSpec, hero: Hero, bag: RaidBag | null): Assessed => {
  if (held(spec, hero)) return { hero, blocker: 'hero_busy' }
  const place = hero_place(hero, city_at_position)
  if (!place || (needs_bag(spec) && !bag)) return { hero, blocker: 'hero_unknown' }
  const scope = (SCOPES[spec.activity] as ScopeOf<DappActivity>)(hero, place, spec, bag)
  return typeof scope === 'string' ? { hero, blocker: scope } : { hero, scope }
}

/**
 * Of the heroes given, in their order, those that could enter a dungeon now: free to go, standing in
 * its world, and let in by the shared key rule. It is what a proposed team is drawn from.
 */
export const raid_able = (
  dungeon: string,
  heroes: readonly CharacterRow[],
  bag: RaidBag | null
): readonly CharacterRow[] => {
  const spec: StartSpec = { activity: 'raid', dungeon, runs: null, fee_cap_mist: null, hero_ids: [] }
  if (!bag || !spec_valid(spec)) return []
  const free = heroes.filter((hero) => 'scope' in assess(spec, hero, bag))
  const { key } = content_catalog.dungeon(dungeon)!
  const able = raid_entrants({ dungeon, key, team: free.map(({ id }) => id), heroes: free, bag })
  return free.filter(({ id }) => able.includes(id))
}

type Team = Readonly<{ scope: Scope; heroes: readonly Hero[] }>
const teams_of = (assessed: readonly Assessed[]): readonly Team[] => [
  ...assessed
    .reduce((teams, entry) => {
      if (!('scope' in entry)) return teams
      const key = JSON.stringify(entry.scope)
      return teams.set(key, { scope: entry.scope, heroes: [...(teams.get(key)?.heroes ?? []), entry.hero] })
    }, new Map<string, Team>())
    .values(),
]

const blocked_by = (heroes: readonly Hero[], blocker: Blocker): ActivityPlan['blocked'] =>
  heroes.map(({ id }) => ({ hero_id: id, blocker }))
/**
 * A raid keeps the seats in the player's order, a full fight side at most, then keeps those the shared
 * key rule lets in. The trees name exactly the heroes that enter, so the bot's own entry rule holds by
 * construction.
 */
const raid_team = (dungeon: string, heroes: readonly Hero[], bag: RaidBag) => {
  const squad = heroes.slice(0, RAID_TEAM)
  const { key } = content_catalog.dungeon(dungeon)!
  const team = squad.map(({ id }) => id)
  const able = raid_entrants({ dungeon, key, team, heroes: squad, bag })
  const keyless = squad.filter(({ id }) => !able.includes(id))
  return {
    entering: squad.filter(({ id }) => able.includes(id)),
    blocked: blocked_by(keyless, 'key_missing'),
    missing_keys: keyless.length ? { [key]: keyless.length } : {},
  }
}

/** One tree per hero, each naming its teammates. No start binds a build. */
const plan_team = ({ scope, heroes }: Team, title: string, bag: RaidBag | null): ActivityPlan => {
  const { binding, preset, walk_to } = scope
  const { entering, blocked, missing_keys } = binding.dungeon
    ? raid_team(binding.dungeon, heroes, bag!)
    : { entering: heroes, blocked: [], missing_keys: {} }
  const team = entering.map(({ id }) => ({ character: id }))
  const scripts = bind_team(preset[team.length > 1 ? 1 : 0], team, { title, ...binding })
  return {
    starts: entering.map((hero, index) => ({
      hero_id: hero.id,
      script: scripts[index]!,
      // A hero already inside the dungeon run walks nowhere.
      walks: walk_to !== null && !hero.dungeon_run && !stands_in(walk_to, hero),
    })),
    blocked,
    missing_keys,
  }
}

/** Blockers are found before any tree exists; heroes that share a scope go together as one team. */
export const plan_start = (
  spec: StartSpec,
  heroes: readonly CharacterRow[],
  bag: RaidBag | null,
  title: string
): ActivityPlan => {
  if (!spec_valid(spec)) return EMPTY_PLAN
  // The heroes go in the order the player picked them in.
  const picked = spec.hero_ids.flatMap((id) => heroes.find((hero) => hero.id === id) ?? [])
  const assessed = picked.map((hero) => assess(spec, hero, bag))
  const plans = teams_of(assessed).map((team) => plan_team(team, title, bag))
  return {
    starts: plans.flatMap(({ starts }) => starts),
    blocked: [
      ...assessed.flatMap((entry) => ('blocker' in entry ? [{ hero_id: entry.hero.id, blocker: entry.blocker }] : [])),
      ...plans.flatMap(({ blocked }) => blocked),
    ],
    missing_keys: Object.fromEntries(plans.flatMap(({ missing_keys }) => Object.entries(missing_keys))),
  }
}
