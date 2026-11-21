// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { newest_observation, parse_observation, parse_revisions } from '../../src/dapp/observation.ts'

import { HERO, hero_id, observation_fixture, raw_observation, run_fixture } from './fixtures.ts'

test('the bot observation projects every hero run by hero, and nothing the game socket already owns', () => {
  const observation = observation_fixture({
    // The bot still answers chain facts; the dapp reads those from the game socket and ignores them here.
    characters: [{ id: HERO }],
    balance: { address: '0xagent', balance_mist: '1' },
    inventory: { market: { observation: { kind: 'offers' }, listings: [] } },
    runs: [
      run_fixture(HERO, 'active', undefined, 'team_hunt'),
      run_fixture(hero_id('2'), 'awaiting_ai', 'no_matching_branch'),
      { id: 'no-hero' },
    ],
  })
  expect(Object.keys(observation).toSorted()).toEqual(
    ['direct', 'ended', 'fees_mist', 'fence', 'ready', 'runs', 'sampled_at'].toSorted()
  )
  // A run says which catalogue entry it was bound from; an authored tree says nothing. An older bot
  // reports no fee and no run count: they are unknown, never zero.
  const unreported = { objective: null, fees_mist: null, dungeon_runs: null }
  expect(observation.runs).toEqual({
    [HERO]: { status: 'active', issue: null, strategy: 'team_hunt', ...unreported },
    [hero_id('2')]: { status: 'awaiting_ai', issue: 'no_matching_branch', strategy: null, ...unreported },
  })
  expect(observation.fees_mist).toBeNull()
})

test('the fees the bot paid and the runs it counted are kept, with each run\u2019s own title', () => {
  const raid = { ...run_fixture(HERO, 'active', undefined, 'dungeon_raid'), objective: { title: 'Raid' } }
  const observation = observation_fixture({
    fees_mist: '1250000000',
    // A storage rebate can make the net fee of a run negative.
    runs: [{ ...raid, fees_mist: '-42', dungeon_runs: 3 }],
  })
  expect(observation.fees_mist).toBe(1_250_000_000n)
  expect(observation.runs[HERO]).toMatchObject({ objective: 'Raid', fees_mist: -42n, dungeon_runs: 3 })
})

test('one malformed fee or run count refuses the whole status: nothing is shown beside a guess', () => {
  const run = run_fixture(HERO, 'active', undefined, 'dungeon_raid')
  for (const fees_mist of [12, '1.5', '', 'abc', null])
    expect(parse_observation(raw_observation({ fees_mist }))).toBeNull()
  for (const fees_mist of [12, '0x10', null])
    expect(parse_observation(raw_observation({ runs: [{ ...run, fees_mist }] }))).toBeNull()
  for (const dungeon_runs of [-1, 1.5, '2', null])
    expect(parse_observation(raw_observation({ runs: [{ ...run, dungeon_runs }] }))).toBeNull()
  // The figure of a run that no longer holds its hero is checked too.
  const ended = { ...run_fixture(HERO, 'completed'), fees_mist: 'oops' }
  expect(parse_observation(raw_observation({ runs: [ended] }))).toBeNull()
})

test('a run that ended by itself is told by hero with its reason; a code this page does not list explains nothing', () => {
  const ended = (hero: string, reason: unknown) => ({ ...run_fixture(hero, 'completed'), ended: reason })
  const observation = observation_fixture({
    runs: [
      run_fixture(HERO, 'active'),
      ended(hero_id('2'), 'objective_reached'),
      ended(hero_id('3'), 'a_code_added_tomorrow'),
      // The bot lists a stopped or ended run until its next pass: it gives no reason.
      run_fixture(hero_id('4'), 'completed'),
    ],
  })
  // An ended run holds no hero: it is never one of the runs.
  expect(Object.keys(observation.runs)).toEqual([HERO])
  expect(observation.ended).toEqual({ [hero_id('2')]: 'objective_reached' })
  expect(observation_fixture().ended).toEqual({})
  expect(parse_observation({ status: 'pending' })).toMatchObject({ ended: {} })
  // A malformed reason refuses the whole status, like a malformed fee.
  for (const reason of [1, true, null, {}, ['objective_reached']])
    expect(parse_observation(raw_observation({ runs: [ended(HERO, reason)] }))).toBeNull()
})

test('a pending answer is an observation that is not ready', () => {
  // The real bot answers exactly this until its authenticated baseline is ready.
  expect(parse_observation({ status: 'pending' })).toMatchObject({ ready: false, runs: {} })
  expect(observation_fixture({ ready: false }).ready).toBe(false)
})

test('malformed observations are no observation: the retired single-run shape included', () => {
  expect(parse_observation({ runs: 'no' })).toBeNull()
  expect(parse_observation(raw_observation({ event_fence: -1 }))).toBeNull()
  expect(parse_observation(raw_observation({ sampled_at: undefined }))).toBeNull()
  expect(parse_observation(null)).toBeNull()
  const retired = { ...raw_observation(), runs: undefined, run_ref: { kind: 'behavior', id: 'run-1' } }
  expect(parse_observation(retired)).toBeNull()
})

test("revisions are read apart, and two observations keep the bot's own order", () => {
  expect(parse_revisions(raw_observation())).toEqual({ decision_revision: 3, observation_revision: 10 })
  expect(parse_revisions({ status: 'pending' })).toBeNull()
  const [early, late] = [observation_fixture({ sampled_at: 5 }), observation_fixture({ sampled_at: 9 })]
  expect(newest_observation(late, early)).toBe(late)
  expect(newest_observation(early, late)).toBe(late)
  // A new owner process restarts its clock under a higher fence: it is still the later one.
  const taken_over = observation_fixture({ event_fence: 2, sampled_at: 1 })
  expect(newest_observation(late, taken_over)).toBe(taken_over)
  expect(newest_observation(taken_over, late)).toBe(taken_over)
})
