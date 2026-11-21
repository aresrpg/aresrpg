// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow, FightResolutionRow } from '@aresrpg/protocol'
import { strategies } from '@aresrpg/protocol/strategies'

import {
  advance_position,
  finish_position,
  open_position,
  retained_positions,
  sync_positions,
  FIGHT_RESULTS_KEPT,
  FINISHED_POSITIONS_KEPT,
} from '../../src/dapp/positions.ts'
import type { StartSpec } from '../../src/dapp/strategies.ts'

import { HERO, character_fixture, hero_id, observation_fixture, run_fixture } from './fixtures.ts'

const SECOND = hero_id('2')
/** The bot names the catalogue entry of each run: the position's activity comes from it alone. */
const gathering = (hero = HERO, status = 'active', issue?: string) => run_fixture(hero, status, issue, 'gather_craft')
const HEROES = [character_fixture()]
const SPEC: StartSpec = { activity: 'gather', hero_ids: [HERO], work: { mode: 'auto', job: null }, fee_cap_mist: null }
const opened = open_position(HERO, 1_000, HEROES, { activity: 'gather', sent: SPEC })
const seen = (characters: readonly CharacterRow[], resolutions: readonly FightResolutionRow[] = []) => ({
  characters,
  resolutions,
})
/** An ended fight of one hero as the game server lists it until the seat is settled. */
const resolution = (fight: string, overrides: Partial<FightResolutionRow> = {}): FightResolutionRow => ({
  fight,
  world: 'nauvis',
  dungeon: null,
  dungeon_room: null,
  kolizeum: null,
  fighter: 0,
  character: HERO,
  team: 0,
  winner: 0,
  dead: false,
  settled: false,
  boss_weight: 0,
  kares: '0',
  loot_types: [],
  drops: [],
  ...overrides,
})

test('a position folds what its own hero won: XP, levels, job XP and fights', () => {
  const next = [
    character_fixture({
      level: 4,
      experience: '400',
      jobs: { miner: '70' },
      custody: 'fight',
      active_fight: { id: 'f1', seat: 0 },
    }),
  ]
  const advanced = advance_position(opened, seen(next))
  expect(advanced.totals).toEqual({ xp: 280n, levels: 1, job_xp: 30n, fights: ['f1'], won: [], lost: [] })
  // The same hero row pushed again changes nothing, and neither does another hero's progress.
  expect(advance_position(advanced, seen(next))).toBe(advanced)
  expect(advance_position(advanced, seen([{ ...next[0]! }]))).toBe(advanced)
  expect(advance_position(opened, seen(HEROES))).toBe(opened)
  expect(advance_position(opened, seen([character_fixture({ id: SECOND, level: 9 })]))).toBe(opened)
})

test('a fight result is told once, whatever the game server pushes again, and its loot joins it', () => {
  // The winner is not known yet: nothing is told.
  const fought = advance_position(opened, seen(HEROES, [resolution('f1', { winner: null })]))
  expect(fought).toBe(opened)
  const won = advance_position(opened, seen(HEROES, [resolution('f1')]))
  expect(won.results).toEqual([{ fight: 'f1', won: true, room: null, drops: [] }])
  expect(won.totals).toMatchObject({ won: ['f1'], lost: [] })
  // The same list pushed again, in new rows, is the same position.
  expect(advance_position(won, seen(HEROES, [resolution('f1')]))).toBe(won)
  // The loot is rolled after the result: it joins the fight already told, and the fight is not counted again.
  const drops = [{ item_type: 'wheat', qty: 2 }]
  const looted = advance_position(won, seen(HEROES, [resolution('f1', { drops })]))
  expect(looted.results).toEqual([{ fight: 'f1', won: true, room: null, drops }])
  expect(looted.totals.won).toEqual(['f1'])
  // A lost room fight of a dungeon, and another hero's fight that is not this position's.
  const rows = [
    resolution('f1', { drops }),
    resolution('f2', { winner: 1, dungeon: 'gilded_lorito', dungeon_room: 3 }),
    resolution('f3', { character: SECOND }),
  ]
  const lost = advance_position(looted, seen(HEROES, rows))
  expect(lost.results.at(-1)).toEqual({ fight: 'f2', won: false, room: 3, drops: [] })
  expect(lost.totals).toMatchObject({ won: ['f1'], lost: ['f2'] })
  // A settled fight leaves the server's list: what the page saw stays.
  expect(advance_position(lost, seen(HEROES))).toBe(lost)
})

test('a long run keeps its latest results only, and still counts every fight once', () => {
  const fights = Array.from({ length: FIGHT_RESULTS_KEPT + 3 }, (_, index) => resolution(`f${index}`))
  const long = advance_position(opened, seen(HEROES, fights))
  expect(long.results).toHaveLength(FIGHT_RESULTS_KEPT)
  expect(long.results.at(-1)!.fight).toBe(`f${FIGHT_RESULTS_KEPT + 2}`)
  expect(long.totals.won).toHaveLength(FIGHT_RESULTS_KEPT + 3)
  // An unsettled fight that left the kept list is still listed by the server: it is not told again.
  expect(advance_position(long, seen(HEROES, fights))).toBe(long)
})

test('a fresh observation finishes only the hero whose run is gone and follows every run it shows', () => {
  const heroes = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran' })]
  const both = observation_fixture({ runs: [gathering(), run_fixture(SECOND, 'active', undefined, 'team_hunt')] })
  const followed = sync_positions([opened], both, heroes, 2_000)
  expect(followed.map(({ hero_id: hero, activity, finished_ms }) => [hero, activity, finished_ms])).toEqual([
    [SECOND, 'train', null],
    [HERO, 'gather', null],
  ])
  // Only a position this page started keeps what was asked; a run found in an observation has none.
  expect(followed.map(({ sent }) => sent)).toEqual([null, SPEC])
  // Stopping one hero leaves the other running, and a finished position is never reopened by itself.
  const one_left = { ...both, runs: { [SECOND]: both.runs[SECOND]! } }
  const stopped = sync_positions(followed, one_left, heroes, 3_000)
  expect(stopped.map(({ hero_id: hero, finished_ms }) => [hero, finished_ms])).toEqual([
    [SECOND, null],
    [HERO, 3_000],
  ])
  expect(sync_positions(stopped, one_left, heroes, 4_000)).toEqual(stopped)
  // A run started again for a hero whose last position finished opens a new position.
  expect(sync_positions(stopped, both, heroes, 5_000).map(({ id }) => id)).toContain(`${HERO}:5000`)
})

test('every catalogue entry names its activity, and a tree bound from none is shown without one', () => {
  const activities = (strategy?: string) =>
    sync_positions(
      [],
      observation_fixture({ runs: [run_fixture(HERO, 'active', undefined, strategy)] }),
      HEROES,
      1_000
    ).map(({ activity }) => activity)
  expect(Object.fromEntries(strategies.map(({ id }) => [id, activities(id)[0]]))).toEqual({
    fight_nearby: 'train',
    team_hunt: 'train',
    gather_craft: 'gather',
    gather_item: 'gather',
    craft_item: 'gather',
    dungeon_raid: 'raid',
  })
  expect(activities()).toEqual([null])
  expect(activities('a_tree_of_another_client')).toEqual([null])
  // Another client replaced the tree: the followed position says what runs now.
  const replaced = observation_fixture({ runs: [run_fixture(HERO, 'active', undefined, 'dungeon_raid')] })
  expect(sync_positions([opened], replaced, HEROES, 2_000)[0]).toMatchObject({ activity: 'raid', finished_ms: null })
})

test('a position keeps what the bot says of its run: its title, the fees it paid and its dungeon runs', () => {
  const raid = { ...run_fixture(HERO, 'active', undefined, 'dungeon_raid'), objective: { title: 'Raid' } }
  const paying = (fees_mist: string, dungeon_runs: number) =>
    observation_fixture({ runs: [{ ...raid, fees_mist, dungeon_runs }] })
  const [first] = sync_positions([opened], paying('1000', 1), HEROES, 2_000)
  expect(first).toMatchObject({ objective: 'Raid', fees_mist: 1_000n, dungeon_runs: 1 })
  // The same status seen again is the same position; a new figure is a new one.
  expect(sync_positions([first!], paying('1000', 1), HEROES, 2_100)[0]).toBe(first)
  const [second] = sync_positions([first!], paying('2500', 2), HEROES, 2_200)
  expect(second).toMatchObject({ fees_mist: 2_500n, dungeon_runs: 2 })
  // The run ended and left the status: the finished position keeps its last figures.
  expect(sync_positions([second!], observation_fixture(), HEROES, 3_000)[0]).toMatchObject({
    finished_ms: 3_000,
    fees_mist: 2_500n,
    dungeon_runs: 2,
  })
})

test('a run that ended by itself finishes its position with the reason; a stop and a run that is only gone give none', () => {
  const [running] = sync_positions([opened], observation_fixture({ runs: [gathering()] }), HEROES, 2_000)
  expect(running).toMatchObject({ finished_ms: null, ended: null })
  const ended_with = (reason: string) =>
    observation_fixture({ runs: [{ ...gathering(HERO, 'completed'), ended: reason }] })
  const reached = ended_with('objective_reached')
  const [finished] = sync_positions([running!], reached, HEROES, 3_000)
  expect(finished).toMatchObject({ finished_ms: 3_000, ended: 'objective_reached', activity: 'gather', sent: SPEC })
  // The bot keeps telling the ending until the hero starts again: the same status changes nothing,
  // and an ending this page did not follow opens no position.
  expect(sync_positions([finished!], reached, HEROES, 4_000)[0]).toBe(finished)
  expect(sync_positions([], reached, HEROES, 4_000)).toEqual([])
  // A run that is only gone, and a reason this page does not list, are a plain end.
  expect(sync_positions([running!], observation_fixture(), HEROES, 3_000)[0]).toMatchObject({
    finished_ms: 3_000,
    ended: null,
  })
  expect(sync_positions([running!], ended_with('a_code_added_tomorrow'), HEROES, 3_000)[0]).toMatchObject({
    finished_ms: 3_000,
    ended: null,
  })
  // A position the player stopped earlier never takes the reason of a later run of that hero.
  const stopped = finish_position(running!, 2_500)
  expect(stopped.ended).toBeNull()
  expect(sync_positions([stopped], reached, HEROES, 3_000)[0]).toBe(stopped)
  // The hero is sent again: its new position starts with no ending.
  const again = sync_positions([finished!], observation_fixture({ runs: [gathering()] }), HEROES, 5_000)
  expect(again.map(({ finished_ms, ended }) => [finished_ms, ended])).toEqual([
    [null, null],
    [3_000, 'objective_reached'],
  ])
})

test('a blocked run keeps its reason on the position, during the run and after it ends', () => {
  const blocked = observation_fixture({ runs: [gathering(HERO, 'awaiting_ai', 'no_matching_branch')] })
  const [waiting] = sync_positions([opened], blocked, HEROES, 2_000)
  expect(waiting).toMatchObject({ finished_ms: null, notice: 'plan', wait: null, issue: 'no_matching_branch' })
  // Waiting for the signing queue is ordinary play, never a blocker: it is a wait with its diagnostic code.
  const queued = observation_fixture({ runs: [gathering(HERO, 'waiting', 'needs_resync')] })
  expect(sync_positions([waiting!], queued, HEROES, 2_500)[0]).toMatchObject({
    notice: null,
    wait: 'other',
    issue: 'needs_resync',
  })
  const [ended] = sync_positions([waiting!], observation_fixture(), HEROES, 3_000)
  expect(ended).toMatchObject({ finished_ms: 3_000, notice: 'plan', issue: 'no_matching_branch', activity: 'gather' })
  expect(sync_positions([], blocked, HEROES, 2_000)[0]).toMatchObject({
    activity: 'gather',
    notice: 'plan',
    issue: 'no_matching_branch',
  })
})

test('a waiting run says which help it needs, or why it waits by itself, and a finished one waits for nothing', () => {
  const noticed = (issue?: string, status = 'waiting') =>
    sync_positions([opened], observation_fixture({ runs: [gathering(HERO, status, issue)] }), HEROES, 2_000)[0]!
  expect(noticed('funding_required')).toMatchObject({ notice: 'funding', wait: null, issue: 'funding_required' })
  expect(noticed('gathering_tool_required')).toMatchObject({ notice: 'requirement', wait: null })
  // A hero that walks, a place it cannot reach, and any other wait: none of them is a blocker.
  expect(noticed('travel_not_ready')).toMatchObject({ notice: null, wait: 'travel', issue: 'travel_not_ready' })
  expect(noticed('area_unreachable')).toMatchObject({ notice: 'place', wait: null })
  expect(noticed('command_failed')).toMatchObject({ notice: null, wait: 'other' })
  expect(noticed()).toMatchObject({ notice: null, wait: 'other', issue: null })
  // A code this page does not know, or one that names a property of every object, is still only a wait.
  expect(noticed('constructor').wait).toBe('other')
  // A run that plays waits for nothing.
  expect(noticed(undefined, 'active')).toBe(opened)
  const walking = noticed('travel_not_ready')
  expect(sync_positions([walking], observation_fixture(), HEROES, 3_000)[0]).toMatchObject({
    finished_ms: 3_000,
    wait: null,
  })
})

test('finished positions beyond the review limit drop the oldest; running ones always stay', () => {
  const finished = Array.from({ length: FINISHED_POSITIONS_KEPT + 2 }, (_, index) => ({
    ...open_position(hero_id(String(index + 1)), index, []),
    finished_ms: index + 10,
  }))
  const kept = retained_positions([...finished, opened])
  expect(kept[0]).toBe(opened)
  expect(kept).toHaveLength(FINISHED_POSITIONS_KEPT + 1)
  expect(kept.at(-1)!.finished_ms).toBe(12)
})
