// use_sponsor_allowance — the ONE reader of the per-zkLogin daily FREE-GAMEPLAY allowance (SPEC §14).
//
// Polls /v1/sponsor/remaining for the connected zkLogin address (idle when logged out — no address, no
// request). Shared by the sidebar gauge (SponsorAllowanceBar), the pre-fight hint, and the run-out modal
// countdown so there is ONE poll and ONE source of truth. MONEY IS BIGINT here: the string mist fields
// come back as bigint so callers never Number()-coerce a money value. Display-only — the sponsor itself
// still fail-closes the real cap; a poll blip just shows the last-good value (use_rpc_view keeps it).

import { use_auth, type AuthState } from '../auth'

import { get_sponsor_remaining } from './client'
import { use_rpc_view } from './use_view'

export interface SponsorAllowance {
  allowance_mist: bigint
  spent_mist: bigint
  remaining_mist: bigint
  resets_at: string | null
  /** true before the first successful load — the gauge shows a placeholder, not a scary empty bar. */
  loading: boolean
  /** true when a poll failed while prior data is held (use_rpc_view's no-silent-stale contract). */
  stale: boolean
}

// 15s cadence: the allowance only moves when the player spends sponsored gas, so this is deliberately
// slower than the 5s data views — enough to feel live, frugal on requests (token discipline).
const POLL_MS = 15000

export function use_sponsor_allowance(): SponsorAllowance | null {
  const address = use_auth((s: AuthState) => s.address)
  const { data, loading, stale } = use_rpc_view((signal) => get_sponsor_remaining(address as string, signal), {
    enabled: !!address,
    deps: [address],
    interval_ms: POLL_MS,
  })

  if (!address) return null
  if (!data) return { allowance_mist: 0n, spent_mist: 0n, remaining_mist: 0n, resets_at: null, loading, stale }
  return {
    allowance_mist: BigInt(data.allowance_mist),
    spent_mist: BigInt(data.spent_mist),
    remaining_mist: BigInt(data.remaining_mist),
    resets_at: data.resets_at,
    loading,
    stale,
  }
}
