// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { strategies } from '@aresrpg/protocol/strategies'

import {
  advance_haul,
  advance_position,
  open_position,
  retained_positions,
  sync_positions,
  FINISHED_POSITIONS_KEPT,
} from '../../src/dapp/positions.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  observation_fixture,
  run_fixture,
} from './fixtures.ts'

const SECOND = hero_id('2')
/** The bot names the catalogue entry of each run: the position's activity comes from it alone. */
const gathering = (hero = HERO, status = 'active', issue?: string) => run_fixture(hero, status, issue, 'gather_craft')
const HEROES = [character_fixture()]
const opened = open_position(HERO, 'gather', 1_000, HEROES)

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
  const advanced = advance_position(opened, next)
  expect(advanced.totals).toEqual({ xp: 280n, levels: 1, job_xp: 30n, fights: ['f1'] })
  // The same hero row pushed again changes nothing, and neither does another hero's progress.
  expect(advance_position(advanced, next)).toBe(advanced)
  expect(advance_position(advanced, [{ ...next[0]! }])).toBe(advanced)
  expect(advance_position(opened, HEROES)).toBe(opened)
  expect(advance_position(opened, [character_fixture({ id: SECOND, level: 9 })])).toBe(opened)
})

test('a fresh observation finishes only the hero whose run is gone and follows every run it shows', () => {
  const heroes = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran' })]
  const both = observation_fixture({ runs: [gathering(), run_fixture(SECOND, 'active', undefined, 'team_hunt')] })
  const followed = sync_positions([opened], both, heroes, 2_000)
  expect(followed.map(({ hero_id: hero, activity, finished_ms }) => [hero, activity, finished_ms])).toEqual([
    [SECOND, 'train', null],
    [HERO, 'gather', null],
  ])
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
  expect(strategies.map(({ id }) => activities(id)[0])).toEqual(['train', 'gather', 'train', 'raid'])
  expect(activities()).toEqual([null])
  expect(activities('a_tree_of_another_client')).toEqual([null])
  // Another client replaced the tree: the followed position says what runs now.
  const replaced = observation_fixture({ runs: [run_fixture(HERO, 'active', undefined, 'dungeon_raid')] })
  expect(sync_positions([opened], replaced, HEROES, 2_000)[0]).toMatchObject({ activity: 'raid', finished_ms: null })
})

test('a blocked run keeps its reason on the position, during the run and after it ends', () => {
  const blocked = observation_fixture({ runs: [gathering(HERO, 'awaiting_ai', 'no_matching_branch')] })
  const [waiting] = sync_positions([opened], blocked, HEROES, 2_000)
  expect(waiting).toMatchObject({ finished_ms: null, issue: 'no_matching_branch' })
  // Waiting for the signing queue is ordinary play, never a blocker.
  const queued = observation_fixture({ runs: [gathering(HERO, 'waiting', 'needs_resync')] })
  expect(sync_positions([waiting!], queued, HEROES, 2_500)[0]?.issue).toBeNull()
  const [ended] = sync_positions([waiting!], observation_fixture(), HEROES, 3_000)
  expect(ended).toMatchObject({ finished_ms: 3_000, issue: 'no_matching_branch', activity: 'gather' })
  expect(sync_positions([], blocked, HEROES, 2_000)[0]).toMatchObject({
    activity: 'gather',
    issue: 'no_matching_branch',
  })
})

test('the haul folds the shared bag and the fees once, only while a hero is out', () => {
  const bag = (wheat: number, balance_mist: bigint, extra: readonly object[] = []) =>
    account_fixture({ items: [item_fixture('wheat', wheat), ...extra], balance_mist })
  expect(advance_haul(null, bag(5, 2_000_000_000n), false)).toBeNull()
  const begun = advance_haul(null, bag(5, 2_000_000_000n), true)!
  expect(begun).toMatchObject({ found: {}, spent_mist: 0n })
  const richer = bag(9, 1_999_000_000n, [item_fixture('ore', 2, 'ore-1')])
  const gained = advance_haul(begun, richer, true)!
  expect(gained).toMatchObject({ found: { wheat: 4, ore: 2 }, spent_mist: 1_000_000n })
  // The same account seen again is the same haul: no second count.
  expect(advance_haul(gained, richer, true)).toBe(gained)
  // Deposits and sales never reduce what was earned.
  const sold = advance_haul(gained, bag(1, 9_000_000_000n), true)!
  expect(sold).toMatchObject({ found: { wheat: 4, ore: 2 }, spent_mist: 1_000_000n })
  // With nobody out the bag only moves the baseline: an item sent to the bot is not a find.
  const idle = advance_haul(sold, bag(40, 8_000_000_000n), false)!
  expect(idle.found).toEqual({ wheat: 4, ore: 2 })
  expect(advance_haul(idle, bag(41, 8_000_000_000n), true)!.found).toEqual({ wheat: 5, ore: 2 })
  // An account being read again proves nothing about the bag.
  expect(advance_haul(gained, { ...bag(50, 1n), phase: 'loading' }, true)).toBe(gained)
})

test('a key this page bought is not a find; a key a hero wins on top of it is', () => {
  const bag = (keys: number) => account_fixture({ items: [item_fixture('key', keys)], balance_mist: 1n })
  const purchase = { id: 'order', item_type: 'key', amount: 1 }
  const begun = advance_haul(null, bag(1), true, purchase)!
  // The purchase lands: the bag goes from one key to two, and nothing was found.
  const landed = advance_haul(begun, bag(2), true, purchase)!
  expect(landed.found).toEqual({})
  // A third key is above what was bought: that one is a find.
  expect(advance_haul(landed, bag(3), true, purchase)!.found).toEqual({ key: 1 })
  // Both in one push: only the unit above the purchase counts.
  expect(advance_haul(begun, bag(3), true, purchase)!.found).toEqual({ key: 1 })
  // The same gain with no purchase of this page is a find, as before.
  expect(advance_haul(begun, bag(2), true)!.found).toEqual({ key: 1 })
  // The bought key is spent on a raid, then a hero wins one: that key is a find, the purchase is used up.
  const spent = advance_haul(landed, bag(1), true, purchase)!
  expect(advance_haul(spent, bag(2), true, purchase)!.found).toEqual({ key: 1 })
  // A key spent before the purchase lands changes nothing: the unit that arrives is still the purchase.
  const early = advance_haul(advance_haul(begun, bag(0), true, purchase)!, bag(1), true, purchase)!
  expect(early.found).toEqual({})
  // A second order is a second purchase.
  const again = { ...purchase, id: 'next' }
  expect(advance_haul(landed, bag(3), true, again)!.found).toEqual({})
})

test('running positions stay; finished ones keep the newest within the review limit', () => {
  const finished = Array.from({ length: FINISHED_POSITIONS_KEPT + 2 }, (_, index) => ({
    ...opened,
    id: `f${index}`,
    finished_ms: index,
  }))
  const retained = retained_positions([...finished, opened])
  expect(retained[0]).toBe(opened)
  expect(retained.length).toBe(FINISHED_POSITIONS_KEPT + 1)
  expect(retained.map(({ id }) => id)).not.toContain('f0')
})
