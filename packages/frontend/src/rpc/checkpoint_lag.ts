// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Global indexer-lag decision. The chain tip comes from Mysten gRPC while the committed tip comes from
// `/v1/status`; keeping the comparison pure makes the exact alert boundary independently testable.

// A few checkpoints of projection delay are normal. Thirty checkpoints is the existing checkpoint metric's
// approximate 30-second staleness budget; this is the single alert threshold consumed by every caller.
export const CHECKPOINT_LAG_THRESHOLD = 30

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
