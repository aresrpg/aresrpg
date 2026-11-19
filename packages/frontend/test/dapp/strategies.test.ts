// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { city_at_position } from '@aresrpg/engine/data'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import type { CharacterRow } from '@aresrpg/protocol'
import {
  basic_build,
  basic_mode,
  bind_strategy,
  bind_team,
  dungeon_world,
  hero_place,
  strategies,
} from '@aresrpg/protocol/strategies'

import { parse_behavior_script } from '../../../bot/src/behavior_script.ts'
import dungeons from '../../../../seed/content/dungeons.json'
import worlds from '../../../../seed/content/worlds.json'
import { plan_activity, type DappActivity } from '../../src/dapp/strategies.ts'
import { account_bag } from '../../src/dapp/account.ts'

import { HERO, account_fixture, character_fixture, hero_id, item_fixture } from './fixtures.ts'

const [thebes, ruins] = worlds.find(({ world }) => world === 'nauvis')!.cities
const { dungeon, key } = dungeons.find((row) => row.dungeon === thebes!.dungeon)!
const [SECOND, THIRD] = [hero_id('2'), hero_id('3')]
const TEAM = Number(CONTRACT_CONSTANTS.start_cells)
type Hero = Parameters<typeof plan_activity>[1][number]
const placed = (id: string, city = thebes!, row: Partial<CharacterRow> = {}) =>
  character_fixture({ id, classe: 'senshi', world: 'nauvis', checkpoint_world: 'nauvis', x: city.x, z: city.z, ...row })
const in_wild = (id = HERO) =>
  character_fixture({ id, classe: 'senshi', world: 'nauvis', checkpoint_world: 'nauvis', x: 50_000, z: 60_000 })
const area = { world: 'nauvis', city: thebes!.city }
const bag = (keys: number, locked: Readonly<{ listings?: readonly object[] }> = {}) =>
  account_bag(account_fixture({ items: keys ? [item_fixture(key, keys)] : [], ...locked }))
const plan = (activity: DappActivity, heroes: readonly Hero[], keys = 0, basic = false) =>
  plan_activity(activity, heroes, bag(keys), 'Title', basic)
const trees = (activity: DappActivity, heroes: readonly Hero[], keys = 0, basic = false) =>
  plan(activity, heroes, keys, basic).starts.map(({ hero_id: hero, script }) => {
    // Every tree the dapp sends is one the real bot parser accepts.
    expect(() => parse_behavior_script(script)).not.toThrow()
    return [hero, script] as const
  })
const sent = (activity: DappActivity, heroes: readonly Hero[], keys = 0, basic = false) =>
  plan(activity, heroes, keys, basic).starts.map(({ hero_id: hero }) => hero)

test('a hero alone trains on the reviewed city patrol and gathers across its whole world', () => {
  expect(trees('train', [placed(HERO)])).toEqual([
    [HERO, bind_strategy('fight_nearby', { character: HERO, title: 'Title', area })],
  ])
  const world = { world: 'nauvis' }
  expect(trees('gather', [placed(HERO), in_wild(SECOND)])).toEqual(
    [HERO, SECOND].map((character) => [
      character,
      bind_strategy('gather_craft', { character, title: 'Title', area: world }),
    ])
  )
  expect(strategies.map(({ id }) => id)).toEqual(['fight_nearby', 'gather_craft', 'team_hunt', 'dungeon_raid'])
})

test('heroes sent together from one city hunt as a team: one tree each, naming the others as allies', () => {
  const hunting = trees('train', [placed(HERO), placed(SECOND), placed(THIRD, ruins!)])
  const team = bind_team('team_hunt', [{ character: HERO }, { character: SECOND }], { title: 'Title', area })
  expect(hunting.slice(0, 2)).toEqual([
    [HERO, team[0]!],
    [SECOND, team[1]!],
  ])
  expect(JSON.stringify(hunting[0]![1].tree)).toContain(`"allies":${JSON.stringify([SECOND])}`)
  // The hero standing in another city has no teammate there, so it trains alone.
  expect(hunting[2]).toEqual([
    THIRD,
    bind_strategy('fight_nearby', { character: THIRD, title: 'Title', area: { world: 'nauvis', city: ruins!.city } }),
  ])
})

test('where a hero stands is the shared helper’s answer, fed by the engine’s city lookup', () => {
  expect(hero_place(placed(HERO), city_at_position)).toEqual({ world: 'nauvis', city: thebes!.city, dungeon })
  expect(hero_place(in_wild(), city_at_position)).toEqual({ world: 'nauvis' })
  const [[, script]] = trees('train', [placed(HERO)])
  expect(JSON.stringify(script!.tree)).toContain(JSON.stringify({ world: 'nauvis', city: thebes!.city }))
})

test('Advanced raids the dungeon of the city its hero stands in; Basic raids the Gilded Lorito from anywhere', () => {
  const at_ruins = placed(HERO, ruins!)
  const tangled = dungeons.find((row) => row.dungeon === ruins!.dungeon)!
  const ruins_bag = account_bag(account_fixture({ items: [item_fixture(tangled.key, 1)] }))
  const [advanced] = plan_activity('raid', [at_ruins], ruins_bag, 'Title', false).starts
  expect(advanced!.script).toEqual(
    bind_team('dungeon_raid', [{ character: HERO }], {
      title: 'Title',
      area: { world: 'nauvis' },
      dungeon: ruins!.dungeon,
    })[0]!
  )
  // The same hero in Basic: the seed's target, whatever city or wilderness of that world it stands in.
  expect(basic_mode.dungeon).toBe('gilded_lorito')
  expect(dungeon_world(basic_mode.dungeon)).toBe('nauvis')
  for (const hero of [at_ruins, in_wild(), placed(HERO)]) {
    const [[, script]] = trees('raid', [hero], 1, true)
    expect(JSON.stringify(script!.tree)).toContain(`"dungeon":"${basic_mode.dungeon}"`)
    expect(JSON.stringify(script!.tree)).not.toContain(tangled.dungeon)
  }
  expect(plan('raid', [in_wild()], 1).blocked).toEqual([{ hero_id: HERO, blocker: 'city_required' }])
  // A hero of another world cannot reach it; a hero inside another dungeon goes on with that one.
  const far = character_fixture({ id: HERO, world: 'yakutia', checkpoint_world: 'yakutia', x: 50_000, z: 50_000 })
  expect(plan('raid', [far], 1, true).blocked).toEqual([{ hero_id: HERO, blocker: 'world_required' }])
  const inside = placed(HERO, ruins!, { dungeon_run: { dungeon: tangled.dungeon, room: 2 } })
  expect(JSON.stringify(trees('raid', [inside], 0, true)[0]![1].tree)).toContain(`"dungeon":"${tangled.dungeon}"`)
})

/** Eight free heroes of rising level: hero 8 is the strongest, hero 1 the weakest. */
const crowd = (count = 8, row: Partial<CharacterRow> = {}) =>
  Array.from({ length: count }, (_, index) => placed(hero_id(String(index + 1)), thebes!, { level: index + 1, ...row }))
const strongest = (count: number) => Array.from({ length: count }, (_, index) => hero_id(String(8 - index)))

test('a raid takes the strongest heroes, a full fight side at most, and tells the others the team is full', () => {
  expect(TEAM).toBe(6)
  const full = plan('raid', crowd(), 8, true)
  expect(full.starts.map(({ hero_id: hero }) => hero)).toEqual(strongest(TEAM))
  expect(full.blocked).toEqual([
    { hero_id: hero_id('2'), blocker: 'team_full' },
    { hero_id: hero_id('1'), blocker: 'team_full' },
  ])
  expect(full.missing_keys).toEqual({})
  // Equal levels: experience decides, then the id, whatever order the heroes are given in.
  const twins = [
    placed(hero_id('1'), thebes!, { level: 5, experience: '10' }),
    placed(hero_id('2'), thebes!, { level: 5, experience: '90' }),
    placed(hero_id('3'), thebes!, { level: 5, experience: '10' }),
  ]
  expect(sent('raid', twins, 2, true)).toEqual([hero_id('2'), hero_id('1')])
  expect(sent('raid', twins.toReversed(), 2, true)).toEqual([hero_id('2'), hero_id('1')])
})

test('too few keys trim the team to the strongest heroes that hold one, and the allies are exactly those', () => {
  const short = plan('raid', crowd(6), 2, true)
  const entering = [hero_id('6'), hero_id('5')]
  expect(short.starts.map(({ hero_id: hero }) => hero)).toEqual(entering)
  // The notice: who enters, who stays behind for want of a key, and how many keys are missing.
  expect(short.blocked).toEqual(
    [hero_id('4'), hero_id('3'), hero_id('2'), hero_id('1')].map((hero) => ({ hero_id: hero, blocker: 'key_missing' }))
  )
  expect(short.missing_keys).toEqual({ [key]: 4 })
  const scripts = bind_team(
    'dungeon_raid',
    entering.map((character) => ({ character })),
    { title: 'Title', area: { world: 'nauvis' }, dungeon }
  )
  expect(short.starts.map(({ script }) => script)).toEqual([...scripts])
  short.starts.forEach(({ script }, index) => {
    expect(() => parse_behavior_script(script)).not.toThrow()
    expect(JSON.stringify(script.tree)).toContain(`"allies":${JSON.stringify([entering[1 - index]])}`)
  })
  // With no key at all the raid is blocked, with the same fix.
  expect(plan('raid', crowd(6), 0, true)).toMatchObject({ starts: [], missing_keys: { [key]: 6 } })
  expect(plan('raid', [placed(HERO)], 0)).toMatchObject({ starts: [], missing_keys: { [key]: 1 } })
})

test('the key rule is the bot’s own: a listed key, another kiosk and a hero already inside', () => {
  // A key listed on the market cannot be burnt: the dapp counts it out exactly as the bot does.
  const listed = bag(2, { listings: [{ id: `${key}-1` }] })
  expect(plan_activity('raid', crowd(2), listed, 'Title', true)).toMatchObject({
    starts: [],
    missing_keys: { [key]: 2 },
  })
  // A key in another kiosk does not follow this hero.
  const elsewhere = account_bag(account_fixture({ items: [{ ...item_fixture(key, 1), kiosk: '0xother' }] }))
  expect(plan_activity('raid', [placed(HERO)], elsewhere, 'Title', false).starts).toEqual([])
  // A hero already inside this dungeon run goes on without a further key.
  const inside = placed(SECOND, thebes!, { dungeon_run: { dungeon, room: 2 } })
  expect(sent('raid', [placed(HERO), inside], 1)).toEqual([HERO, SECOND])
  expect(plan('train', [inside]).blocked).toEqual([{ hero_id: SECOND, blocker: 'hero_busy' }])
  // An account the socket is still reading leaves the bag unknown: nothing is planned from it.
  const unread = account_bag(account_fixture({ items: [item_fixture(key, 1)], phase: 'loading' }))
  expect(plan_activity('raid', [placed(HERO)], unread, 'Title', false).blocked).toEqual([
    { hero_id: HERO, blocker: 'hero_unknown' },
  ])
  const fighting = placed(SECOND, thebes!, { custody: 'fight', active_fight: { id: 'f1', seat: 0 } })
  const mixed = plan('raid', [placed(HERO), fighting], 1)
  expect(mixed.starts.map(({ hero_id: hero }) => hero)).toEqual([HERO])
  expect(mixed.blocked).toEqual([{ hero_id: SECOND, blocker: 'hero_busy' }])
  expect(plan('raid', [])).toEqual({ starts: [], blocked: [], missing_keys: {} })
})

test('Basic binds the seed’s archer build to an archer and nothing to a hero of another class', () => {
  const archer = placed(HERO, thebes!, { classe: 'yogan' })
  const warrior = placed(SECOND, thebes!, { classe: 'senshi' })
  for (const activity of ['train', 'gather', 'raid'] as const) {
    const basic = trees(activity, [archer, warrior], 2, true)
    const scope = {
      title: 'Title',
      area: activity === 'train' ? area : { world: 'nauvis' },
      ...(activity === 'raid' ? { dungeon } : {}),
    }
    const preset = { train: 'team_hunt', gather: 'gather_craft', raid: 'dungeon_raid' }[activity]
    const bound = bind_team(preset, [{ character: HERO, ...basic_build('yogan') }, { character: SECOND }], scope)
    expect(basic.map(([, script]) => script)).toEqual([...bound])
    expect(JSON.stringify(basic[0]![1].tree)).toContain('"spells":["Magic Arrow"')
    expect(JSON.stringify(basic[1]![1].tree)).not.toContain('Magic Arrow')
    // Advanced binds no build at all, even for an archer.
    const [[, advanced]] = trees(activity, [archer], 1)
    expect(JSON.stringify(advanced!.tree)).not.toContain('Magic Arrow')
    expect(JSON.stringify(advanced!.tree)).toContain('"stats":[],"spells":[]')
  }
})

test('sad paths block before any tree exists: wild training, an unknown checkpoint and busy heroes', () => {
  expect(plan('train', [in_wild()]).blocked).toEqual([{ hero_id: HERO, blocker: 'city_required' }])
  expect(plan('gather', [in_wild()]).starts).toHaveLength(1)
  const stale = character_fixture({
    id: HERO,
    world: 'nauvis',
    checkpoint_world: 'yakutia',
    x: thebes!.x,
    z: thebes!.z,
  })
  expect(plan('gather', [stale])).toEqual({
    starts: [],
    blocked: [{ hero_id: HERO, blocker: 'hero_unknown' }],
    missing_keys: {},
  })
  const fighting = placed(HERO, thebes!, { custody: 'fight', active_fight: { id: 'fight', seat: 0 } })
  expect(plan('train', [fighting]).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_busy' }])
  const ambushed = placed(HERO, thebes!, {
    ambush: { protector: 'p', x: 0, z: 0, scalar: 1, board_seed: '1', hp: '1' },
  })
  expect(plan('gather', [ambushed]).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_busy' }])
})
