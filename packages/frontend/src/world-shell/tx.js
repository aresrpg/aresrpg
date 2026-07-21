// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #39 — the SINGLE instrumented sign→execute→wait choke point every gameplay tx funnels through (was
// duplicated verbatim in staking/equip/sale actions as a private `sign()`). Two jobs:
//   1) LATENCY NUMBERS — time each pipeline phase per tx CLASS (wallet sign+submit, fullnode index-wait)
//      so real ms are readable off the console + `window.__TX_TIMINGS` (no live-wallet guessing).
//   2) RECONCILE FUEL — returns the full block response (objectChanges/effects/events) so callers patch
//      their store DIRECTLY from the tx result (predict+reconcile) instead of a blocking chain refetch.

import {
  use_auth,
  sign_and_execute_transaction,
  sign_and_execute_self_pay_transaction,
  submit_terminal_random_tx,
} from '../auth'
import { get_sdk } from '../chain/sdk'
import { normalize_receipt } from '../chain/receipt'
import { tx_error } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'
import { FINALITY_POLL_SCHEDULE } from '../tx/latency.js'

import { offer_travel_resync } from './travel_recovery.js'
import { attach_executed_digest } from './tx_digest_error.js'

// #23 gRPC: `run_tx` waits on the gRPC Core `waitForTransaction` (jsonRpc is gone) and normalizes the
// { Transaction | FailedTransaction } receipt back into the jsonRpc-ish { effects, objectChanges, events }
// shape every caller reconciles off (staking/equip/sale/consumable/dungeon/party) — so callers are unchanged.
// Always request effects+objectTypes+events so objectChanges (created ids) + events survive the re-projection.
const DEFAULT_INCLUDE = { effects: true, objectTypes: true, events: true }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** @typedef {{ klass:string, digest:string, sign_ms:number, wait_ms:number, effects_ms:number, ui_ms:number|null, at:number, _t0:number }} TxTiming */

/** Rolling per-class latency log. Inspect live in the browser console via `window.__TX_TIMINGS`. */
/** @type {TxTiming[]} */
const timings = []
export function tx_timings() {
  return timings
}
if (typeof window !== 'undefined') /** @type {any} */ (window).__TX_TIMINGS = timings

/**
 * Sign + execute `tx` via the connected wallet, then wait for the fullnode to index it. Returns
 * `{ result, timing }` — `result` is the waitForTransaction block (objectChanges/effects/events per
 * `options`) callers reconcile off; `timing` the phase breakdown (caller stamps `ui_ms` via
 * `mark_ui_updated` once its store patch / optimistic paint reconciles).
 * @param {string} klass  tx class label for the numbers table (explore/recall/equip/buy/…)
 * @param {any} tx  the built Transaction
 * @param {any} [include]  gRPC Core waitForTransaction `include` (defaults to effects+objectTypes+events)
 * @param {{address:string, wallet_name:string}} [signer]  OVERRIDE signer (the admin PUBLISH tab's dedicated
 *   deployer wallet). Defaults to the global player session (use_auth) so every gameplay tx is unchanged.
 * @returns {Promise<{ result: any, timing: TxTiming }>}
 */
export async function run_tx(klass, tx, include = DEFAULT_INCLUDE, signer) {
  return run(klass, tx, include, signer, sign_and_execute_transaction)
}

/**
 * Instrumented ordinary transaction runner for money PTBs that split value from `tx.gas`. It keeps the normal
 * simulate-refuse + derived-budget pin and excludes sponsor funds, then uses the same receipt/error pipeline.
 */
export async function run_tx_self_pay(klass, tx, include = DEFAULT_INCLUDE) {
  return run(klass, tx, include, undefined, sign_and_execute_self_pay_transaction)
}

/**
 * `run_tx` for a KEEP-BUDGET terminal-`&Random` tx whose builder PINNED the budget from a MEASURED constant
 * (search/gather, forgemagie crush, loot-box open, shop buy): routes through `submit_terminal_random_tx`
 * so the choke's simulate-refuse gate runs but the pinned budget survives as the MAX bound (a value-dependent
 * &Random cost is not sim-stable). `sponsor_excluded` (default false) self-pays a MONEY-split PTB (a Random buy
 * splits the price off `tx.gas`); a non-money &Random tx leaves it false and is sponsor-first for a low zkLogin
 * wallet. Same receipt/timing/throw contract as `run_tx`.
 * @param {string} klass @param {any} tx @param {any} [include]
 * @param {{ sponsor_excluded?: boolean }} [opts]
 * @returns {Promise<{ result: any, timing: TxTiming }>}
 */
export async function run_tx_random(klass, tx, include = DEFAULT_INCLUDE, { sponsor_excluded = false } = {}) {
  // run() calls submit(wallet_name, address, tx, gas_pin, want_effects); bind the money-split flag onto the
  // terminal-&Random door (gas_pin is unused here; the door hardcodes want_effects for the fast path).
  const submit = (wallet_name, address, transaction) =>
    submit_terminal_random_tx(wallet_name, address, transaction, { sponsor_excluded })
  return run(klass, tx, include, undefined, submit)
}

/** The shared pipeline behind both doors — sign+execute via `submit`, wait, normalize, throw on failure. */
async function run(klass, tx, include, signer, submit) {
  const auth = use_auth.getState()
  const address = signer?.address ?? auth.address
  const wallet_name = signer?.wallet_name ?? auth.wallet_name
  if (!address || !wallet_name) throw new Error('Not signed in')
  const sdk = await get_sdk()

  let digest
  let stage = 'submit/preflight'
  const started_at = now()
  try {
    const t0 = started_at
    // PERF (2026-07-14, fixes slow buy-transaction latency): request the EXECUTE-CERT fast path (mirrors dungeon_actions.js's
    // <1s turn-commit lane, measured 07-12) — a sign-only submit returns the CERTIFIED effects in the SAME
    // round-trip as effects_result, letting us skip the separate waitForTransaction read below (~570ms of pure
    // fullnode ledger-availability lag on testnet). `submit_terminal_random_tx`/`sign_and_execute_transaction`
    // both accept `want_effects` (extra arg ignored where unused); every path that can't take the fast lane
    // (sponsor-first / gas-station fallback / a wallet without sign-only) simply returns no `effects_result`,
    // so it falls through to the wait exactly as before — now on the FINALITY_POLL_SCHEDULE diet (250ms
    // detection vs the SDK default's up-to-2000ms dead zones) instead of the un-tuned default poll schedule.
    const submit_result = await submit(wallet_name, address, tx, undefined, true)
    ;({ digest } = submit_result)
    stage = submit_result.effects_result ? 'certified-effects' : 'finality-wait'
    const t1 = now() // wallet signed + submitted (± the certified effects, on the fast path)
    // #23 gRPC: wait (or reuse the already-certified result) + re-project into the jsonRpc-ish shape.
    const raw =
      submit_result.effects_result ??
      (await sdk.grpc_client.core.waitForTransaction({ digest, include, pollSchedule: FINALITY_POLL_SCHEDULE }))
    stage = 'receipt-normalize'
    const result = normalize_receipt(raw)
    stage = 'effects-check'
    if (klass === 'open_box') {
      game_log('tx-probe', 'open_box receipt', {
        digest,
        status: result?.effects?.status,
        event_types: (result?.events ?? []).map((event) => event.type),
        created_types: (result?.objectChanges ?? [])
          .filter((change) => change.type === 'created')
          .map((change) => change.objectType),
      })
    }
    const t2 = now() // effects / objectChanges available
    // An aborted tx resolves here with a failure status — throw so optimistic callers roll back + surface the real
    // error (constitution: a "confirmed" toast must mean the chain confirmed). `=== 'failure'` (not `!== 'success'`)
    // so a caller passing `options` without showEffects can't false-positive on absent effects. tx_error() humanizes
    // into the message + preserves the structured abort on `.cause` (one home) — reported in the catch below.
    if (result?.effects?.status?.status === 'failure') throw tx_error(result.effects.status.error)

    /** @type {TxTiming} */
    const timing = {
      klass,
      digest,
      sign_ms: Math.round(t1 - t0),
      wait_ms: Math.round(t2 - t1),
      effects_ms: Math.round(t2 - t0),
      ui_ms: null,
      at: Date.now(),
      _t0: t0,
    }
    timings.push(timing)
    if (timings.length > 100) timings.shift()
    game_log(
      'tx',
      `${klass}: sign+submit ${timing.sign_ms}ms · index-wait ${timing.wait_ms}ms · effects@ ${timing.effects_ms}ms`
    )
    return { result, timing }
  } catch (error) {
    const elapsed_ms = Math.round(now() - started_at)
    const raw_error = error?.cause ?? error
    // checkpoint::102 is actionable without a reload: offer a body-only return to the proven checkpoint.
    // This NEVER re-submits `tx` (a digest may exist and gas may already be burned); the player decides when
    // to try the original action again after the in-place resync.
    offer_travel_resync(error)
    // THE single "loud to us" home for EVERY gameplay tx failure (S-Sentry). An EXECUTED abort carries a `digest`
    // (gas WAS burned — it slipped the dry-run; genuinely alarming); a PRE-flight refusal has none (zero gas, the
    // guard refused a would-fail tx — working as designed). The RAW machine error goes to Sentry (`.cause` holds
    // the structured MoveAbort, which before_send fingerprints by package::module::abort_code); the PLAYER sees the
    // humanized toast the caller shows off this rethrow. NEVER auto-retried here (tx-retry-burn law).
    game_log(
      'tx',
      `${klass} ${digest ? `failed on-chain (${digest})` : 'refused pre-flight'} · stage=${stage} · elapsed=${elapsed_ms}ms`,
      raw_error
    )
    report_error(error, {
      area: 'tx',
      action: klass,
      stage,
      elapsed_ms,
      raw_error: raw_error instanceof Error ? raw_error.message : String(raw_error),
      ...(digest ? { digest, kind: 'executed-failure' } : { kind: 'preflight-refusal' }),
    })
    // The digest-positive retry latches (equip's character latch, the loot-box open/claim latches) need the
    // proof at this boundary: executed failures stay blocked and carry their cause digest, while every
    // pre-flight refusal (digest absent) stays freely retryable.
    throw ['equip', 'open_box', 'claim_pet'].includes(klass) ? attach_executed_digest(error, digest) : error
  }
}

/** Stamp the "UI-updated" delta (tx start → the caller's store patch / reconcile paint) onto `timing`. */
export function mark_ui_updated(/** @type {TxTiming|null|undefined} */ timing) {
  if (!timing || timing.ui_ms != null) return
  timing.ui_ms = Math.round(now() - timing._t0)
  game_log('tx', `${timing.klass}: UI reconciled @ ${timing.ui_ms}ms (total)`)
}
