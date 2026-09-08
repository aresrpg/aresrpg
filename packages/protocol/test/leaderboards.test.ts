// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { LEADERBOARD_METRICS, parse_client_packet } from '../src/packets.ts'

test('every leaderboard category has an explicit observed season and request identity', () => {
  for (const metric of LEADERBOARD_METRICS) {
    const packet = { type: 'packet/leaderboard_observe' as const, observation: { metric, season: null, id: 1 } }
    expect(parse_client_packet(JSON.stringify(packet))).toEqual(packet)
  }
  expect(parse_client_packet('{"type":"packet/leaderboard_observe","observation":null}')).toEqual({
    type: 'packet/leaderboard_observe',
    observation: null,
  })
})

test('unbounded, negative, fractional and malformed leaderboard selections never reach a read', () => {
  const valid = { metric: 'xp', season: null, id: 1 }
  for (const observation of [
    undefined,
    [],
    {},
    { ...valid, metric: 'unknown' },
    { ...valid, season: -1 },
    { ...valid, season: '1' },
    { ...valid, season: 1.5 },
    { ...valid, id: -1 },
    { ...valid, id: 1e20 },
  ]) {
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/leaderboard_observe', observation }))).toThrow()
  }
})
