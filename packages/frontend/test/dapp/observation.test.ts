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
  expect(Object.keys(observation).toSorted()).toEqual(['direct', 'fence', 'ready', 'runs', 'sampled_at'].toSorted())
  // A run says which catalogue entry it was bound from; an authored tree says nothing.
  expect(observation.runs).toEqual({
    [HERO]: { status: 'active', issue: null, strategy: 'team_hunt' },
    [hero_id('2')]: { status: 'awaiting_ai', issue: 'no_matching_branch', strategy: null },
  })
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
