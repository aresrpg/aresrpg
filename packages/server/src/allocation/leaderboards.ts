// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { LEADERBOARD_METRICS, type LeaderboardObservation, type LeaderboardSnapshot } from '@aresrpg/protocol'
import {
  normalize_address,
  select_awards,
  type Award,
  type Board,
  type LeaderboardPrediction,
} from '@aresrpg/immutable/allocation'

type Snapshot = Readonly<{ boards: readonly Board[]; observed_at: number }>
export const predict_leaderboards = (
  reserved: readonly Award[],
  snapshot: Snapshot,
  addresses: ReadonlySet<string>
): readonly LeaderboardPrediction[] => {
  const selected = select_awards(reserved, snapshot.boards, []).filter((row) => row.source === 'leaderboard')
  return [...addresses].flatMap((address) => {
    if (reserved.some((row) => row.address === address)) return []
    const award = selected.find((row) => row.address === address)
    const positions = snapshot.boards.flatMap((board) => {
      const index = board.addresses.indexOf(address)
      return index < 0 ? [] : [{ board: board.metric, rank: index + 1 }]
    })
    const position = award
      ? positions.find((row) => row.board === award.evidence.split(':')[0])
      : [...positions].sort((a, b) => a.rank - b.rank)[0]
    return position
      ? [{ address, ...position, observed_at: snapshot.observed_at, ...(award ? { tier: award.tier } : {}) }]
      : []
  })
}

/** One bounded shared read per server, never an independent ranking or persisted prediction. */
export const create_campaign_boards = (
  read: (observation: LeaderboardObservation, address: string) => Promise<LeaderboardSnapshot>
) => {
  let cached: Promise<Snapshot> | null = null
  let expires = 0
  return (): Promise<Snapshot> => {
    if (cached && Date.now() < expires) return cached
    expires = Date.now() + 30_000
    const rows = Promise.all(LEADERBOARD_METRICS.map((metric) => read({ metric, id: 0 }, normalize_address('0x0'))))
    let timer: ReturnType<typeof setTimeout>
    cached = Promise.race([
      rows,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Leaderboard read timed out')), 2000)
      }),
    ])
      .then((snapshots) => {
        const [first] = snapshots
        if (
          snapshots.some((row) => row.checkpoint !== first.checkpoint || row.timestamp_ms !== first.timestamp_ms) ||
          Date.now() - first.timestamp_ms > 300_000
        )
          throw new Error('Leaderboard snapshot is stale or updating')
        return {
          observed_at: first.timestamp_ms,
          boards: snapshots.map((row) => ({
            metric: row.observation.metric,
            addresses: row.entries.map((entry) => entry.address),
          })),
        }
      })
      .finally(() => clearTimeout(timer))
    return cached
  }
}
