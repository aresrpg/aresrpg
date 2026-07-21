// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  GAS-STATION FALLBACK (DECISIONS 2026-07-10) — "we have a gas station to sponsor
//  when we don't have enough."
// ─────────────────────────────────────────────────────────────────────────────
//  A gameplay tx that fails GAS SELECTION on a low wallet (pre-execution: the node/wallet found no
//  coins covering the pinned budget — live class: "GraphQLResponseError: … Unable to perform gas
//  selection … to satisfy required budget N") is re-routed through the ONE client sponsor door
//  (execute_sponsored_tx → api/sponsor.mjs) instead of surfacing raw. Mechanism note (deviation
//  declared): sponsorship rides sponsor.mjs today — the Mysten sui-gas-pool is an
//  identity-blind internal primitive, so when sponsor.mjs later delegates its
//  gas mechanics to the station, this module is untouched (backend-only swap at the same door).
//
//  GATES (all must hold, else the ORIGINAL error is rethrown so the existing humanized
//  insufficient-gas copy path — abort_copy.js's GAS_BALANCE_RE arm — handles it):
//    • not `excluded` — money-split PTBs (buy/gift) split the PRICE/royalty off `tx.gas`; a sponsored gas
//      coin would pay it = a drain. They NEVER fall back (pinned by test). Non-money terminal-&Random gameplay
//      (search/gather/crush/open) is NOT excluded — it rides the sponsor like any other gameplay tx.
//    • the error IS the pre-execution gas-selection class (message or `cause` chain). An EXECUTED
//      failure (digest exists = gas burned) comes back as a RECEIPT, never a throw — so it can
//      never reach this path, and nothing here retries anything (single-flight: one sponsor
//      attempt per failed tx, sequential, then done).
//    • the session is zkLogin (Enoki) — mirrors the sponsor's own #51.1 server gate.
//    • a FRESH balance reads ≤ SELF_PAY_THRESHOLD_MIST (0.2 SUI — the ONE money_route/sponsor
//      boundary, byte-for-byte `>` ⇒ self-pay). Unknown balance (read failed) refuses the
//      fallback: never sponsor blind.
//  Silent on success (fees covered is not news — no toast); the sponsor's own refusals rethrow
//  the ORIGINAL gas error (mechanical cause kept in the console — no-silent-failure law).
// ─────────────────────────────────────────────────────────────────────────────

import type { Transaction } from '@mysten/sui/transactions'

import { SELF_PAY_THRESHOLD_MIST } from '../chain/money_route'
import { use_settings } from '../stores/settings'
import { game_log } from '../core/log.js'
import { attach_executed_digest } from '../world-shell/tx_digest_error.js'

import type { SponsoredReceipt, TxReceipt } from './receipts'

// DUPLICATED from abort_copy.js `GAS_BALANCE_RE` (module-private there; abort_copy is the fenced
// shared decoder — consumed read-only, never edited). KEEP IN LOCKSTEP: both must recognize the
// same pre-execution gas-selection error class.
const GAS_SELECTION_RE =
  /insufficient\s+sui\s+balance|gas selection|unable to perform gas|to satisfy (?:the )?required budget/i

/**
 * Is this throw the PRE-execution gas-selection class? Walks `message` + the `cause` chain (≤4 deep —
 * simulate() wraps its RPC cause in a humanized Error, so the class may sit one level down). An executed
 * on-chain failure ("InsufficientGas" status) does NOT match: that class carries a digest and is never
 * retried or re-routed.
 */
export function is_gas_selection_error(error: unknown): boolean {
  let e: unknown = error
  for (let depth = 0; e != null && depth < 4; depth++) {
    const message = typeof e === 'string' ? e : String((e as { message?: unknown }).message ?? '')
    if (GAS_SELECTION_RE.test(message)) return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

export type SponsorFallbackDeps = {
  /** FRESH on-chain balance in MIST (never a cached store value); null = unknown ⇒ refuse the fallback. */
  fetch_balance_mist: () => Promise<bigint | null>
  /** The ONE sponsor door — execute_sponsored_tx bound to the caller's wallet/chain/sponsor_url. */
  run_sponsored: (transaction: Transaction) => Promise<SponsoredReceipt>
}

/**
 * Decide + run the sponsored re-route for a failed self-pay attempt. Every effect is INJECTED (mirrors
 * chain/money_route.ts) so the money decision unit-tests with plain fakes — zero module mocks.
 * Returns a TxReceipt on sponsored success; otherwise throws (the original error when the fallback does
 * not apply or the sponsor refuses pre-flight; the on-chain cause when the sponsored tx itself failed).
 */
export async function attempt_sponsor_fallback({
  error,
  excluded,
  is_zklogin,
  transaction,
  fetch_balance_mist,
  run_sponsored,
}: {
  error: unknown
  excluded: boolean
  is_zklogin: boolean
  transaction: Transaction
} & SponsorFallbackDeps): Promise<TxReceipt> {
  // Cheap, pure gates first — any miss rethrows the ORIGINAL error untouched (its humanized copy path
  // downstream is the existing insufficient-gas arm; a non-gas error keeps its own honest cause).
  if (excluded || !is_gas_selection_error(error) || !is_zklogin) throw error

  // SETTINGS GATE (handoff from the settings lane): the player opted OUT of sponsored gameplay — always self-pay,
  // so surface the ORIGINAL gas error instead of sponsoring. Read synchronously (the settings store exists to be
  // read here, outside React). This gates the same door the sponsor-FIRST route (tx/index.ts) gates on the pref.
  if (!use_settings.getState().sponsored_gameplay_enabled) throw error

  // FRESH balance gate — the sponsor's exact `>` boundary. A failed read = unknown ⇒ never sponsor blind
  // (the sponsor re-checks server-side anyway; this client gate spares it a doomed round-trip).
  const balance_mist = await fetch_balance_mist().catch(() => null)
  if (balance_mist == null || balance_mist > SELF_PAY_THRESHOLD_MIST) throw error

  // ONE sponsored attempt — sequential, never parallel with the (already failed) self-pay, never repeated.
  let receipt: SponsoredReceipt
  try {
    receipt = await run_sponsored(transaction)
  } catch (sponsor_error) {
    // Sponsor refusal/unreachable = PRE-flight (nothing executed, zero gas). Keep the mechanical cause in
    // the console and surface the ORIGINAL gas-selection error — the existing humanized copy.
    game_log('gas-fallback', 'sponsor refused/unreachable — surfacing the original gas error:', sponsor_error)
    throw error
  }

  if (receipt.effects.status.status !== 'success') {
    // Either the sponsored door's pre-flight dry-run refused (digest '', zero gas) or the sponsored tx
    // EXECUTED and failed on-chain (digest exists = the sponsor's gas is spent — NEVER retried). Both
    // carry the legacy MoveAbort-form cause the shared decoder humanizes.
    throw attach_executed_digest(new Error(receipt.effects.status.error ?? 'Transaction failed'), receipt.digest)
  }

  game_log('gas-fallback', `low-balance tx sponsored (${receipt.digest})`)
  return { digest: receipt.digest }
}
