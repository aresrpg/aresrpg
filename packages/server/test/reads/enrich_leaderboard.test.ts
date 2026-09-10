// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { LeaderboardSnapshot } from '@aresrpg/protocol'

import { enrich_leaderboard } from '../../src/reads/enrich_leaderboard.ts'

const snapshot: LeaderboardSnapshot = {
  observation: { metric: 'xp', id: 1 },
  reset_at_ms: Date.UTC(2026, 9, 1),
  timestamp_ms: Date.UTC(2026, 8, 9),
  checkpoint: 10,
  entries: [0, 1].map((index) => ({
    address: `0x${index}`,
    name: null,
    rank: index + 1,
    score: '20',
    characters: [],
    character_count: 0,
    jobs: [],
  })),
  self: null,
}

test('one stalled name does not block healthy names, badges or scores', async () => {
  const stalled = Promise.withResolvers<string | null>()
  try {
    const graph = {
      read: async () => [{ address: '0x0', total: 1, characters: [{ name: 'Hero', classe: 'senshi', level: 2 }] }],
    }
    const result = await enrich_leaderboard(
      graph as never,
      (address) => (address === '0x0' ? Promise.resolve('hero.sui') : stalled.promise),
      snapshot
    )
    expect(result.entries[0]).toMatchObject({ name: 'hero.sui', score: '20', character_count: 1 })
    expect(result.entries[1]).toMatchObject({ name: null, score: '20' })
  } finally {
    stalled.resolve(null)
  }
}, 1000)
