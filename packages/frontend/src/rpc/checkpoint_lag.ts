// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Global indexer-lag decision. The chain tip comes from Mysten gRPC while the committed tip comes from
// `/v1/status`; keeping the comparison pure makes the exact alert boundary independently testable.

// A few checkpoints of projection delay are normal, and a brief spike is not an incident: the alert boundary is
// therefore BOTH a size and a persistence test. A hundred checkpoints behind is where the projection is
// visibly — not marginally — stale; this is the single alert threshold consumed by every caller.
export const CHECKPOINT_LAG_THRESHOLD = 100

// The persistence half. Two CONSECUTIVE over-threshold samples necessarily span a full poll interval, so a
// spike that opens and closes between polls can be observed at most once and stays quiet. Recovery is not
// symmetric on purpose: one healthy sample clears the alert immediately (see `fold_lag_streak`).
export const SUSTAINED_LAG_SAMPLES = 2

type CheckpointValue = bigint | number | string | null | undefined

export interface CheckpointLag {
  chain_checkpoint: number
  committer_checkpoint: number
  remaining_checkpoints: number
  lagging: boolean
}

function checkpoint_number(value: CheckpointValue): number | null {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(value)
  }
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Compare independently observed tips. Equality with the threshold is healthy; only a larger gap alerts. */
export function resolve_checkpoint_lag(
  chain_value: CheckpointValue,
  committer_value: CheckpointValue,
  threshold = CHECKPOINT_LAG_THRESHOLD
): CheckpointLag | null {
  const chain_checkpoint = checkpoint_number(chain_value)
  const committer_checkpoint = checkpoint_number(committer_value)
  if (chain_checkpoint == null || committer_checkpoint == null || !Number.isSafeInteger(threshold) || threshold < 0)
    return null

  const remaining_checkpoints = Math.max(0, chain_checkpoint - committer_checkpoint)
  return {
    chain_checkpoint,
    committer_checkpoint,
    remaining_checkpoints,
    lagging: remaining_checkpoints > threshold,
  }
}

/**
 * Pure fold over the polled sample series: how many over-threshold samples have landed back to back.
 * Clamped at the bar so a long incident settles on a stable value instead of counting forever, and reset
 * to zero by a single healthy sample so a caught-up indexer stops alerting on the very next poll.
 */
export function fold_lag_streak(streak: number, sample_lagging: boolean): number {
  if (!sample_lagging) return 0
  return Math.min(streak + 1, SUSTAINED_LAG_SAMPLES)
}

/** The alert predicate: a lag is real once it has survived `SUSTAINED_LAG_SAMPLES` consecutive observations. */
export function is_sustained_lag(streak: number): boolean {
  return streak >= SUSTAINED_LAG_SAMPLES
}
