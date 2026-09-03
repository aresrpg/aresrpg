// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  checkpoint_lag,
  create_indexing_health,
  parse_indexed_checkpoint,
  parse_indexed_state,
} from '../src/indexing_health.ts'

describe('indexing health', () => {
  test('reports missing checkpoints and clamps an indexer ahead of its fullnode', () => {
    expect(checkpoint_lag(100, 91)).toBe(9)
    expect(checkpoint_lag(100, 101)).toBe(0)
  })

  test('reads only the committed indexer marker shape', () => {
    expect(parse_indexed_checkpoint('{"sequence_number":91,"epoch":1}')).toBe(91)
    expect(parse_indexed_state('{"sequence_number":91,"epoch":1}')).toEqual({ sequence_number: 91, epoch: '1' })
    expect(parse_indexed_checkpoint('{"sequence_number":"91"}')).toBeNull()
    expect(() => parse_indexed_checkpoint('broken')).toThrow()
  })

  test('deduplicates concurrent reads and caches one result for the heartbeat window', async () => {
    let chain_reads = 0
    let indexed_reads = 0
    let now_ms = 1_000
    const health = create_indexing_health({
      chain_checkpoint: async () => {
        chain_reads += 1
        await Promise.resolve()
        return 120
      },
      indexed_state: async () => {
        indexed_reads += 1
        return { sequence_number: 100, epoch: '7' }
      },
      now: () => now_ms,
      cache_ms: 4_000,
    })

    expect(await Promise.all([health(), health()])).toEqual([
      { lag: 20, epoch: '7' },
      { lag: 20, epoch: '7' },
    ])
    expect(await health()).toEqual({ lag: 20, epoch: '7' })
    expect({ chain_reads, indexed_reads }).toEqual({ chain_reads: 1, indexed_reads: 1 })

    now_ms += 4_001
    expect(await health()).toEqual({ lag: 20, epoch: '7' })
    expect({ chain_reads, indexed_reads }).toEqual({ chain_reads: 2, indexed_reads: 2 })
  })

  test('has no health claim before the indexer has committed a checkpoint', async () => {
    const health = create_indexing_health({
      chain_checkpoint: async () => 120,
      indexed_state: async () => null,
    })

    expect(await health()).toEqual({ lag: null, epoch: null })
  })
})
