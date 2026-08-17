// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One cached comparison between the indexer's committed Redis marker and the fullnode head.
// Player heartbeats share this closure, so connection count never multiplies chain reads.

export const INDEXED_CHECKPOINT_KEY = 'idx:checkpoint:latest'

export const parse_indexed_checkpoint = (raw: string | null): number | null => {
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || !('sequence_number' in value)) return null
  const { sequence_number } = value as { sequence_number: unknown }
  return typeof sequence_number === 'number' && Number.isSafeInteger(sequence_number) && sequence_number >= 0
    ? sequence_number
    : null
}

export const checkpoint_lag = (chain_checkpoint: number, indexed_checkpoint: number): number =>
  Math.max(0, chain_checkpoint - indexed_checkpoint)

type IndexingHealthOptions = Readonly<{
  chain_checkpoint: () => Promise<number>
  indexed_checkpoint: () => Promise<number | null>
  now?: () => number
  cache_ms?: number
}>

export const create_indexing_health = ({
  chain_checkpoint,
  indexed_checkpoint,
  now = Date.now,
  cache_ms = 4_000,
}: IndexingHealthOptions): (() => Promise<number | null>) => {
  let cached: Readonly<{ at_ms: number; lag: number | null }> | null = null
  let pending: Promise<number | null> | null = null

  return async () => {
    const at_ms = now()
    if (cached && at_ms - cached.at_ms < cache_ms) return cached.lag
    if (pending) return pending

    const request = Promise.all([chain_checkpoint(), indexed_checkpoint()]).then(([chain, indexed]) =>
      indexed === null ? null : checkpoint_lag(chain, indexed)
    )
    pending = request
    try {
      const lag = await request
      cached = Object.freeze({ at_ms: now(), lag })
      return lag
    } finally {
      if (pending === request) pending = null
    }
  }
}
