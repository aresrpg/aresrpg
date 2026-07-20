// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MONEY ROUTING for character creation (the live-400 fix).
//
// The @server sponsor enforces an anti-drain law: a wallet holding > 0.2 SUI ALWAYS pays its own gas
// (api/sponsor.mjs `SELF_PAY_MIST`) — a funded wallet hitting the sponsor gets a `self-pay-required` 400.
// The old `create_character` fired the sponsored door UNCONDITIONALLY, so a funded owner (0.82 SUI) got the
// 400. Fix: mirror the sponsor's boundary EXACTLY off a FRESH on-chain balance and, for a funded wallet,
// self-pay the SAME free-mint PTB (verified live: testnet Creation.sponsor == none ⇒ a self-pay free mint is
// permitted; creation.move:137 only gates when a sponsor is configured). Keep this in lockstep with
// api/sponsor.mjs `SELF_PAY_MIST` — a boundary mismatch either leaves the 400 reachable or self-pays too eagerly.

/** > this many MIST held ⇒ self-pay (0.2 SUI). MIRRORS api/sponsor.mjs `SELF_PAY_MIST` — keep in lockstep. */
export const SELF_PAY_THRESHOLD_MIST = 200_000_000n

export type PaymentRoute = 'self_pay' | 'sponsored'

/**
 * PURE money verdict for a character mint. `balance_mist` MUST be a FRESH on-chain read — never a cached store
 * value (a stale balance is exactly the bug this fixes). > 0.2 SUI ⇒ 'self_pay'; ≤ 0.2 SUI ⇒ 'sponsored'.
 * The comparison is strict `>` to match the sponsor's own `balance > SELF_PAY_MIST` boundary byte-for-byte.
 */
export function route_create_payment(balance_mist: bigint): PaymentRoute {
  return balance_mist > SELF_PAY_THRESHOLD_MIST ? 'self_pay' : 'sponsored'
}

type SponsoredResult = { digest: string; effects?: { status?: { status?: string; error?: string } } }
type SelfPayResult = { digest: string }

/**
 * Fetch a FRESH balance, decide the route, and execute the mint through the matching door. Every effect is
 * INJECTED so the money decision is unit-testable with plain fakes (zero module mocks — see money_route.test.js).
 * Returns `{ route, digest }`; the caller waits + normalizes the receipt off `digest`.
 *
 * INVARIANTS:
 *  - A `fetch_balance_mist` failure THROWS and propagates — it NEVER silently falls through to the sponsored
 *    door (that is the 400 this fixes: a funded wallet must not reach the sponsor).
 *  - SPONSORED (≤ 0.2 SUI): a would-fail tx refuses at the sponsored dry-run with digest '' + a failure status
 *    → surfaced here as the humanized mint error (so the empty digest is never waited on).
 *  - SELF-PAY (> 0.2 SUI): the same free-mint PTB, the user's own gas. `run_self_pay`'s choke dry-runs before
 *    signing (zero-gas refuse-on-fail → REJECTS); an EXECUTED failure returns BCS effects the CALLER checks off
 *    the waited receipt (mirrors create_character_paid), so no status pre-check happens here.
 */
export async function execute_create_routed<Tx>({
  fetch_balance_mist,
  tx,
  run_self_pay,
  run_sponsored,
  on_mint_error,
}: {
  fetch_balance_mist: () => Promise<bigint>
  tx: Tx
  run_self_pay: (tx: Tx) => Promise<SelfPayResult>
  run_sponsored: (tx: Tx) => Promise<SponsoredResult>
  on_mint_error: (error?: string) => Error
}): Promise<{ route: PaymentRoute; digest: string }> {
  const balance_mist = await fetch_balance_mist()
  const route = route_create_payment(balance_mist)

  if (route === 'self_pay') {
    const { digest } = await run_self_pay(tx)
    return { route, digest }
  }

  const res = await run_sponsored(tx)
  if (res.effects?.status?.status !== 'success') throw on_mint_error(res.effects?.status?.error)
  return { route, digest: res.digest }
}
