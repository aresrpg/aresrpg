// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer } from 'react'

type ClockState = Readonly<{ chain_ms: bigint; sampled_at: number; now_ms: bigint }>
type ClockInput = Readonly<{ type: 'sync'; chain_ms: bigint; now: number }> | Readonly<{ type: 'tick'; now: number }>
const reduce_clock = (state: ClockState, input: ClockInput): ClockState =>
  input.type === 'sync'
    ? { chain_ms: input.chain_ms, sampled_at: input.now, now_ms: input.chain_ms }
    : { ...state, now_ms: state.chain_ms + BigInt(Math.max(0, Math.floor(input.now - state.sampled_at))) }

export const useCountdown = (chain_ms: bigint, deadline: bigint | undefined): bigint => {
  const [clock, dispatch] = useReducer(reduce_clock, { chain_ms, sampled_at: 0, now_ms: chain_ms })
  useEffect(() => {
    if (deadline === undefined) return
    dispatch({ type: 'sync', chain_ms, now: performance.now() })
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') dispatch({ type: 'tick', now: performance.now() })
    }, 1_000)
    return () => globalThis.clearInterval(timer)
  }, [chain_ms, deadline])
  return clock.chain_ms === chain_ms ? clock.now_ms : chain_ms
}

export const countdown_parts = (remaining_ms: bigint) => {
  const seconds = remaining_ms > 0n ? remaining_ms / 1_000n : 0n
  return {
    days: (seconds / 86_400n).toString(),
    hours: ((seconds / 3_600n) % 24n).toString().padStart(2, '0'),
    minutes: ((seconds / 60n) % 60n).toString().padStart(2, '0'),
    seconds: (seconds % 60n).toString().padStart(2, '0'),
  }
}
