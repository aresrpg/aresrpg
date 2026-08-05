// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sui_mist.ts — pure BigInt helpers for SUI/MIST money math (frontend mirror).
// Exact port of backend/src/sui_mist.js with TypeScript types. All money-path
// code in the frontend must import from here. No Number() casts on MIST values.
//
// Fee model (net-price model):
//   Seller enters net X. X must be divisible by 20 (guaranteed for 2-decimal-SUI inputs).
//     buyer pays   = X * 21 / 20   (display price)
//     seller gets  = X * 19 / 20   (seller share)
//     treasury     = X / 10        (fee share)
//   Invariant: seller_share + fee_share === display_price (exact integer equality).

// ═══ Constants ═══

export const MIST_PER_SUI = 1_000_000_000n
// GAS RESERVE (#51): always keep 0.2 SUI on an account for gas. The send-modal caps sendable at
// balance − this, and the sponsor's SELF_PAY threshold is the same 0.2 SUI — single source for the reserve.
export const GAS_RESERVE_MIST = 200_000_000n
// 0.01 SUI precision → 10^7 MIST. All valid net prices are multiples of 10^7 MIST,
// which implies divisibility by 20 (since 10^7 = 20 × 500_000).
export const MIN_MIST = 10_000_000n // 0.01 SUI
export const MAX_MIST = 100_000_000_000_000n // 100_000 SUI
// Fixed gas reserve kept out of transferable balances: 0.05 SUI.
export const GAS_BUDGET_MIST = 50_000_000n

// ═══ Parsers ═══

// parse_sui_decimal(str) — decimal SUI with up to chain precision → MIST.
// This owns decimal place-value conversion only; callers layer their own money policy (marketplace limits,
// pledge limits, send balance) after parsing. Leading/trailing-dot forms remain valid because the send field
// accepts them while typing; empty and bare-dot inputs carry no amount and are rejected.
// Throws: Error('INVALID_FORMAT') on malformed input.
export function parse_sui_decimal(str: string): bigint {
  if (typeof str !== 'string' || !str || str === '.' || !/^\d*(\.\d{0,9})?$/.test(str))
    throw new Error('INVALID_FORMAT')

  const [whole = '', frac = ''] = str.split('.')
  return BigInt(whole || '0') * MIST_PER_SUI + BigInt(frac.padEnd(9, '0') || '0')
}

// parse_mist_string(str) — strict MIST integer parser.
// Accepts only a non-negative decimal integer string matching /^(0|[1-9][0-9]*)$/.
// Rejects: hex ("0x100"), negative ("-1"), scientific ("1e9"), leading zeros ("007"),
//          empty, whitespace, floats ("1.5"), and any non-string input.
// Throws: Error('INVALID_MIST') on any rejection.
export function parse_mist_string(str: string): bigint {
  if (typeof str !== 'string') throw new Error('INVALID_MIST')
  if (!/^(0|[1-9][0-9]*)$/.test(str)) throw new Error('INVALID_MIST')
  return BigInt(str)
}

// parse_2_decimal_sui(str) — user-entered SUI with at most 2 decimals → MIST.
// Accepts: "0.01", "100", "99999.99", "100.1", "100000", "100000.00"
// Rejects: "0.001" (3dp), "-1", "1e2", "1,5" (caller must normalize commas upstream),
//          "0.1.5", ".5" (missing integer), "1." (trailing dot), "0x10", "" and non-strings.
// Throws: Error with message one of: INVALID_FORMAT | BELOW_MIN | ABOVE_MAX | NOT_DIVISIBLE_BY_20
export function parse_2_decimal_sui(str: string): bigint {
  if (typeof str !== 'string') throw new Error('INVALID_FORMAT')
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error('INVALID_FORMAT')

  const mist = parse_sui_decimal(str)

  assert_valid_net_price(mist)
  return mist
}

// parse_pledge_sui(str) — user-entered SUI pledge (kolizeum wager) with at most 2 decimals → MIST.
// Same string format as parse_2_decimal_sui, but a pledge is NOT a marketplace net price: it is never split
// into a seller/fee ratio AT PLEDGE TIME (the platform's 10% cut applies only to a REAL WIN's pot at settle,
// §17.9 — PLATFORM CUTS; a draw/cancel/exit refunds every pledge WHOLE, uncut), and
// the chain only checks EXACT equality (`pledge.value() == pledge_amount`, kolizeum.move create_internal/join_internal).
// So the marketplace-only floor (MIN_MIST) and %20-divisibility (fee-math artifacts of assert_valid_net_price)
// do not apply here — ZERO is a legal pledge (kolizeum.move: "0 allowed — a friendly duel", proven end-to-end
// by the Move unit test zero_pledge_lobby_is_a_clean_noop_economy). The MAX_MIST ceiling still applies (sanity
// bound, not a fee-math constraint).
// Accepts: "0", "0.00", "0.01", "100", "99999.99"
// Rejects: "0.001" (3dp), "-1", "1e2", ".5", "1.", above MAX_MIST, "" and non-strings.
// Throws: Error with message one of: INVALID_FORMAT | ABOVE_MAX
export function parse_pledge_sui(str: string): bigint {
  if (typeof str !== 'string') throw new Error('INVALID_FORMAT')
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error('INVALID_FORMAT')

  const mist = parse_sui_decimal(str)

  assert_valid_pledge(mist)
  return mist
}

// ═══ Validators ═══

// assert_valid_net_price — runtime guard for every money-path entry point.
// Throws one of: INVALID_FORMAT | BELOW_MIN | ABOVE_MAX | NOT_DIVISIBLE_BY_20
export function assert_valid_net_price(price_mist: bigint): void {
  if (typeof price_mist !== 'bigint') throw new Error('INVALID_FORMAT')
  if (price_mist < MIN_MIST) throw new Error('BELOW_MIN')
  if (price_mist > MAX_MIST) throw new Error('ABOVE_MAX')
  if (price_mist % 20n !== 0n) throw new Error('NOT_DIVISIBLE_BY_20')
}

// assert_valid_pledge — runtime guard for kolizeum pledge amounts. UNLIKE assert_valid_net_price: zero is
// valid (no BELOW_MIN floor) and there is no %20 divisibility check (a pledge is never split into fee shares).
// Throws one of: INVALID_FORMAT | ABOVE_MAX
export function assert_valid_pledge(pledge_mist: bigint): void {
  if (typeof pledge_mist !== 'bigint') throw new Error('INVALID_FORMAT')
  if (pledge_mist < 0n) throw new Error('INVALID_FORMAT')
  if (pledge_mist > MAX_MIST) throw new Error('ABOVE_MAX')
}

// ═══ Fee math ═══
// All three return exact integer MIST when net_mist passes assert_valid_net_price.
// seller_share(net) + fee_share(net) === display_from_net(net) (mathematically guaranteed).

// display_from_net(net) — price the buyer pays (net + 5% markup). Throws if net invalid.
export function display_from_net(net_mist: bigint): bigint {
  assert_valid_net_price(net_mist)
  return (net_mist * 21n) / 20n
}

// seller_share(net) — amount credited to seller (95% of net). Throws if net invalid.
export function seller_share(net_mist: bigint): bigint {
  assert_valid_net_price(net_mist)
  return (net_mist * 19n) / 20n
}

// fee_share(net) — amount credited to treasury (10% of net). Throws if net invalid.
export function fee_share(net_mist: bigint): bigint {
  assert_valid_net_price(net_mist)
  return net_mist / 10n
}

// assert_fee_math_holds — runtime invariant check. FATAL if it ever throws.
export function assert_fee_math_holds(net_mist: bigint): void {
  assert_valid_net_price(net_mist)
  const display = display_from_net(net_mist)
  const seller = seller_share(net_mist)
  const fee = fee_share(net_mist)
  if (seller + fee !== display) {
    throw new Error(`FATAL_FEE_MATH_BROKEN: net=${net_mist} seller=${seller} fee=${fee} display=${display}`)
  }
}

// ═══ Formatters (display only) ═══

// format_sui_exact(mist) — MIST → SUI string with EVERY significant digit, trailing zeros trimmed, nothing
// rounded or floored away. For figures a floor would falsify: a dry-run gas estimate (which the 2dp formatter
// shows as a flat "0.00"), an item royalty, and the MAX fill (flooring there strands the player's last MIST
// and makes the wallet un-emptiable). BigInt-only — the previous home in send_modal_shell.tsx cast through
// `Number(mist)/1e9`, which goes exponential ("1e-9") on a near-empty wallet and loses digits past 2^53 MIST.
export function format_sui_exact(mist: bigint): string {
  if (typeof mist !== 'bigint') throw new Error('INVALID_FORMAT')
  const whole = mist / MIST_PER_SUI
  const frac = (mist % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

// format_mist_to_sui(mist, decimals?) — MIST → SUI string, ALWAYS FLOORS.
// Defaults to 9 decimals (full MIST precision). For 2 decimals, precision below
// 0.01 SUI is truncated. Never overstates the SUI amount shown to the buyer.
export function format_mist_to_sui(mist: bigint, decimals: 2 | 9 = 9): string {
  if (typeof mist !== 'bigint') throw new Error('INVALID_FORMAT')
  if (decimals !== 2 && decimals !== 9) throw new Error('INVALID_DECIMALS')

  const integer_sui = mist / MIST_PER_SUI
  const fractional_mist = mist % MIST_PER_SUI // 0 <= f < 10^9
  // Pad fractional MIST to 9 digits, then truncate to requested decimals (floor).
  const full_frac = fractional_mist.toString().padStart(9, '0')
  const truncated_frac = full_frac.slice(0, decimals)
  return `${integer_sui.toString()}.${truncated_frac}`
}
