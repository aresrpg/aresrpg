// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  CHECKPOINT_LAG_THRESHOLD,
  SUSTAINED_LAG_SAMPLES,
  fold_lag_streak,
  is_sustained_lag,
  resolve_checkpoint_lag,
} from './checkpoint_lag'

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

  test('alerts only at a hundred checkpoints behind, not at ordinary drift', () => {
    expect(CHECKPOINT_LAG_THRESHOLD).toBe(100)
    expect(resolve_checkpoint_lag(1_000_008, 1_000_000)?.lagging).toBe(false)
    expect(resolve_checkpoint_lag(1_000_100, 1_000_000)?.lagging).toBe(false)
    expect(resolve_checkpoint_lag(1_000_101, 1_000_000)?.lagging).toBe(true)
  })
})

describe('sustained lag gate', () => {
  test('a lone over-threshold sample never reaches the sustained bar', () => {
    expect(SUSTAINED_LAG_SAMPLES).toBeGreaterThan(1)
    expect(is_sustained_lag(fold_lag_streak(0, true))).toBe(false)
  })

  test('consecutive over-threshold samples reach the bar and settle there', () => {
    let streak = 0
    for (let sample = 0; sample < SUSTAINED_LAG_SAMPLES; sample += 1) streak = fold_lag_streak(streak, true)

    expect(is_sustained_lag(streak)).toBe(true)
    // Clamped: a long episode keeps the folded value stable instead of counting forever.
    expect(fold_lag_streak(streak, true)).toBe(SUSTAINED_LAG_SAMPLES)
  })

  test('one healthy sample resets the streak so recovery is never delayed', () => {
    const sustained = fold_lag_streak(fold_lag_streak(0, true), true)
    expect(is_sustained_lag(sustained)).toBe(true)

    const recovered = fold_lag_streak(sustained, false)
    expect(recovered).toBe(0)
    expect(is_sustained_lag(recovered)).toBe(false)
  })

  test('an interrupted streak restarts rather than accumulating across episodes', () => {
    const interrupted = fold_lag_streak(fold_lag_streak(fold_lag_streak(0, true), false), true)
    expect(is_sustained_lag(interrupted)).toBe(false)
  })
})
