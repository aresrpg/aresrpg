// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { city_at_position, client_world_position, world_biome_at_zone } from '@aresrpg/engine/data'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { ZONE_SIZE, type CharacterRow } from '@aresrpg/protocol'
import { bind_strategy, bind_team, difficulties, hero_place, strategies } from '@aresrpg/protocol/strategies'

import { parse_behavior_script } from '../../../bot/src/behavior_script.ts'
import dungeons from '../../../../seed/content/dungeons.json'
import worlds from '../../../../seed/content/worlds.json'
import {
  plan_start,
  raid_able,
  spec_valid,
  stands_in,
  work_tool,
  RAID_TEAM,
  type StartSpec,
  type WorkPick,
} from '../../src/dapp/strategies.ts'
import { account_bag } from '../../src/dapp/account.ts'

import { HERO, account_fixture, character_fixture, hero_id, item_fixture } from './fixtures.ts'

const [thebes, ruins] = worlds.find(({ world }) => world === 'nauvis')!.cities
const { dungeon, key } = dungeons.find((row) => row.dungeon === thebes!.dungeon)!
const tangled = dungeons.find((row) => row.dungeon === ruins!.dungeon)!
const [SECOND, THIRD] = [hero_id('2'), hero_id('3')]
type Hero = CharacterRow
const at = (id: string, x: number, z: number, row: Partial<CharacterRow> = {}) =>
  character_fixture({ id, classe: 'senshi', world: 'nauvis', checkpoint_world: 'nauvis', x, z, ...row })
const placed = (id: string, city = thebes!, row: Partial<CharacterRow> = {}) => at(id, city.x, city.z, row)
/** Far from every city: 10,000 blocks from the world centre, where the hard groups roam. */
const in_wild = (id = HERO) => at(id, 50_000, 60_000)
const area = { world: 'nauvis', city: thebes!.city }
const bag = (keys: number, more: Parameters<typeof account_fixture>[0] = {}) =>
  account_bag(account_fixture({ items: keys ? [item_fixture(key, keys)] : [], ...more }))
const ids = (heroes: readonly Hero[]) => heroes.map(({ id }) => id)
const NO_CAP = { fee_cap_mist: null }
const train = (heroes: readonly Hero[], more: Partial<Extract<StartSpec, { activity: 'train' }>> = {}): StartSpec => ({
  activity: 'train',
  hero_ids: ids(heroes),
  place: null,
  difficulty: null,
  ...NO_CAP,
  ...more,
})
const work = (heroes: readonly Hero[], pick: WorkPick = { mode: 'auto', job: null }): StartSpec => ({
  activity: 'gather',
  hero_ids: ids(heroes),
  work: pick,
  ...NO_CAP,
})
const raid = (heroes: readonly Hero[], more: Partial<Extract<StartSpec, { activity: 'raid' }>> = {}): StartSpec => ({
  activity: 'raid',
  hero_ids: ids(heroes),
  dungeon,
  runs: null,
  ...NO_CAP,
  ...more,
})
const plan = (spec: StartSpec, heroes: readonly Hero[], held = bag(0)) => plan_start(spec, heroes, held, 'Title')
/** Every tree the dapp sends is one the real bot parser accepts. */
const trees = (spec: StartSpec, heroes: readonly Hero[], held = bag(0)) =>
  plan(spec, heroes, held).starts.map(({ hero_id: hero, script }) => {
    expect(() => parse_behavior_script(script)).not.toThrow()
    return [hero, script] as const
  })
const sent = (spec: StartSpec, heroes: readonly Hero[], held = bag(0)) =>
  plan(spec, heroes, held).starts.map(({ hero_id: hero }) => hero)
const walking = (spec: StartSpec, heroes: readonly Hero[], held = bag(0)) =>
  plan(spec, heroes, held).starts.map(({ walks }) => walks)

test('a hero alone fights where it stands on the reviewed city patrol; the bot picks its work across its world', () => {
  const alone = [placed(HERO)]
  expect(trees(train(alone), alone)).toEqual([
    [HERO, bind_strategy('fight_nearby', { character: HERO, title: 'Title', area })],
  ])
  const world = { world: 'nauvis' }
  const workers = [placed(HERO), in_wild(SECOND)]
  expect(trees(work(workers), workers)).toEqual(
    [HERO, SECOND].map((character) => [
      character,
      bind_strategy('gather_craft', { character, title: 'Title', area: world }),
    ])
  )
  // A hero outside every city is not blocked: with no place chosen it fights across its world.
  expect(trees(train([in_wild()]), [in_wild()])).toEqual([
    [HERO, bind_strategy('fight_nearby', { character: HERO, title: 'Title', area: world })],
  ])
  expect(strategies.map(({ id }) => id).toSorted()).toEqual(
    ['craft_item', 'dungeon_raid', 'fight_nearby', 'gather_craft', 'gather_item', 'team_hunt'].toSorted()
  )
})

test('heroes sent together from one city hunt as a team: one tree each, naming the others as allies', () => {
  const heroes = [placed(HERO), placed(SECOND), placed(THIRD, ruins!)]
  const hunting = trees(train(heroes), heroes)
  const team = bind_team('team_hunt', [{ character: HERO }, { character: SECOND }], { title: 'Title', area })
  expect(hunting.slice(0, 2)).toEqual([
    [HERO, team[0]!],
    [SECOND, team[1]!],
  ])
  expect(JSON.stringify(hunting[0]![1].tree)).toContain(`"allies":${JSON.stringify([SECOND])}`)
  // With no place chosen, the hero standing in another city has no teammate there: it fights alone.
  expect(hunting[2]).toEqual([
    THIRD,
    bind_strategy('fight_nearby', { character: THIRD, title: 'Title', area: { world: 'nauvis', city: ruins!.city } }),
  ])
  // Only the heroes the Start names are planned, in the order the player picked them.
  expect(sent(train([heroes[1]!, heroes[0]!]), heroes)).toEqual([SECOND, HERO])
})

test('a hero outside the chosen city is not blocked: its tree carries that city and the plan says it walks first', () => {
  const heroes = [placed(HERO), placed(SECOND, ruins!), in_wild(THIRD)]
  const going = plan(train(heroes, { place: area }), heroes)
  expect(going.blocked).toEqual([])
  // One place for all three makes them one team, wherever each one stands now.
  const team = bind_team(
    'team_hunt',
    [HERO, SECOND, THIRD].map((character) => ({ character })),
    { title: 'Title', area }
  )
  expect(going.starts.map(({ script }) => script)).toEqual([...team])
  expect(going.starts.map(({ hero_id: hero, walks }) => [hero, walks])).toEqual([
    [HERO, false],
    [SECOND, true],
    [THIRD, true],
  ])
  for (const { script } of going.starts) {
    expect(() => parse_behavior_script(script)).not.toThrow()
    expect(JSON.stringify(script.tree)).toContain(JSON.stringify(area))
  }
})

test('where a hero stands is the shared helper’s answer; a biome and a distance band use the game’s own lookups', () => {
  expect(hero_place(placed(HERO), city_at_position)).toEqual({ world: 'nauvis', city: thebes!.city, dungeon })
  expect(hero_place(in_wild(), city_at_position)).toEqual({ world: 'nauvis' })
  // The first forest zone west of the centre that no city covers.
  const zones = Array.from({ length: 400 }, (_, index) => [80 + (index % 20), 80 + Math.floor(index / 20)] as const)
  const centre = (zone: number) => (zone + 0.5) * ZONE_SIZE
  const [zone_x, zone_z] = zones.find(
    ([x, z]) =>
      world_biome_at_zone('nauvis', x, z) === 'forest' &&
      !city_at_position('nauvis', ...client_world_position(centre(x), centre(z)))
  )!
  const forester = at(HERO, centre(zone_x), centre(zone_z))
  const forest = { world: 'nauvis', biome: 'forest' }
  expect(stands_in(forest, forester)).toBe(true)
  expect(stands_in({ world: 'nauvis', biome: 'desert' }, forester)).toBe(false)
  // A city is no part of a biome, and another world holds no place of this one.
  expect(stands_in(forest, placed(HERO))).toBe(false)
  expect(stands_in({ world: 'yakutia' }, placed(HERO))).toBe(false)
  expect(walking(train([forester, placed(SECOND)], { place: forest }), [forester, placed(SECOND)])).toEqual([
    false,
    true,
  ])
  // Thebes stands at the world centre, in the easy band; the wild hero stands 10,000 blocks out, in the hard one.
  expect(stands_in({ world: 'nauvis', ...difficulties.easy }, placed(HERO))).toBe(true)
  expect(stands_in({ world: 'nauvis', ...difficulties.hard }, placed(HERO))).toBe(false)
  expect(stands_in({ world: 'nauvis', ...difficulties.hard }, in_wild())).toBe(true)
  // A checkpoint the page cannot trust stands nowhere.
  expect(stands_in({ world: 'nauvis' }, character_fixture({ checkpoint_world: 'yakutia' }))).toBe(false)
})

test('a difficulty, a fee cap and a run cap reach the trees under the binder’s own names, and only when chosen', () => {
  const heroes = [placed(HERO), placed(SECOND)]
  const world = { world: 'nauvis' }
  // Nothing chosen: the scripts are exactly what the binder makes of the place alone.
  const plain = bind_team('team_hunt', [{ character: HERO }, { character: SECOND }], { title: 'Title', area })
  expect(plan(train(heroes), heroes).starts.map(({ script }) => script)).toEqual([...plain])
  expect(JSON.stringify(plain)).not.toContain('min_distance')
  // A difficulty with no place: anywhere in the hero's world at that distance, with groups of that size.
  const hard = trees(train(heroes, { difficulty: 'hard', fee_cap_mist: '5000000000' }), heroes)
  const bound = bind_team('team_hunt', [{ character: HERO }, { character: SECOND }], {
    title: 'Title',
    area: world,
    ...difficulties.hard,
    fee_cap_mist: '5000000000',
  })
  expect(hard.map(([, script]) => script)).toEqual([...bound])
  const text = JSON.stringify(hard[0]![1].tree)
  expect(text).toContain('"min_size":6,"max_size":6')
  expect(text).toContain(JSON.stringify({ world: 'nauvis', min_distance: 10_000, max_distance: 50_000 }))
  expect(text).toContain('"type":"fees_spent","op":"gte","value":"5000000000"')
  // Both heroes stand in Thebes, outside that band: each walks there first. In the easy band they stay.
  expect(walking(train(heroes, { difficulty: 'hard' }), heroes)).toEqual([true, true])
  expect(walking(train(heroes, { difficulty: 'easy' }), heroes)).toEqual([false, false])
  // A chosen place keeps its difficulty: the band narrows it.
  const [[, lone]] = trees(train([heroes[0]!], { place: area, difficulty: 'easy' }), heroes)
  expect(lone).toEqual(bind_strategy('fight_nearby', { character: HERO, title: 'Title', area, ...difficulties.easy }))
  // A raid with a run cap and a fee cap; without them the tree raids while keys last.
  const capped = trees(raid(heroes, { runs: 3, fee_cap_mist: '2000000000' }), heroes, bag(2))
  const raid_scope = { title: 'Title', area: world, dungeon }
  expect(capped.map(([, script]) => script)).toEqual([
    ...bind_team('dungeon_raid', [{ character: HERO }, { character: SECOND }], {
      ...raid_scope,
      runs: 3,
      fee_cap_mist: '2000000000',
    }),
  ])
  expect(JSON.stringify(capped[0]![1].tree)).toContain('"type":"dungeon_runs","op":"gte","value":3')
  expect(trees(raid(heroes), heroes, bag(2)).map(([, script]) => script)).toEqual([
    ...bind_team('dungeon_raid', [{ character: HERO }, { character: SECOND }], raid_scope),
  ])
  // Work carries the fee cap too.
  const [[, working]] = trees({ ...work([heroes[0]!]), fee_cap_mist: '700' }, heroes)
  expect(working).toEqual(
    bind_strategy('gather_craft', { character: HERO, title: 'Title', area: world, fee_cap_mist: '700' })
  )
})

test('a malformed cap or goal never becomes "no cap": the spec starts nothing', () => {
  const heroes = [placed(HERO)]
  const refused = (spec: StartSpec) => {
    expect(spec_valid(spec)).toBe(false)
    expect(plan(spec, heroes, bag(1))).toEqual({ starts: [], blocked: [], missing_keys: {} })
  }
  for (const fee_cap_mist of ['', '0', '-5', '1.5', 'abc', '007']) refused(train(heroes, { fee_cap_mist }))
  for (const runs of [0, -1, 1.5, Number.NaN]) refused(raid(heroes, { runs }))
  refused(raid(heroes, { dungeon: 'no_such_dungeon' }))
  refused(work(heroes, { mode: 'gather', item_type: 'wheat', goal: { kind: 'amount', amount: 0 } }))
  refused(work(heroes, { mode: 'craft', item_type: 'wheat_flour', goal: { kind: 'job_level', level: 2.5 } }))
  expect(spec_valid(train(heroes, { fee_cap_mist: '1' }))).toBe(true)
  expect(spec_valid(raid(heroes, { runs: 1 }))).toBe(true)
})

test('the player picks the dungeon and the seats: their order is kept, and a full fight side enters at most', () => {
  expect(RAID_TEAM).toBe(Number(CONTRACT_CONSTANTS.start_cells))
  expect(RAID_TEAM).toBe(6)
  /** Eight heroes of rising level: the last is the strongest. */
  const crowd = Array.from({ length: 8 }, (_, index) =>
    placed(hero_id(String(index + 1)), thebes!, { level: index + 1 })
  )
  // The weakest heroes are seated first: nothing ranks them again.
  expect(sent(raid(crowd), crowd, bag(8))).toEqual(ids(crowd.slice(0, RAID_TEAM)))
  const reversed = crowd.toReversed()
  expect(sent(raid(reversed), crowd, bag(8))).toEqual(ids(reversed.slice(0, RAID_TEAM)))
  // The dungeon is the chosen one, wherever in its world the hero stands; it walks to the gates from elsewhere.
  const at_ruins = placed(HERO, ruins!)
  const there = plan(raid([at_ruins]), [at_ruins], bag(1))
  expect(there.starts.map(({ script, walks }) => [script, walks])).toEqual([
    [
      bind_team('dungeon_raid', [{ character: HERO }], { title: 'Title', area: { world: 'nauvis' }, dungeon })[0]!,
      true,
    ],
  ])
  expect(walking(raid([placed(HERO)]), [placed(HERO)], bag(1))).toEqual([false])
  // A dungeon of another world cannot be reached: the bot has no way there.
  const far = character_fixture({ id: HERO, world: 'yakutia', checkpoint_world: 'yakutia', x: 50_000, z: 50_000 })
  expect(plan(raid([far]), [far], bag(1)).blocked).toEqual([{ hero_id: HERO, blocker: 'world_required' }])
  expect(plan(train([far], { place: area }), [far]).blocked).toEqual([{ hero_id: HERO, blocker: 'world_required' }])
  // A hero inside the chosen dungeon goes on with it, and walks nowhere; inside another one it is busy.
  const inside = placed(HERO, ruins!, { dungeon_run: { dungeon, room: 2 } })
  expect(plan(raid([inside]), [inside], bag(0)).starts.map(({ walks }) => walks)).toEqual([false])
  const elsewhere = placed(HERO, ruins!, { dungeon_run: { dungeon: tangled.dungeon, room: 2 } })
  expect(plan(raid([elsewhere]), [elsewhere], bag(1)).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_busy' }])
})

test('too few keys trim the team to the seated heroes that hold one, and the allies are exactly those', () => {
  const crowd = Array.from({ length: 6 }, (_, index) => placed(hero_id(String(index + 1))))
  const short = plan(raid(crowd), crowd, bag(2))
  const entering = [hero_id('1'), hero_id('2')]
  expect(short.starts.map(({ hero_id: hero }) => hero)).toEqual(entering)
  // The notice: who enters, who stays behind for want of a key, and how many keys are missing.
  expect(short.blocked).toEqual(
    [hero_id('3'), hero_id('4'), hero_id('5'), hero_id('6')].map((hero) => ({ hero_id: hero, blocker: 'key_missing' }))
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
  expect(plan(raid(crowd), crowd, bag(0))).toMatchObject({ starts: [], missing_keys: { [key]: 6 } })
  // The heroes a team could be proposed from: those the key rule lets in, in the order given.
  expect(ids(raid_able(dungeon, crowd.toReversed(), bag(2)))).toEqual([hero_id('6'), hero_id('5')])
  expect(raid_able(dungeon, crowd, null)).toEqual([])
  expect(raid_able('no_such_dungeon', crowd, bag(2))).toEqual([])
})

test('the key rule is the bot’s own: a listed key, another kiosk and a hero already inside', () => {
  const pair = [placed(HERO), placed(SECOND)]
  // A key listed on the market cannot be burnt: the dapp counts it out exactly as the bot does.
  const listed = bag(2, { listings: [{ id: `${key}-1` }] })
  expect(plan(raid(pair), pair, listed)).toMatchObject({ starts: [], missing_keys: { [key]: 2 } })
  // A key in another kiosk does not follow this hero.
  const other_kiosk = account_bag(account_fixture({ items: [{ ...item_fixture(key, 1), kiosk: '0xother' }] }))
  expect(plan(raid([pair[0]!]), pair, other_kiosk).starts).toEqual([])
  // A hero already inside this dungeon run goes on without a further key.
  const inside = placed(SECOND, thebes!, { dungeon_run: { dungeon, room: 2 } })
  expect(sent(raid([placed(HERO), inside]), [placed(HERO), inside], bag(1))).toEqual([HERO, SECOND])
  expect(plan(train([inside]), [inside]).blocked).toEqual([{ hero_id: SECOND, blocker: 'hero_busy' }])
  // An account the socket is still reading leaves the bag unknown: nothing is planned from it.
  const unread = account_bag(account_fixture({ items: [item_fixture(key, 1)], phase: 'loading' }))
  expect(plan(raid([pair[0]!]), pair, unread).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_unknown' }])
  const fighting = placed(SECOND, thebes!, { custody: 'fight', active_fight: { id: 'f1', seat: 0 } })
  const mixed = plan(raid([placed(HERO), fighting]), [placed(HERO), fighting], bag(1))
  expect(mixed.starts.map(({ hero_id: hero }) => hero)).toEqual([HERO])
  expect(mixed.blocked).toEqual([{ hero_id: SECOND, blocker: 'hero_busy' }])
  expect(plan(raid([]), pair, bag(1))).toEqual({ starts: [], blocked: [], missing_keys: {} })
})

const FARMER = { FARMER: '0' }
const hoe = (id = 'hoe') => ({ ...item_fixture('old_hoe', 1, id), category: 'tool_farmer' })
const worn_hoe = { ...hoe('worn'), slot: 'tool' } as unknown as CharacterRow['equipment'][number]

test('one resource: the tree names the item, the hero’s own tool and the amount to reach in its own kiosk', () => {
  const farmer = placed(HERO, thebes!, { jobs: FARMER })
  const wheat = (goal: Extract<WorkPick, { mode: 'gather' }>['goal']): WorkPick => ({
    mode: 'gather',
    item_type: 'wheat',
    goal,
  })
  const holding = bag(0, {
    items: [hoe(), item_fixture('wheat', 7), { ...item_fixture('wheat', 5, 'far'), kiosk: '0xother' }],
  })
  const until = { character: HERO, title: 'Title', area: { world: 'nauvis' }, item: 'wheat', tool: 'old_hoe' }
  expect(trees(work([farmer], wheat({ kind: 'until_stopped' })), [farmer], holding)).toEqual([
    [HERO, bind_strategy('gather_item', until)],
  ])
  // "40 more": the bot compares the hero's own kiosk, so the 7 it holds there are added. Another kiosk does not count.
  expect(trees(work([farmer], wheat({ kind: 'amount', amount: 40 })), [farmer], holding)).toEqual([
    [HERO, bind_strategy('gather_item', { ...until, target_quantity: 47 })],
  ])
  expect(trees(work([farmer], wheat({ kind: 'job_level', level: 10 })), [farmer], holding)).toEqual([
    [HERO, bind_strategy('gather_item', { ...until, job: 'FARMER', target_level: 10 })],
  ])
  // The tool it wears wins over one in the bag; a tool of another profession is none.
  const wearing = placed(HERO, thebes!, { jobs: FARMER, equipment: [worn_hoe] })
  expect(work_tool(holding!, wearing, 'FARMER')).toEqual({ item_type: 'old_hoe', worn: true })
  expect(work_tool(holding!, farmer, 'FARMER')).toEqual({ item_type: 'old_hoe', worn: false })
  expect(work_tool(holding!, farmer, 'MINER')).toBeNull()
  // A tool above the hero's level, or one a listing locks, cannot be equipped.
  const heavy = bag(0, { items: [{ ...hoe(), level: 10 }] })
  const listed = bag(0, { items: [hoe()], listings: [{ id: 'hoe' }] })
  for (const held of [bag(0), heavy, listed])
    expect(plan(work([farmer], wheat({ kind: 'until_stopped' })), [farmer], held)).toEqual({
      starts: [],
      blocked: [{ hero_id: HERO, blocker: 'tool_required' }],
      missing_keys: {},
    })
  // A resource of a higher tier than its profession level, one that grows in no world of the hero, and an unread bag.
  const blocker = (pick: WorkPick, held = holding) => plan(work([farmer], pick), [farmer], held).blocked[0]?.blocker
  expect(blocker({ mode: 'gather', item_type: 'wheat_barley', goal: { kind: 'until_stopped' } })).toBe(
    'job_level_required'
  )
  expect(blocker({ mode: 'gather', item_type: 'no_such_plant', goal: { kind: 'until_stopped' } })).toBe('work_unknown')
  const unread = account_bag(account_fixture({ items: [hoe()], phase: 'loading' }))
  expect(blocker(wheat({ kind: 'until_stopped' }), unread)).toBe('hero_unknown')
})

test('one recipe: the tree names its output and its objective; missing materials never block the start', () => {
  const baker = placed(HERO, thebes!, { jobs: FARMER })
  const flour = (goal: Extract<WorkPick, { mode: 'craft' }>['goal']): WorkPick => ({
    mode: 'craft',
    item_type: 'wheat_flour',
    goal,
  })
  const held = bag(0, { items: [item_fixture('wheat_flour', 3)] })
  const base = { character: HERO, title: 'Title', area: { world: 'nauvis' }, item: 'wheat_flour' }
  expect(trees(work([baker], flour({ kind: 'amount', amount: 10 })), [baker], held)).toEqual([
    [HERO, bind_strategy('craft_item', { ...base, target_quantity: 13 })],
  ])
  expect(trees(work([baker], flour({ kind: 'job_level', level: 5 })), [baker], bag(0))).toEqual([
    [HERO, bind_strategy('craft_item', { ...base, job: 'FARMER', target_level: 5 })],
  ])
  // A crafting hero walks nowhere, and an item with no recipe is no work.
  expect(walking(work([baker], flour({ kind: 'until_stopped' })), [baker])).toEqual([false])
  const unknown: WorkPick = { mode: 'craft', item_type: 'wheat', goal: { kind: 'until_stopped' } }
  expect(plan(work([baker], unknown), [baker]).blocked).toEqual([{ hero_id: HERO, blocker: 'work_unknown' }])
  // The bot picks inside one profession when the player names it.
  const [[, picked]] = trees(work([baker], { mode: 'auto', job: 'FARMER' }), [baker])
  expect(picked).toEqual(
    bind_strategy('gather_craft', { character: HERO, title: 'Title', area: { world: 'nauvis' }, jobs: ['FARMER'] })
  )
})

test('sad paths block before any tree exists: an unknown checkpoint and busy heroes', () => {
  const stale = character_fixture({
    id: HERO,
    world: 'nauvis',
    checkpoint_world: 'yakutia',
    x: thebes!.x,
    z: thebes!.z,
  })
  expect(plan(work([stale]), [stale])).toEqual({
    starts: [],
    blocked: [{ hero_id: HERO, blocker: 'hero_unknown' }],
    missing_keys: {},
  })
  const fighting = placed(HERO, thebes!, { custody: 'fight', active_fight: { id: 'fight', seat: 0 } })
  expect(plan(train([fighting]), [fighting]).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_busy' }])
  const ambushed = placed(HERO, thebes!, {
    ambush: { protector: 'p', x: 0, z: 0, scalar: 1, board_seed: '1', hp: '1' },
  })
  expect(plan(work([ambushed]), [ambushed]).blocked).toEqual([{ hero_id: HERO, blocker: 'hero_busy' }])
  // A hero the Start names that the account no longer holds is simply not planned.
  expect(plan(train([placed(HERO)]), [])).toEqual({ starts: [], blocked: [], missing_keys: {} })
})
