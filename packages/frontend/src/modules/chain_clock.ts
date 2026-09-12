// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppModule } from '../store.ts'

export type ChainClock = Readonly<{ chain_ms: number; received_ms: number }> | null
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
  const elapsed = monotonic_ms - clock.received_ms
  return elapsed < 0 || elapsed > MAX_SAMPLE_AGE_MS ? null : clock.chain_ms + elapsed
}

/** A smooth countdown is presentation. Only an observed chain timestamp unlocks Force start. */
export const chain_deadline_reached = (clock: ChainClock, deadline: bigint | null, monotonic_ms: number): boolean =>
  deadline !== null && chain_now(clock, monotonic_ms) !== null && BigInt(clock!.chain_ms) >= deadline

const chain_clock: AppModule = {
  name: 'chain_clock',
  reduce: (state, input) => {
    if (input.type === 'clock/observed') {
      const chain_ms = Number(input.chain_ms)
      const { received_ms } = input
      const sample_age_ms = input.sample_age_ms ?? 0
      if (
        ![Number.isFinite(sample_age_ms), sample_age_ms >= 0, Number.isSafeInteger(chain_ms), chain_ms > 0].every(
          Boolean
        )
      )
        return { ...state, chain_clock: null }
      if (state.chain_clock && chain_ms <= state.chain_clock.chain_ms) return state
      return { ...state, chain_clock: Object.freeze({ chain_ms, received_ms: received_ms - sample_age_ms }) }
    }
    return state.chain_clock && !['ready', 'connected'].includes(state.session.link_status)
      ? { ...state, chain_clock: null }
      : state
  },
}

export default Object.freeze(chain_clock)
