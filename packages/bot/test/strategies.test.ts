// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { gatherable_catalog, job_slugs } from '@aresrpg/immutable'
import { ZONE_SIZE, type CharacterRow, type ItemRow } from '@aresrpg/protocol'
import { bind_strategy, bind_team, difficulties, strategies, type StrategyBinding } from '@aresrpg/protocol/strategies'

import catalogue from '../../../seed/content/strategies.json'
import dungeons from '../../../seed/content/dungeons.json'
import mobs from '../../../seed/content/mobs.json'
import items from '../../../seed/content/items.json'
import worlds from '../../../seed/content/worlds.json'
import { id } from '../../sdk/test/helpers/transport.ts'
import { behavior_actor } from '../src/behavior_projection.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorScript } from '../src/behavior_script.ts'
import { DEPLOYMENT_DEFAULTS } from '../src/config.ts'
import { validate_gameplay, type GameplayContext } from '../src/gameplay.ts'
import { profession_recipes } from '../src/profession_catalog.ts'

import { character, item } from './helpers/profession_fixture.ts'
import { group_in, hero_in, run_of, world_context, WORLD } from './helpers/travel_fixture.ts'

const heroes = Array.from({ length: 6 }, (_, index) => id(index + 1))
const resource = gatherable_catalog[0]!
const tool = items.find(({ category }) => category === `tool_${resource.job.toLowerCase()}`)!
const recipe = profession_recipes[0]!
const city = worlds.find(({ world }) => world === WORLD)!.cities[0]!
const minimal: StrategyBinding = { character: heroes[0]!, title: 'Preset', area: { world: WORLD, city: city.city } }
/** What each tree cannot run without, beside the three fields every tree takes. */
const required: Readonly<Record<string, Partial<StrategyBinding>>> = {
  dungeon_raid: { dungeon: dungeons[0]!.dungeon },
  gather_item: { item: resource.item_type, tool: tool.item_type },
  craft_item: { item: recipe.output_type },
}
const full: Partial<StrategyBinding> = {
  ...difficulties.medium,
  allies: heroes.slice(1),
  dungeon: dungeons[0]!.dungeon,
  mob_types: [mobs[0]!.mob_type],
  runs: 10,
  fee_cap_mist: '10000000000',
  item: resource.item_type,
  tool: tool.item_type,
  job: resource.job,
  target_level: 12,
  target_quantity: 250,
  jobs: [resource.job],
}
const leaves = (script: BehaviorScript, type: string) => {
  const found: Record<string, unknown>[] = []
  JSON.stringify(script.tree, (_key, value: Record<string, unknown> | null) => {
    if (value?.type === type) found.push(value)
    return value
  })
  return found
}
const bound = (strategy: string, binding: Partial<StrategyBinding> = {}) =>
  parse_behavior_script(bind_strategy(strategy, { ...minimal, ...required[strategy], ...binding }))

test('every catalogue tree, bound with the least and with every field, is a tree the bot accepts for one hero', () => {
  expect(strategies.map((entry) => entry.id)).toEqual([
    'fight_nearby',
    'gather_craft',
    'team_hunt',
    'dungeon_raid',
    'gather_item',
    'craft_item',
  ])
  for (const { id: strategy } of strategies)
    for (const script of [bound(strategy), bound(strategy, full)]) {
      expect(behavior_actor(script)).toBe(heroes[0]!)
      expect(script.strategy).toBe(strategy)
      expect(JSON.stringify(script)).not.toContain('"$')
    }
  expect(() => bind_strategy('unknown', minimal)).toThrow('unknown_strategy')
  expect(() => bind_strategy('team_hunt', { ...minimal, character: '' })).toThrow('strategy_identity_required')
})

test('a tree refuses a binding that leaves out a field it cannot default', () => {
  for (const strategy of Object.keys(required))
    expect(() => bind_strategy(strategy, minimal)).toThrow('strategy_field_required')
  expect(() => bind_strategy('gather_item', { ...minimal, item: resource.item_type })).toThrow(
    'strategy_field_required'
  )
})

test('Basic mode is gone: the catalogue holds one profile, no build and no growth leaf', () => {
  expect(Object.keys(catalogue)).toEqual(['profile', 'difficulty', 'strategies'])
  const text = JSON.stringify(catalogue)
  for (const token of ['"basic"', '$growth', 'spend_points', 'best_stats', '$stats', '$spells', '$equipment'])
    expect(text).not.toContain(token)
  for (const { id: strategy } of strategies) {
    const script = bound(strategy, full)
    expect(leaves(script, 'spend_points')).toEqual([])
    expect(JSON.stringify(script.tree)).toContain(JSON.stringify(catalogue.profile))
  }
})

test('a binding that names only hero, title and area plays as before', () => {
  const every_mob = mobs.map(({ mob_type }) => mob_type)
  const patrol = bound('fight_nearby')
  for (const leaf of [...leaves(patrol, 'combat'), ...leaves(patrol, 'engage')])
    expect(leaf.target_options).toEqual({ min_size: 1, max_size: 1, mob_types: every_mob, area: minimal.area })
  const [hunt] = leaves(bound('team_hunt'), 'engage')
  expect(hunt!.target_options).toMatchObject({ min_size: 1, max_size: Number.MAX_SAFE_INTEGER, area: minimal.area })
  expect(leaves(bound('gather_craft'), 'profession')).toEqual([
    { type: 'profession', character_id: heroes[0]!, world: WORLD, order: 'best_progress', jobs: [...job_slugs] },
  ])
})

test('a team is one tree per hero: each names the others as allies and brings its own profile', () => {
  const healer = {
    version: '1',
    intent: 'Stay back.',
    combos: [{ name: 'wait', steps: [{ type: 'move', direction: 'retreat' }] }],
    rules: [{ when: { type: 'ally_present' }, combo: 'wait' }],
    fallback: 'end_turn',
  }
  const team = [{ character: heroes[0]!, profile: healer }, { character: heroes[1]! }]
  const scope = { title: 'Preset', area: minimal.area, dungeon: dungeons[0]!.dungeon, ...difficulties.hard }
  for (const strategy of ['team_hunt', 'dungeon_raid']) {
    const scripts = bind_team(strategy, team, scope).map(parse_behavior_script)
    expect(scripts.map(behavior_actor)).toEqual(heroes.slice(0, 2))
    scripts.forEach((script, index) =>
      expect(JSON.stringify(script.tree)).toContain(`"allies":${JSON.stringify([heroes[1 - index]])}`)
    )
    const [own, mate] = scripts.map((script) => JSON.stringify(script.tree))
    expect(own).toContain(JSON.stringify(healer))
    expect(mate).toContain(JSON.stringify(catalogue.profile))
  }
})

test('the script of each hero of a team of six, bound with every field, fits the bot body limit', () => {
  const team = heroes.map((hero) => ({ character: hero }))
  for (const { id: strategy } of strategies) {
    const scripts = bind_team(strategy, team, { ...minimal, ...full })
    expect(scripts).toHaveLength(6)
    for (const script of scripts)
      expect(Buffer.byteLength(JSON.stringify({ script, decision_revision: 1, observation_revision: 1 }))).toBeLessThan(
        DEPLOYMENT_DEFAULTS.BOT_MAX_BODY_BYTES!
      )
  }
})

/** A hero of the fixture, bound to a tree and evaluated once against what its bot observes. */
const hero = (binding: Partial<StrategyBinding>, strategy: string) =>
  run_of(bound(strategy, { character: character.id, ...binding }))
type Worn = CharacterRow['equipment'][number]
const stocked = (context: GameplayContext, held: readonly ItemRow[], worn: readonly Worn[] = []): GameplayContext => ({
  ...context,
  snapshot: {
    ...context.snapshot,
    characters: context.snapshot.characters.map((row) => ({ ...row, equipment: [...worn] })),
    inventory: { ...context.snapshot.inventory!, items: held },
  },
})
const owned_tool = { ...item(tool.item_type, 1, 60), category: tool.category, level: 1 }

test('each difficulty engages only the groups inside its sizes, where its distance band lies', () => {
  const { mob_type } = mobs.find(({ role }) => role !== 'protector')!
  const zone_at = (distance: number) => ({ zx: Math.floor((50_000 + distance) / ZONE_SIZE), zz: 97 })
  for (const level of Object.values(difficulties)) {
    const here = zone_at(level.min_distance + ZONE_SIZE)
    const groups = [1, 2, 3, 4, 5, 6].map((size, index) => group_in(here, index, mob_type, size))
    const context = world_context(hero_in(here), { [`${here.zx}:${here.zz}`]: groups })
    for (const strategy of ['fight_nearby', 'team_hunt']) {
      const next = next_behavior_action(hero({ area: { world: WORLD }, ...level }, strategy), null, context)
      expect(next.action?.kind).toBe('fight_engage')
      const size = groups[Number(next.action!.payload.group_index)]!.members.length
      expect(size).toBeGreaterThanOrEqual(level.min_size)
      expect(size).toBeLessThanOrEqual(level.max_size)
      expect(next.action!.payload.target_options).toMatchObject({ min_size: level.min_size, max_size: level.max_size })
    }
    // Groups outside the sizes are never engaged: the hero looks for others instead.
    const others = groups.filter(({ members }) => members.length < level.min_size || members.length > level.max_size)
    const empty = world_context(hero_in(here), { [`${here.zx}:${here.zz}`]: others })
    const idle = next_behavior_action(hero({ area: { world: WORLD }, ...level }, 'fight_nearby'), null, empty)
    expect(idle.action?.kind).not.toBe('fight_engage')
  }
})

test('a hero outside its area walks to it one zone at a time and then fights there', () => {
  const { mob_type } = mobs.find(({ role }) => role !== 'protector')!
  const home = { zx: Math.floor(city.x / ZONE_SIZE), zz: Math.floor(city.z / ZONE_SIZE) }
  const group = group_in(home, 0, mob_type, 1)
  const run = hero({}, 'fight_nearby')
  let place = { zx: home.zx + 6, zz: home.zz - 4 }
  const steps: string[] = []
  for (;;) {
    const context = world_context(hero_in(place), { [`${home.zx}:${home.zz}`]: [group] })
    const next = next_behavior_action(run, null, context)
    if (next.action?.kind !== 'world_search') {
      expect(next.action).toMatchObject({ kind: 'fight_engage', payload: { group_index: '0' } })
      break
    }
    // The walk is the ordinary search: the bot's own validator accepts it, and it carries no area fence.
    expect(next.action.payload).not.toHaveProperty('area')
    expect(validate_gameplay({ ...context, command: { ...context.command, ...next.action } }).kind).toBe('world_search')
    place = {
      zx: Math.floor(Number(next.action.payload.x) / ZONE_SIZE),
      zz: Math.floor(Number(next.action.payload.z) / ZONE_SIZE),
    }
    steps.push(`${place.zx}:${place.zz}`)
    expect(steps.length).toBeLessThan(10)
  }
  // Six zones east and four north of the city: five steps reach its edge, the diagonal first.
  expect(steps).toEqual([
    `${home.zx + 5}:${home.zz - 3}`,
    `${home.zx + 4}:${home.zz - 2}`,
    `${home.zx + 3}:${home.zz - 1}`,
    `${home.zx + 2}:${home.zz - 1}`,
    `${home.zx + 1}:${home.zz - 1}`,
  ])
})

test('a hero that cannot reach its area holds its run with the blocker and signs nothing', () => {
  const elsewhere = world_context(hero_in({ zx: 98, zz: 97 }, { world: 'yakutia', checkpoint_world: 'yakutia' }))
  for (const strategy of ['fight_nearby', 'team_hunt', 'gather_craft', 'gather_item']) {
    // The gatherer already wears its tool: nothing is left to do but go there.
    const next = next_behavior_action(
      hero({}, strategy),
      null,
      stocked(elsewhere, [], [{ ...owned_tool, slot: 'tool' }])
    )
    expect([strategy, next.state, next.issue]).toEqual([strategy, 'waiting', 'area_unreachable'])
    expect(next.action).toBeUndefined()
  }
  // A band that no zone of the chosen city lies in can never be reached either.
  const far = hero({ ...difficulties.hard }, 'fight_nearby')
  const next = next_behavior_action(far, null, world_context(hero_in({ zx: 110, zz: 97 })))
  expect(next).toMatchObject({ state: 'waiting', issue: 'area_unreachable' })
})

test('gather_item wears its tool before it harvests, and craft_item crafts one try per pass', () => {
  const gather = hero({ area: { world: WORLD } }, 'gather_item')
  const context = world_context(hero_in({ zx: 98, zz: 97 }))
  const first = next_behavior_action(gather, null, stocked(context, [owned_tool]))
  expect(first.action).toMatchObject({ kind: 'equip_item', payload: { item_id: owned_tool.id, slot: 'tool' } })
  // Without the tool the hero neither harvests nor pays for a search.
  expect(next_behavior_action(gather, null, stocked(context, [])).action).toBeUndefined()
  // Wearing it, the hero goes on to its resource: none is in view, so it waits for a zone of its area to regrow.
  const worn = { ...owned_tool, slot: 'tool' }
  expect(next_behavior_action(gather, null, stocked(context, [], [worn]))).toMatchObject({
    state: 'waiting',
    issue: 'zone_refresh_pending',
  })
  const craft = leaves(bound('craft_item'), 'call').find(({ kind }) => kind === 'craft')
  expect(craft).toEqual({
    type: 'call',
    kind: 'craft',
    payload: { character_id: heroes[0]!, output_type: recipe.output_type, attempts: 1 },
  })
})

test('an objective left out never ends a run, and a reached one ends it with its reason', () => {
  const context = stocked(world_context(hero_in({ zx: 98, zz: 97 })), [
    owned_tool,
    item(resource.item_type, 1_000_000, 61),
  ])
  for (const strategy of ['gather_item', 'craft_item']) {
    const open = next_behavior_action(hero({ area: { world: WORLD } }, strategy), null, context)
    expect(open.state).not.toBe('completed')
    const item_type = strategy === 'gather_item' ? resource.item_type : recipe.output_type
    const held = stocked(context, [owned_tool, item(item_type, 5, 62)])
    const target = { area: { world: WORLD }, target_quantity: 5 } as const
    expect(next_behavior_action(hero(target, strategy), null, held)).toMatchObject({
      state: 'completed',
      issue: 'objective_reached',
    })
    const short = next_behavior_action(hero({ ...target, target_quantity: 6 }, strategy), null, held)
    expect(short.state).not.toBe('completed')
    // A level objective reads the bound job: level one is reached by every hero.
    const level = { area: { world: WORLD }, job: resource.job, target_level: 1 } as const
    expect(next_behavior_action(hero(level, strategy), null, context)).toMatchObject({
      state: 'completed',
      issue: 'objective_reached',
    })
  }
})
