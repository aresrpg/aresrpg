// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type ChainClock = Readonly<{ chain_ms: number; observed_at: number }> | null
export type ChainClockInput = Readonly<{
  type: 'clock/observed'
  chain_ms: number | null
  received_ms: number
  sample_age_ms?: number | null
}>

const MAX_SAMPLE_AGE_MS = 15_000

/** Wall-clock changes cannot advance chain time; missing heartbeats expire the estimate. */
export const chain_now = (clock: ChainClock, monotonic_ms: number): number | null => {
  if (!clock) return null
  const elapsed = monotonic_ms - clock.observed_at
  return elapsed < 0 || elapsed > MAX_SAMPLE_AGE_MS ? null : clock.chain_ms + elapsed
}

/** A smooth countdown is presentation. Only an observed chain timestamp unlocks Force start. */
export const chain_deadline_reached = (clock: ChainClock, deadline: bigint | null, monotonic_ms: number): boolean =>
  deadline !== null && chain_now(clock, monotonic_ms) !== null && BigInt(clock!.chain_ms) >= deadline

export const observe_chain_clock = (clock: ChainClock, input: Omit<ChainClockInput, 'type'>): ChainClock => {
  const chain_ms = Number(input.chain_ms)
  const { received_ms } = input
  const sample_age_ms = input.sample_age_ms ?? 0
  if (
    ![Number.isFinite(sample_age_ms), sample_age_ms >= 0, Number.isSafeInteger(chain_ms), chain_ms > 0].every(Boolean)
  )
    return null
  if (clock && chain_ms <= clock.chain_ms) return clock
  return Object.freeze({ chain_ms, observed_at: received_ms - sample_age_ms })
}
