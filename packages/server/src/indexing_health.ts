// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One cached comparison between the indexer's committed Redis marker and the fullnode head.
// Player heartbeats share this closure, so connection count never multiplies chain reads.

export const INDEXED_CHECKPOINT_KEY = 'idx:checkpoint:latest'

export type IndexedState = Readonly<{ sequence_number: number; epoch: string }>
export type IndexingHealth = Readonly<{ lag: number | null; epoch: string | null }>

export const parse_indexed_state = (raw: string | null): IndexedState | null => {
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) return null
  const { sequence_number, epoch } = value as { sequence_number?: unknown; epoch?: unknown }
  const invalid = [
    !Number.isSafeInteger(sequence_number),
    Number(sequence_number) < 0,
    !['number', 'string'].includes(typeof epoch),
    !/^\d+$/.test(String(epoch)),
  ].some(Boolean)
  if (invalid) return null
  return Object.freeze({ sequence_number: Number(sequence_number), epoch: String(epoch) })
}

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
  indexed_state: () => Promise<IndexedState | null>
  now?: () => number
  cache_ms?: number
}>

export const create_indexing_health = ({
  chain_checkpoint,
  indexed_state,
  now = Date.now,
  cache_ms = 4_000,
}: IndexingHealthOptions): (() => Promise<IndexingHealth>) => {
  let cached: Readonly<{ at_ms: number; health: IndexingHealth }> | null = null
  let pending: Promise<IndexingHealth> | null = null

  return async () => {
    const at_ms = now()
    if (cached && at_ms - cached.at_ms < cache_ms) return cached.health
    if (pending) return pending

    const request = Promise.all([chain_checkpoint(), indexed_state()]).then(([chain, indexed]) =>
      Object.freeze({
        lag: indexed === null ? null : checkpoint_lag(chain, indexed.sequence_number),
        epoch: indexed?.epoch ?? null,
      })
    )
    pending = request
    try {
      const health = await request
      cached = Object.freeze({ at_ms: now(), health })
      return health
    } finally {
      if (pending === request) pending = null
    }
  }
}
