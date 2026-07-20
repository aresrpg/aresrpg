import { SELF_PAY_THRESHOLD_MIST } from '../chain/money_route'

export const BALANCE_FRESH_MS = 30_000

export type SponsorRoute = 'sponsored-first' | 'self-pay'
export type SponsorRouteReason =
  | 'excluded-sponsor'
  | 'not-zklogin'
  | 'sponsored-disabled'
  | 'balance-unknown'
  | 'balance-stale'
  | 'fresh-balance<=threshold'
  | 'balance>threshold'
  | 'sponsor-refused'

export type SponsorRouteDecision = { route: SponsorRoute; reason: SponsorRouteReason }

/**
 * Client-side gameplay router. `sponsor_excluded` (a money PTB that splits price/royalty off `tx.gas` — buy,
 * gift) is the SOLE exclusion: a sponsored gas coin would fund that split (a drain), so it always self-pays.
 * Everything else — INCLUDING terminal-&Random gameplay (search, gather, crush, open) whose builder pins a
 * generous fixed budget (`keep_budget` is an ORTHOGONAL budget-pin directive the choke's guard consumes, NOT a
 * routing input) — is sponsor-eligible (canon: the whole game at zero SUI). A wallet last seen funded
 * (> 0.2 SUI) self-pays, never re-asking the sponsor (a stale read flooded the console with self-pay-required
 * 400s every turn-based commit, found in live QA 2026-07-19); a known-low or unknown balance goes sponsor-first so the
 * sponsor's fresh server-side balance gate stays authoritative (it may have crossed 0.2 SUI since our read).
 */
export function decide_sponsor_route({
  sponsor_excluded,
  is_zklogin,
  pref_on,
  cached_balance_mist,
  cached_balance_read_at_ms,
  sponsor_refused = false,
  now_ms = Date.now(),
}: {
  sponsor_excluded: boolean
  is_zklogin: boolean
  pref_on: boolean
  cached_balance_mist: bigint | null
  cached_balance_read_at_ms: number | null
  sponsor_refused?: boolean
  now_ms?: number
}): SponsorRouteDecision {
  if (sponsor_excluded) return { route: 'self-pay', reason: 'excluded-sponsor' }
  if (!is_zklogin) return { route: 'self-pay', reason: 'not-zklogin' }
  if (!pref_on) return { route: 'self-pay', reason: 'sponsored-disabled' }
  if (sponsor_refused) return { route: 'self-pay', reason: 'sponsor-refused' }
  if (cached_balance_mist == null) return { route: 'sponsored-first', reason: 'balance-unknown' }

  // FUNDED IS AGE-INDEPENDENT (live-QA 07-19 reserve-400 flood). A wallet last seen above 0.2 SUI is never
  // sponsor-eligible — the @server refuses it (api/sponsor.mjs SELF_PAY_MIST) — so re-asking on a "stale" read (a
  // turn-based fight's think-time trivially exceeds the 30s window) only earns a guaranteed self-pay-required 400 on
  // every commit. Route it self-pay regardless of read age; a rare uncached drop below the threshold is caught by the
  // gas-selection fallback (gas_fallback.ts reads FRESH and sponsors then), so trusting a stale-high read is safe.
  if (cached_balance_mist > SELF_PAY_THRESHOLD_MIST) return { route: 'self-pay', reason: 'balance>threshold' }

  // Known low balance (≤ 0.2 SUI): the sponsor's fresh server-side check stays authoritative — it may have risen
  // above the threshold since our read — so go sponsor-first either way. Freshness only annotates the trace here.
  const age_ms = cached_balance_read_at_ms == null ? Number.POSITIVE_INFINITY : now_ms - cached_balance_read_at_ms
  const stale = !Number.isFinite(age_ms) || age_ms < 0 || age_ms > BALANCE_FRESH_MS
  return { route: 'sponsored-first', reason: stale ? 'balance-stale' : 'fresh-balance<=threshold' }
}

/** Exact payload handed to game_log('tx', ...); the resulting trace is `[tx] route: ...`. */
export const sponsor_route_log = ({ route, reason }: SponsorRouteDecision): string => `route: ${route} reason=${reason}`
