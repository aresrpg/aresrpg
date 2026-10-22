// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { LEADERBOARD_METRICS } from '@aresrpg/protocol'
import { normalize_address } from '@aresrpg/immutable/allocation'

import { create_campaign_boards, predict_leaderboards } from '../../src/allocation/leaderboards.ts'

const address = (n: number) => normalize_address(`0x${n.toString(16)}`)
test('predictions skip reservations and cross-board duplicates and expose only requested wallets', () => {
  const reserved = [{ address: address(1), tier: 'veteran' as const, source: 'existing' as const, evidence: 'private' }]
  const snapshot = {
    observed_at: 123,
    boards: LEADERBOARD_METRICS.map((metric, index) => ({
      metric,
      addresses: [address(1), address(2), address(20 + index), address(40 + index)],
    })),
  }
  const predictions = predict_leaderboards(
    reserved,
    snapshot,
    new Set([address(1), address(2), address(40), address(99)])
  )
  expect(predictions).toEqual([
    { address: address(2), board: LEADERBOARD_METRICS[0], rank: 2, tier: 'veteran', observed_at: 123 },
    { address: address(40), board: LEADERBOARD_METRICS[0], rank: 4, tier: 'member', observed_at: 123 },
  ])
})
test('one coherent leaderboard read is shared; stale rankings never become predictions', async () => {
  let calls = 0
  // Pin time: real checkpoint snapshots carry one identical timestamp across all boards.
  const stamp = Date.now()
  const coherent = create_campaign_boards(async (observation) => {
    calls++
    return { observation, checkpoint: 1, timestamp_ms: stamp, reset_at_ms: stamp + 86400000, entries: [], self: null }
  })
  const [a, b] = await Promise.all([coherent(), coherent()])
  expect(a).toBe(b)
  expect(calls).toBe(9)
  const stale = create_campaign_boards(async (observation) => ({
    observation,
    checkpoint: 1,
    timestamp_ms: 0,
    reset_at_ms: 86400000,
    entries: [],
    self: null,
  }))
  await expect(stale()).rejects.toThrow('stale or updating')
})
