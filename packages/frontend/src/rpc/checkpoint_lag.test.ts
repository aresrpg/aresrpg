// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { CHECKPOINT_LAG_THRESHOLD, resolve_checkpoint_lag } from './checkpoint_lag'

describe('checkpoint lag threshold', () => {
  test('normal checkpoint drift stays quiet through the staleness threshold', () => {
    const committer_checkpoint = 100
    expect(CHECKPOINT_LAG_THRESHOLD).toBeGreaterThan(5)
    expect(resolve_checkpoint_lag(committer_checkpoint + CHECKPOINT_LAG_THRESHOLD, committer_checkpoint)?.lagging).toBe(
      false
    )
    expect(resolve_checkpoint_lag(committer_checkpoint + CHECKPOINT_LAG_THRESHOLD + 1, committer_checkpoint)).toEqual({
      chain_checkpoint: committer_checkpoint + CHECKPOINT_LAG_THRESHOLD + 1,
      committer_checkpoint: 100,
      remaining_checkpoints: CHECKPOINT_LAG_THRESHOLD + 1,
      lagging: true,
    })
  })

  test('a later committed sample drains the live count and clears the alert', () => {
    expect(resolve_checkpoint_lag(140n, 120)?.remaining_checkpoints).toBe(20)

    const caught_up = resolve_checkpoint_lag(143n, 139)
    expect(caught_up?.remaining_checkpoints).toBe(4)
    expect(caught_up?.lagging).toBe(false)
  })

  test('clamps a committer ahead of the observed node tip to zero', () => {
    expect(resolve_checkpoint_lag(100n, 102)).toEqual({
      chain_checkpoint: 100,
      committer_checkpoint: 102,
      remaining_checkpoints: 0,
      lagging: false,
    })
  })

  test('refuses missing or unsafe checkpoints instead of inventing a count', () => {
    expect(resolve_checkpoint_lag(undefined, 100)).toBeNull()
    expect(resolve_checkpoint_lag(101n, null)).toBeNull()
    expect(resolve_checkpoint_lag(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 100)).toBeNull()
  })
})
