// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The single S-54 transaction door: simulate before signing, refuse failed/over-ceiling transactions, and pin
// self-pay gas to simulated storage + computation ×1.5. `keep_budget` preserves a builder-pinned maximum.
// Eligible gameplay may use sponsor-first/fallback routes; money PTBs set `sponsor_excluded` so sponsor gas
// cannot fund their gas split.
// A receipt with a digest is never retried here. auth/index.ts owns the stable caller wrappers.

import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import type { Wallet as WalletStandard } from '@mysten/wallet-standard'

import { get_sdk } from '../chain/sdk'
import i18n from '../i18n'
import { humanize_tx_error, tx_error } from '../game/core/abort_copy.js'
import { gas_guard_decision, sim_gas, GAS_CEILING_SUI, GAS_CEILING_MIST } from '../game/core/gas_guard.js'
import { SPONSOR_URL } from '../env'
import { read_sui_balance_mist } from '../auth/sui_balance'
import { is_zklogin_wallet } from '../auth/zklogin_wallet'
import { use_settings } from '../stores/settings'
import {
  mark_engage_execution_finished,
  mark_engage_reserve_finished,
  mark_engage_reserve_started,
  mark_engage_simulation_finished,
  mark_engage_wallet_signed,
} from '../core/engage_timing.js'
import { game_log } from '../core/log.js'
import { sponsored_execute_result } from '../chain/receipt'
import { attach_executed_digest } from '../world-shell/tx_digest_error.js'

import { attempt_sponsor_fallback, is_gas_selection_error, type SponsorFallbackDeps } from './gas_fallback'
import { budget_cache_key, cached_budget, remember_budget, forget_budget } from './budget_cache.js'
import { apply_pinned_gas, invalidate_gas_coin } from './gas_coin_cache.js'
import { record_self_paid_receipt } from './gas_spend_ledger'
import { flush_sponsor_legs, now, stamp_preflight, timed } from './latency.js'
import { decide_sponsor_route, sponsor_route_log } from './sponsor_route'
import type { SponsoredReceipt, TxReceipt } from './receipts'
import {
  SPONSOR_REFUSAL_OUTCOME_UNKNOWN,
  SPONSOR_REFUSAL_OUTDATED_PACKAGE,
  SPONSOR_REFUSAL_SIMULATION_INFRASTRUCTURE,
  SPONSOR_REFUSAL_SIMULATION_UNREADABLE,
  SPONSOR_REFUSAL_WOULD_ABORT,
  is_sponsor_outcome_unknown_refusal,
  is_sponsor_outdated_package_refusal,
  is_sponsor_unpriceable_refusal,
  is_sponsor_would_abort_refusal,
} from './sponsor_refusal'

export {
  SPONSOR_REFUSAL_OUTCOME_UNKNOWN,
  SPONSOR_REFUSAL_OUTDATED_PACKAGE,
  SPONSOR_REFUSAL_SIMULATION_INFRASTRUCTURE,
  SPONSOR_REFUSAL_SIMULATION_UNREADABLE,
  SPONSOR_REFUSAL_WOULD_ABORT,
  is_sponsor_unpriceable_refusal,
  is_sponsor_outcome_unknown_refusal,
  is_sponsor_outdated_package_refusal,
  is_sponsor_would_abort_refusal,
} from './sponsor_refusal'

/** Turn-commit gas directive (<1s lane): the caller marks a chained commit so execute_tx pins its gas
 * coin. `skip_sim` = SOLO fight → skip the per-commit dry-run (ESomeoneOverdue is impossible with one player seat);
 * a multiplayer commit passes `skip_sim: false` (it KEEPS the sim so the zero-gas overdue auto-crank is untouched). */
export type GasPin = { skip_sim: boolean }

// ── wallet-standard feature shapes (the exact subset each path calls) ────────────
type SignAndExecuteFeature = {
  signAndExecuteTransaction: (params: {
    account: { address: string }
    transaction: Transaction
    chain: string
  }) => Promise<{ digest: string; effects?: string; bytes?: string }>
}
type SignPersonalMessageFeature = {
  signPersonalMessage: (params: {
    account: { address: string }
    message: Uint8Array
    chain: string
  }) => Promise<{ bytes: string; signature: string }>
}
type SignTransactionFeature = {
  signTransaction: (params: {
    account: { address: string }
    transaction: Transaction
    chain: string
  }) => Promise<{ signature: string; bytes: string }>
}

// Receipt shapes (TxReceipt / SponsoredReceipt) live in the ./receipts leaf so the gas-selection fallback can
// import them without closing an import cycle back through this module (see receipts.ts). Re-exported here so
// tx/index's public surface is unchanged for every existing consumer.
export type { SponsoredReceipt, TxReceipt }

// ── THE GATE ─────────────────────────────────────────────────────────────────
// Gas-burn emergency 07-06: a too-low wallet gas budget let commit_turn EXECUTE and fail
// "InsufficientGas", burning the whole budget, and an auto-retry re-burned (one drain hit
// 0.755 SUI). Root fix: dry-run EVERY tx BEFORE signing (the money verdict is the pure,
// unit-tested gas_guard_decision). Simulation would fail → REFUSE (zero gas, humanized cause).
// Net cost over GAS_CEILING_SUI → REFUSE loudly with the number. Otherwise pin the computation-padded budget
// (simulated storage + computation ×1.5) so the wallet can never under-budget again.

/** Preserve the most specific simulation refusal the RPC supplied without leaking `[object Object]`. */
export function simulation_failure_reason(error: unknown): string {
  return humanize_tx_error({ name: 'SimulationError', cause: error })
}

/** simulateTransaction (I/O). Throws a humanized error when the RPC itself can't simulate. The RAW cause is
 * kept on `.cause` — a deep-dust wallet can fail GAS SELECTION inside the node's simulate, and the fallback's
 * detector (gas_fallback is_gas_selection_error) walks the cause chain to recognize that class through the
 * humanized wrapper (message/UX copy unchanged). */
async function simulate(transaction: Transaction): Promise<any> {
  const { grpc_client } = await get_sdk()
  try {
    return await grpc_client.core.simulateTransaction({ transaction, include: { effects: true } })
  } catch (e) {
    // couldn't even simulate (RPC/unsupported) — refuse rather than gamble real gas on an unknown-cost tx
    game_log('gas-guard', 'simulation threw — refusing (zero gas):', e)
    const failure = new Error(
      i18n.t('errors.tx_simulation_failed_reason', {
        reason: simulation_failure_reason(e),
      }),
      { cause: e }
    )
    failure.name = 'SimulationError'
    throw failure
  }
}

// NO per-tx getBalance: the dry-run refuses a would-fail tx BEFORE signing, the
// ceiling uses the SIMULATED cost, and an actually-insufficient wallet is rejected at SUBMISSION (a
// rejected tx never executes — no funds move). So the balance read was a redundant round-trip per tx.
/**
 * Self-pay pre-flight: simulate → refuse (sim_failed / over_ceiling) → pin the computation-padded budget.
 * @param pin_budget when false (un-simulatable-VALUE &Random buys), the builder's pinned budget is
 *   KEPT as the max bound — only the simulate-refuse gate applies, the budget is left untouched.
 */
async function guard(address: string, transaction: Transaction, pin_budget: boolean, skip_sim = false): Promise<void> {
  transaction.setSenderIfNotSet(address) // simulate/build needs a sender on a self-pay PTB

  // SOLO-COMMIT DRY-RUN SKIP (<1s lane): a solo fight's commit can NEVER abort turns::ESomeoneOverdue
  // (that gate needs a second player seat — turns.move assert_my_turn), so its shape needs no per-commit simulate.
  // The budget is the SDK builder's MEASURED constant × 1.5 (turn_gas_budget_mist) — a real ×1.5 headroom, so this
  // is the accepted budget_cache tradeoff: no dry-run, no InsufficientGas drain (the budget is
  // real), and a would-abort commit executes-and-aborts ON-CHAIN (a small bounded compute burn — the backstop),
  // never auto-retried. Money law still armed: REFUSE LOUDLY if the pinned budget is missing or over the ceiling
  // (a mis-stamped constant must fail here, before signing, at zero gas — never pin an insane budget).
  if (skip_sim) {
    const budget = transaction.getData().gasData?.budget
    if (budget == null)
      throw new Error(
        '[gas-guard] solo commit reached the dry-run-skip path with NO pinned budget — refusing to sign an ' +
          'unbudgeted turn (the builder must set turn_gas_budget_mist()).'
      )
    if (BigInt(budget) > GAS_CEILING_MIST) {
      game_log('gas-guard', `refusing — pinned commit budget ${budget} MIST over the ${GAS_CEILING_SUI} SUI ceiling`)
      throw new Error(
        i18n.t('errors.gas_over_ceiling', { cost: (Number(budget) / 1e9).toFixed(3), limit: GAS_CEILING_SUI })
      )
    }
    return
  }

  // PER-FIGHT BUDGET CACHE (budget-pinned self-pay txs only — never the &Random keep_budget buys): a shape-stable
  // act repeated in the SAME fight reuses its first dry-run's computation-padded budget and SKIPS this round-trip. The
  // budget stays dry-run-DERIVED (S-54 law holds); the ceiling arm is re-checked inside cached_budget; any
  // refusal / executed failure / fight boundary drops the entry (see budget_cache.js for the full trade-off).
  const key = pin_budget ? budget_cache_key(transaction) : null
  const cached = cached_budget(key)
  if (cached != null) {
    transaction.setGasBudget(cached)
    return
  }

  const sim = await simulate(transaction)
  const verdict = gas_guard_decision(sim, null)
  if (!verdict.ok) {
    forget_budget(key) // any refusal drops the shape (defensive: never keep a now-refused budget)
    if (verdict.reason === 'sim_failed') {
      // the tx WOULD abort on-chain — refuse before signing so ZERO gas is spent (humanized cause).
      // `preflight: true` keeps that zero-gas provenance ON the thrown error (the SimulationError marker):
      // without it, downstream burn-law classifiers see a bare MoveAbort and latch it as EXECUTED — the 07-18
      // victory-card starvation (a terminal-race settle refusal latched, the core's retry never fired).
      const chain_error = (sim?.Transaction ?? sim?.FailedTransaction)?.effects?.status?.error
      game_log('gas-guard', 'simulation says the tx would fail — refusing (zero gas):', chain_error)
      throw tx_error(chain_error ?? sim, { preflight: true })
    }
    if (verdict.reason === 'over_ceiling') {
      game_log('gas-guard', `refusing — simulated cost ${verdict.cost_sui} SUI over the ${GAS_CEILING_SUI} ceiling`)
      throw new Error(i18n.t('errors.gas_over_ceiling', { cost: verdict.cost_sui, limit: GAS_CEILING_SUI }))
    }
    throw new Error(i18n.t('errors.insufficient_balance'))
  }
  if (pin_budget) {
    transaction.setGasBudget(verdict.budget)
    remember_budget(key, verdict.budget, sim_gas(sim).net) // cache this fresh dry-run for the rest of the fight
  }
}

/**
 * BALANCE-AUTHORITY resolution (#263 — the auto-pass wedge). When the route would contact the sponsor on an
 * UNKNOWN or STALE-low balance, the CLIENT resolves its own balance and re-decides: a now-funded
 * wallet self-pays DIRECTLY and THE SPONSOR IS NEVER CONTACTED (the @server refuses > 0.2 SUI with a
 * self-pay-required 400 that once froze a live fight). A FRESH-low route is already client-decided — no redundant
 * read. A read failure keeps the original route (safe: sponsor-first + the self-pay-required backstop). Reuses the
 * ONE routing home (decide_sponsor_route) and its ONE threshold (SELF_PAY_THRESHOLD_MIST) — no parallel policy.
 * #1854: `resolve_balance_mist` reads the client's BALANCE HOME (auth's `sui_balance_mist`, whose single writer
 * `refresh_sui_balance` also paints the wallet bar) — not a store-bypassing fullnode getBalance per sign. The
 * refresh WRITES the home, so the next sign routes off it for free and the read is bounded by the home's own
 * freshness window, never one per transaction.
 */
async function client_resolved_route(
  initial: ReturnType<typeof decide_sponsor_route>,
  route_input: Parameters<typeof decide_sponsor_route>[0],
  resolve_balance_mist: () => Promise<bigint | null>
): Promise<ReturnType<typeof decide_sponsor_route>> {
  if (initial.route !== 'sponsored-first' || initial.reason === 'fresh-balance<=threshold') return initial
  const resolved_mist = await resolve_balance_mist().catch((error) => {
    game_log('tx', 'sponsor route balance refresh failed — retaining the initial route', error)
    return null
  })
  if (resolved_mist == null) return initial
  const rerouted = decide_sponsor_route({
    ...route_input,
    cached_balance_mist: resolved_mist,
    cached_balance_read_at_ms: Date.now(),
  })
  game_log('tx', sponsor_route_log(rerouted))
  return rerouted
}

// ── SELF-PAY DOOR ──────────────────────────────────────────────────────────────
/** Simulate-guard then sign and execute exactly once. A digest-bearing failure is returned, never retried.
 * @param keep_budget true for a terminal &Random tx (search/gather/crush/open/buy): keep the SDK builder's
 * pinned budget as the MAX bound while still running the refusal gate. PURELY a budget-pin directive — it does
 * NOT gate sponsorship (that is `sponsor_excluded`), so a non-money &Random tx is sponsor-eligible.
 * @param sponsor_excluded true for money PTBs whose `tx.gas` split must be funded only by the sender — the SOLE
 * sponsor exclusion (a sponsored gas coin would pay the price/royalty split off `tx.gas`).
 * @param gas_pin optional chained-turn gas-coin directive.
 * @param cached_balance_mist last observed balance, used only by sponsor-eligible routes.
 * @param cached_balance_read_at_ms epoch timestamp of that successful read; null means unknown/stale.
 * @param resolve_balance_mist #263's balance resolution, read from the caller's BALANCE HOME (#1854 — auth
 *   wires its store's own refresh here). Omitted ⇒ the fallback's direct fullnode reader, which is all a
 *   non-auth caller has.
 * @param want_effects opts into the certified gRPC execute result when the wallet supports sign-only.
 * @param sponsor_fallback TEST seam: the fallback's two effects (fresh balance read + the sponsor
 *   door), injected so the routing matrix unit-tests with plain fakes. Production callers omit it.
 */
// Complexity retained (#2069): execution is one transaction boundary whose ordered refusal, signing, and receipt paths share cleanup; there is no isolated phase to extract.
export async function execute_tx({
  wallet,
  address,
  transaction,
  chain,
  keep_budget = false,
  sponsor_excluded = false,
  gas_pin,
  cached_balance_mist = null,
  cached_balance_read_at_ms = null,
  resolve_balance_mist,
  want_effects = false,
  sponsor_fallback,
}: {
  wallet: WalletStandard
  address: string
  transaction: Transaction
  chain: string
  keep_budget?: boolean
  sponsor_excluded?: boolean
  gas_pin?: GasPin
  cached_balance_mist?: bigint | null
  cached_balance_read_at_ms?: number | null
  resolve_balance_mist?: () => Promise<bigint | null>
  want_effects?: boolean
  sponsor_fallback?: SponsorFallbackDeps
}): Promise<TxReceipt> {
  const feature = wallet.features['sui:signAndExecuteTransaction'] as SignAndExecuteFeature | undefined
  if (!feature?.signAndExecuteTransaction) throw new Error('Wallet does not support signAndExecuteTransaction')

  const is_zklogin = is_zklogin_wallet(wallet)
  // The sponsor door + FRESH fullnode balance reader, resolved ONCE (real in prod, injected in tests). Since
  // #1854 `fetch_balance_mist` serves ONLY the gas-selection fallback in the catch — a rare post-failure path
  // that must never sponsor blind, so it deliberately bypasses the (just-proven-wrong) balance home.
  const deps = sponsor_fallback ?? {
    fetch_balance_mist: () => read_sui_balance_mist(address),
    run_sponsored: (tx: Transaction) =>
      execute_sponsored_tx({ wallet, address, transaction: tx, chain, sponsor_url: SPONSOR_URL }),
  }

  const pref_on = use_settings.getState().sponsored_gameplay_enabled
  const route_input = {
    sponsor_excluded,
    is_zklogin,
    pref_on,
    cached_balance_mist,
    cached_balance_read_at_ms,
  }
  let initial_route = decide_sponsor_route(route_input)
  game_log('tx', sponsor_route_log(initial_route))
  // #263 (the auto-pass wedge): the CLIENT — never the @server — decides self-pay vs sponsor. A funded wallet
  // resolves its OWN balance and self-pays directly rather than earning a self-pay-required 400 that once froze a
  // live auto-pass at "AUTO PASS IN 0s". See client_resolved_route.
  initial_route = await client_resolved_route(
    initial_route,
    route_input,
    resolve_balance_mist ?? deps.fetch_balance_mist
  )

  let sponsor_refused = false
  // The honest sponsor refusal to surface if self-pay below ALSO fails on gas selection (a truly-broke wallet the
  // whole game is meant to sponsor). Owner P1 07-19: search/engage bust the station's per-tx ceiling → the station
  // refuses → the client silently self-paid → a zero-SUI wallet was told "you need ~0.4 SUI free" (a LIE for a tx it
  // was never meant to pay). Captured for EVERY refusal EXCEPT `self-pay-required` — that one means the @server saw a
  // FUNDED 0.2–0.4-SUI wallet, so the wallet's own "need ~0.4 SUI" gas copy is the TRUTHFUL message and must stand.
  let sponsor_refusal_error: unknown = null

  if (initial_route.route === 'sponsored-first') {
    let sponsored: SponsoredReceipt | null = null
    try {
      sponsored = await deps.run_sponsored(transaction)
    } catch (sponsor_error) {
      // PRE-flight sponsor refusal (nothing executed, zero gas). Daily-cap, outdated-package and would-abort are
      // blocking: never spend past the free promise, never execute a retired PTB, and never self-pay-retry a PTB
      // the sponsor's dry-run already proved aborts (#1385 — it would abort self-paid too, and the fallback's
      // gas-selection catch would replace the honest decoded cause with a balance error on a zero-SUI wallet).
      // Outcome-unknown is the fourth and the strictest: it is the ONE refusal that is NOT proven pre-execution —
      // the /execute answer was lost, so the transaction may be on chain with its gas burned. Self-paying it would
      // sign and submit it a SECOND time; the ambiguity is surfaced instead ("do not retry"), never re-signed.
      // Every other refusal (funded self-pay-required / drained pool / generic 400 / network) may self-pay below.
      if (
        is_sponsor_daily_cap_refusal(sponsor_error) ||
        is_sponsor_outcome_unknown_refusal(sponsor_error) ||
        is_sponsor_outdated_package_refusal(sponsor_error) ||
        is_sponsor_would_abort_refusal(sponsor_error)
      )
        throw sponsor_error
      game_log('tx', 'sponsored-first refused (non-cap) — self-paying:', sponsor_error)
      sponsor_refused = true
      sponsored = null
      // Keep the (already-humanized) refusal so a broke wallet gets the HONEST sponsor copy, not a balance demand.
      // NOT for self-pay-required: a funded 0.2–0.4-SUI wallet genuinely must free ~0.4 SUI — that copy is truthful.
      if (!is_sponsor_self_pay_refusal(sponsor_error)) sponsor_refusal_error = sponsor_error
    }
    if (sponsored) {
      // A digest '' = the sponsored pre-flight dry-run refused (zero gas); a real digest = an EXECUTED on-chain
      // failure (gas burned). Either way surface the cause — NEVER self-pay-retry (a would-fail tx fails self-paid
      // too; an executed failure must never re-run). PRE-FLIGHT MARKER (honesty-split bug, found
      // while fixing "generic refusal, zero indication of the actual reason"): a bare `new Error(...)` here had NO
      // `.cause` and NO `SimulationError` name, so is_preflight_refusal() could NEVER see a zero-gas sponsored
      // refusal as pre-flight — an UNMAPPED code on this route showed "executed, gas was spent, don't retry"
      // for a tx that burned NOTHING (digest ''). Route through the ONE decoder (tx_error) with the digest-derived
      // preflight flag so the marker, the decode, AND the "must say why" reason line all apply uniformly here too.
      // #1862: the certified /execute answer rides back as `effects_result` when the station carried the
      // objectChanges, so callers read the same door on both routes and skip their waitForTransaction leg.
      if (sponsored.effects.status.status === 'success')
        return {
          digest: sponsored.digest,
          ...(sponsored.effects_result ? { effects_result: sponsored.effects_result } : {}),
        }
      throw attach_executed_digest(
        tx_error(sponsored.effects.status.error, { preflight: !sponsored.digest }),
        sponsored.digest
      )
    }
  }

  // A refusal is pre-execution (zero gas), so the same PTB may self-pay. Emit the final route separately and do
  // not re-enter the sponsor from the gas-selection catch: if self-pay also refuses, its original error follows
  // the shared humanized insufficient-balance copy path.
  if (sponsor_refused)
    game_log('tx', sponsor_route_log(decide_sponsor_route({ ...route_input, sponsor_refused: true })))
  try {
    // Dry-run + budget-pin + ceiling-refuse before the wallet ever signs (zero-gas refusal). For &Random
    // buys the tx SHAPE is simulatable (only the random VALUE is not) — so the refuse gate applies and the
    // builder's pinned budget is kept as the MAX bound. A solo commit (gas_pin.skip_sim) skips the dry-run.
    const t0 = now()
    await guard(address, transaction, !keep_budget, gas_pin?.skip_sim ?? false)
    // GAS-COIN PIN (fix #1): a chained turn commit pins the fight's gas coin + epoch price so the wallet's
    // build resolves NO gas round-trip; every other tx invalidates the pin (equivocation guard). The pin is
    // applied AFTER guard so the budget (measured or computation-padded) is set — payment+price+budget all set +
    // inputs pinned ⇒ needsTransactionResolution is false ⇒ zero build round-trip (VERIFIED @mysten/sui 1.45).
    if (gas_pin) apply_pinned_gas(transaction)
    else invalidate_gas_coin()
    const t1 = now() // dry-run (or a cached / skipped ~0 hit) done

    // EXECUTE-CERT fast path (`want_effects`, the fight commit choke): sign-only via the wallet, submit through
    // the SAME gRPC door the sponsored path already uses, requesting the FULL include up front — the certified
    // effects come back in the execute round-trip itself, so the caller's separate waitForTransaction read
    // (~570ms measured fullnode read-lag) is skipped entirely. ONE submit, NEVER retried; an EXECUTED failure
    // parses as {FailedTransaction} and is RETURNED like any receipt (digest = gas burned — caller's to surface);
    // a PRE-execution rejection throws into the ordinary catch below (zero gas).
    const st = want_effects ? (wallet.features['sui:signTransaction'] as SignTransactionFeature | undefined) : null
    if (st?.signTransaction) {
      const { signature, bytes } = await st.signTransaction({ account: { address }, transaction, chain })
      const { grpc_client } = await get_sdk()
      const res = await grpc_client.core.executeTransaction({
        transaction: fromBase64(bytes),
        signatures: [signature],
        include: { effects: true, objectTypes: true, events: true },
      })
      stamp_preflight(transaction, t1 - t0, now() - t1) // ?txtiming=1: dry-run ms + sign+submit ms (wait leg ≈ 0)
      return record_self_paid_receipt(address, {
        digest: (res.Transaction ?? res.FailedTransaction).digest,
        effects_result: res,
      })
    }

    const receipt = await feature.signAndExecuteTransaction({ account: { address }, transaction, chain })
    stamp_preflight(transaction, t1 - t0, now() - t1) // ?txtiming=1: dry-run ms + wallet sign+submit ms
    return record_self_paid_receipt(address, receipt)
  } catch (error) {
    // Everything the try can throw is PRE-execution (guard refusals; the wallet's build/sign/gas-selection
    // — an EXECUTED failure returns a receipt/{FailedTransaction}, it never throws), so ZERO gas is spent when
    // we get here. Sole caveat (want_effects, same class the wallet's own remote execute always had): a network
    // drop BETWEEN submit and response is ambiguous — it surfaces raw below (not gas-selection class), and NO
    // layer auto-retries it, so the ambiguity can never double-fire. A pinned commit that threw may have raced
    // a stale gas coin (a PRE-exec object-version rejection — no gas burned): drop the pin so the retry selects
    // fresh. attempt_sponsor_fallback re-routes ONLY the gas-selection class on a low zkLogin wallet; every
    // other error is rethrown untouched.
    if (gas_pin) invalidate_gas_coin()
    // HONEST SPONSOR REFUSAL over a balance LIE (P1 07-19 — "Search failed: you need ~0.4 SUI free" on a
    // zero-SUI wallet the whole game is meant to sponsor; "can't engage either"). The sponsor-first route was
    // refused for a capacity/availability reason (over-ceiling / drained / station-down / reserve-failed — NOT the
    // funded self-pay-required case, which left sponsor_refusal_error null) AND self-pay then failed GAS SELECTION
    // (a truly-broke wallet). The station is the gate; when it can't serve, say SO — never demand the player buy
    // SUI for a free-game tx. Re-asking the sponsor here is pointless (it just refused), so bypass the fallback.
    if (sponsor_refusal_error != null && is_gas_selection_error(error)) throw sponsor_refusal_error
    return attempt_sponsor_fallback({
      error,
      // ONLY money-split PTBs (sponsor_excluded) + an already-refused sponsor stay OUT of the fallback; a
      // terminal-&Random gameplay tx (keep_budget) is sponsor-eligible and may ride it on a truly-low wallet.
      excluded: sponsor_excluded || sponsor_refused,
      is_zklogin,
      transaction,
      ...deps,
    })
  }
}

// ── SPONSORED DOOR (two-call station mode · docs/SPONSOR_TWO_CALL_CONTRACT.md) ───────────────────────────────
// The @server sponsor now fronts the Mysten sui-gas-pool STATION, which holds the sponsor key and SUBMITS the
// tx itself — the client NEVER submits a sponsored tx. Two calls replace the retired single POST:
//   1) POST /reserve {txKindBytes, sender, challenge, signature} → {reservationId, sponsorAddress, gasCoins,
//      gasBudget}. Same policy inputs as before (kind-only PTB + a zkLogin personal-message challenge); ALL money
//      + identity policy is enforced HERE (pre-gas, zero burn on refusal).
//   2) The client applies the reserved gas data to the SAME tx object (kind stays byte-identical), signs the SENDER
//      half, and POSTs /execute {reservationId, txBytes, userSig}. The station co-signs the gas half + submits +
//      returns the CERTIFIED effects — consumed DIRECTLY (zero fullnode wait). Used for create-character AND
//      join-world.

// SPONSOR-REFUSAL → SELF-PAY CONTRACT (funded-wallet join fix, money-UX review). ONLY the
// @server's > 0.2-SUI BALANCE RULE (api/sponsor.mjs SELF_PAY_MIST) is tagged for a SILENT self-pay re-route: a
// funded wallet ALREADY holds its own gas and was ALWAYS meant to pay it (the money policy — not a spend past
// any "free" promise). PRE-execution (no digest, zero gas) ⇒ safe; auto_join_world detects the tag and self-pays
// the SAME tx. Other tagged refusals are explicit blockers: DAILY_CAP never auto-spends past the free promise;
// OUTDATED_PACKAGE never executes a retired PTB and opens the upgrade modal. Untagged global caps, rate limits,
// a drained pool, and auth all surface honestly. Markers let callers branch WITHOUT parsing localized copy.
export const SPONSOR_REFUSAL_SELF_PAY = 'self-pay-required'
export function is_sponsor_self_pay_refusal(error: unknown): boolean {
  return (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal === SPONSOR_REFUSAL_SELF_PAY
}

// DAILY FREE-TIER CAP tag — one sponsor refusal that must NOT silently self-pay (never auto-spend
// past the free promise). Tagged on the SAME `sponsor_refusal` field (NOT string-matched — the copy is localized)
// so the sponsor-FIRST route blocks on it (honest cap error).
export const SPONSOR_REFUSAL_DAILY_CAP = 'daily-cap'
export function is_sponsor_daily_cap_refusal(error: unknown): boolean {
  return (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal === SPONSOR_REFUSAL_DAILY_CAP
}

/**
 * Build the KIND-ONLY sponsored bytes, offline-first. FAST PATH: `build({ onlyTransactionKind: true })` with NO
 * client — the create-character PTB's inputs are all statically-resolved SharedObjectRefs (SDK
 * `aresrpg_shared_ref`) / in-tx results, so it needs no resolution round-trip. FALLBACK (P0 2026-07-09,
 * live join_world crash): a sponsored PTB carrying RUNTIME object inputs — join_world binds the world SHARED
 * object + the player's kiosk & cap OWNED objects — has `UnresolvedObject` inputs, and @mysten/sui's
 * `needsTransactionResolution` demands a client to resolve them EVEN for a kind-only build, so the offline build
 * correctly throws "No sui client passed … not sufficient to build offline". On THAT specific failure we rebuild
 * WITH the gRPC core client (`client.core.getObjects`/`getMoveFunction` resolve the refs) — still kind-only, so
 * gas + sender stay the sponsor's, untouched. gRPC ONLY (reads never go through GraphQL / json-rpc —
 * the retired GraphQL build_client was crashing create here). Exported so the fallback branch is unit-tested.
 *
 * SENDER-FIRST (live layer-2 fix, 2026-07-09): the gRPC resolver (grpc/core.mjs resolveTransactionData) stamps
 * sender 0x0000… when unset before its node-side simulateTransaction — the node then REJECTS the player's OWNED
 * inputs (kiosk/cap): "Object … is owned by 0x…, but given owner/signer address is 0x0000…". So the sender is set
 * UNCONDITIONALLY before building — harmless on the offline fast path, and the emitted kind-only bytes remain
 * sender-free by construction (TransactionKind carries no sender/gas); the resolver just gains sender context.
 * @param transaction the sponsored PTB (any inputs)
 * @param sender the wallet address whose owned objects the PTB binds (the sponsored tx's sender half)
 */
export async function build_sponsored_kind(transaction: Transaction, sender: string): Promise<Uint8Array> {
  transaction.setSenderIfNotSet(sender)
  try {
    return await transaction.build({ onlyTransactionKind: true })
  } catch (error) {
    // ONLY the offline-insufficiency error falls back to a resolving build — a genuine build bug still throws its
    // own cause (the with-client build would re-throw it anyway; matching keeps the fast path's error honest and
    // skips a needless RPC round-trip on unrelated failures).
    if (!/sufficient to build offline|No sui client/i.test(String((error as { message?: unknown })?.message ?? error)))
      throw error
    const { grpc_client } = await get_sdk()
    return transaction.build({ client: grpc_client, onlyTransactionKind: true })
  }
}

/**
 * Did the @server refuse for `refusal`? The machine `reason` on the wire is THE contract — the two money
 * refusals below decide whether the player's own SUI gets spent, so a copy edit on the @server (or a locale
 * pass over its diagnostics) must not be able to un-tag them. The text match survives only as the
 * un-rolled-@server fallback: a client refresh reaches players before the sponsor image rolls, so a body that
 * carries NO reason at all is still decoded — and every such hit is logged as the drift it is. When a reason IS
 * present it is authoritative: a rolled @server that says something else is never overridden by its own prose.
 * REMOVAL TRIGGER: delete the `legacy` arm once the rolled @server (this commit's api/sponsor.mjs) is the floor.
 */
function refused_for(refusal: string, reason: string | null, detail: string, legacy: RegExp): boolean {
  if (reason === refusal) return true
  if (reason != null || !legacy.test(detail)) return false
  game_log('tx', `sponsor refusal "${refusal}" recovered from server TEXT — @server predates the machine reason`)
  return true
}

// THE single sponsor error humanizer (docs/SPONSOR_TWO_CALL_CONTRACT.md §"Error decoder keys") — maps the
// station sponsor's `error` string prefix / HTTP status to ONE decoder key via the shared choke. Every throw
// path here is PRE-execution (reserve refuses before any gas; an execute 400 is a station pre-exec rejection /
// released reservation), so NOTHING is ever charged when this fires — safe to surface, never auto-retried. Three
// markers ride on `sponsor_refusal` so a caller can branch WITHOUT string-parsing localized copy: SELF_PAY
// (funded > 0.2 SUI — the ONLY silent self-pay re-route), DAILY_CAP (never auto-spend past the free promise),
// and OUTDATED_PACKAGE (block and refresh onto the latest release).
function map_sponsor_error(
  detail: string,
  status: number,
  reason: string | null,
  chain_error_field: string | null = null
): Error {
  // WOULD-ABORT (#1385): the sponsor's dry-run proved this PTB aborts, so it refused BEFORE reserving gas —
  // nothing signed, nothing executed, zero spend anywhere. The chain's own error arrives in its OWN field
  // (#796); decode it through the ONE abort-copy table with `preflight: true` so the player reads the real cause
  // ("not your turn", "already listed") with its zero-gas provenance, never the burn-law "gas was spent" copy.
  // The prefix-strip stays as the FALLBACK, not as the contract: a client refresh reaches players before the
  // @server image rolls, so this must keep decoding the older body shape that carried the cause in `error` only.
  if (reason === SPONSOR_REFUSAL_WOULD_ABORT) {
    const chain_error = chain_error_field ?? detail.replace(/^sponsor-would-abort:\s*/, '')
    const would_abort = tx_error(chain_error, { preflight: true }) as Error & { sponsor_refusal?: string }
    would_abort.sponsor_refusal = SPONSOR_REFUSAL_WOULD_ABORT
    return would_abort
  }
  // UNPRICEABLE (#796): the @server could not read a verdict out of its own simulation, or could not reach the
  // node at all. Machine-marked so this branches on a REASON instead of matching `/unpriceable/` against a
  // server-authored diagnostic — and marked so a caller can tell "we could not tell" apart from "you would
  // fail". Nothing was reserved on either path, so the copy is the same honest retry-later line.
  if (reason === SPONSOR_REFUSAL_SIMULATION_UNREADABLE || reason === SPONSOR_REFUSAL_SIMULATION_INFRASTRUCTURE) {
    const unpriceable = new Error(i18n.t('errors.sponsor_unpriceable')) as Error & { sponsor_refusal?: string }
    unpriceable.sponsor_refusal = reason
    return unpriceable
  }
  // STRICT PACKAGE UPGRADE: the @server structurally identifies a retired aresrpg package. Keep the marker on
  // the humanized error so routing refuses immediately and the transaction edge can open the blocking modal.
  // A generic sponsor-scope refusal is intentionally NOT treated as outdated (it may be a malformed PTB).
  if (reason === SPONSOR_REFUSAL_OUTDATED_PACKAGE || status === 410 || /sponsor-two-call-upgrade/i.test(detail)) {
    const outdated = new Error(i18n.t('errors.sponsor_stale_client')) as Error & { sponsor_refusal?: string }
    outdated.sponsor_refusal = SPONSOR_REFUSAL_OUTDATED_PACKAGE
    return outdated
  }
  // BALANCE RULE (funded > 0.2 SUI): the player ALREADY holds their own gas, so self-pay is the INTENDED route
  // (money policy, not a spend past any "free" promise). TAG it so the caller SILENTLY self-pays the SAME tx.
  if (refused_for(SPONSOR_REFUSAL_SELF_PAY, reason, detail, /self-pay-required|balance exceeds/i)) {
    const refusal = new Error(i18n.t('errors.sponsor_self_pay')) as Error & { sponsor_refusal?: string }
    refusal.sponsor_refusal = SPONSOR_REFUSAL_SELF_PAY
    return refusal
  }
  // DAILY FREE-TIER CAP (NEVER auto-spend past the free promise): TAG it so the sponsor-FIRST route
  // blocks honestly instead of self-paying the ≤0.2 wallet's dust; the shared decoder shows the clean cap copy.
  if (refused_for(SPONSOR_REFUSAL_DAILY_CAP, reason, detail, /daily free gameplay/i)) {
    const capped = new Error(i18n.t('errors.sponsor_daily_limit')) as Error & { sponsor_refusal?: string }
    capped.sponsor_refusal = SPONSOR_REFUSAL_DAILY_CAP
    return capped
  }
  // THE @SERVER REFUSED ON ITS OWN RAILS — no shared anti-drain store to count against, or a request whose
  // client identity no edge vouched for. Nothing is reserved or signed on either, and the player's read is the
  // same as an unreachable sponsor. It sits ABOVE the throttle arm on purpose: `sponsor-unavailable` is a PREFIX
  // CONTRACT the @server owns, while the throttle arm below still matches loose PROSE — and a diagnostic that
  // merely mentions throttling would otherwise be humanized as "wait a moment", telling a player to wait out an
  // outage that waiting cannot fix. A prefix contract always outranks a prose match.
  if (/^sponsor-unavailable/i.test(detail)) return new Error(i18n.t('errors.sponsor_unreachable'))
  // RATE-LIMITED — per-IP 429 or the per-address 400 'rate-limited'. Transient throttle; nothing charged.
  if (status === 429 || /rate[-\s]?limit/i.test(detail)) return new Error(i18n.t('errors.sponsor_rate_limited'))
  // zkLogin challenge rejected (not an Enoki identity / stale challenge) — honest auth error, re-sign a fresh one.
  if (/zklogin-/i.test(detail)) return new Error(i18n.t('errors.sponsor_zklogin'))
  // PTB outside the aresrpg allowlist — honest "not sponsorable" (should never fire for an SDK-composed PTB).
  if (/sponsor-scope/i.test(detail)) return new Error(i18n.t('errors.sponsor_scope'))
  // sim failed / would-fail tx — can't be priced; never guess a budget past the ceiling.
  if (/sponsor-unpriceable|unpriceable/i.test(detail)) return new Error(i18n.t('errors.sponsor_unpriceable'))
  // derived budget over the per-tx ceiling — too gas-heavy to sponsor; the player pays it themselves.
  if (/sponsor-over-ceiling/i.test(detail)) return new Error(i18n.t('errors.sponsor_over_ceiling'))
  // station rejected the reservation (e.g. > 0.1 SUI/req cap) — honest; top up to self-pay, or retry.
  if (/sponsor-reserve-failed/i.test(detail)) return new Error(i18n.t('errors.sponsor_reserve_failed'))
  // EXECUTE-side pre-execution states — reservation expired/used/foreign, built-tx mismatch (client bug), or the
  // station's pre-exec rejection. All carry NO digest (nothing charged) and the fix is identical: retry the action.
  if (/sponsor-reservation-unknown|sponsor-tx-mismatch|sponsor-tx-invalid|sponsor-exec-rejected/i.test(detail))
    return new Error(i18n.t('errors.sponsor_retry'))
  // station unreachable / HTTP error / misconfig — transient infra (a reserve may retry; an execute must NOT).
  if (/sponsor-station-(down|error)|sponsor-misconfig/i.test(detail))
    return new Error(i18n.t('errors.sponsor_unreachable'))
  // drained pool (legacy '@server has no SUI coins for gas') — honest, nothing to sponsor against right now.
  if (/no SUI coins|no gas coins|insufficient[_\s]?gas/i.test(detail)) return new Error(i18n.t('errors.sponsor_empty'))
  // sponsor-busy (gas-coin contention, pre-sign) — nothing charged; retry.
  if (/sponsor-busy/i.test(detail)) return new Error(i18n.t('errors.tx_lock_race_retry'))
  // Anything else — keep the raw diagnostic so a genuine bug surfaces its cause (never a silent spend).
  return new Error(`Sponsor request failed (${status})${detail ? `: ${detail}` : ''}`)
}

function decode_sponsor_error(body: string): { detail: string; reason: string | null; chain_error: string | null } {
  try {
    const decoded = JSON.parse(body) as { error?: unknown; reason?: unknown; chain_error?: unknown }
    return {
      detail: typeof decoded.error === 'string' ? decoded.error : body,
      reason: typeof decoded.reason === 'string' ? decoded.reason : null,
      // #796 — the chain's own failure string in its OWN field, so the would-abort path never has to strip a
      // prefix back off a human-readable message to recover the machine-readable half it needs.
      chain_error: typeof decoded.chain_error === 'string' ? decoded.chain_error : null,
    }
  } catch {
    // Compatibility with station/test doubles that return a plain-text diagnostic.
    return { detail: body, reason: null, chain_error: null }
  }
}

/** The LOST-RECEIPT refusal (client-minted, blocking). Its only job is to keep a possibly-executed transaction
 * out of every re-signing path — see SPONSOR_REFUSAL_OUTCOME_UNKNOWN. */
function sponsor_outcome_unknown_error(): Error & { sponsor_refusal?: string } {
  const unknown = new Error(i18n.t('errors.sponsor_outcome_unknown')) as Error & { sponsor_refusal?: string }
  unknown.sponsor_refusal = SPONSOR_REFUSAL_OUTCOME_UNKNOWN
  return unknown
}

/** POST a JSON body to a sponsor endpoint and return the parsed JSON, or throw a HUMANIZED (decoder-mapped,
 * machine-tagged where policy needs branching) error on any non-2xx. An UNREACHABLE door (fetch rejects before
 * an HTTP status) is a network fault — honest, retry-able, zero gas — never a drained pool.
 * @param post_submit true for the /execute leg ONLY. That leg is answered AFTER the station submitted and waited
 *   for finality, so "no answer" is not "nothing happened": a transport fault, a 5xx from anything in the path,
 *   or an unreadable success body all leave the outcome UNKNOWN (the digest may exist, the gas may be burned).
 *   Those become the blocking outcome-unknown refusal instead of a retry-able network error — the tx-retry-burn
 *   law applies to every wrapper, not just the self-pay branch. A DECODED 4xx keeps its ordinary mapping: the
 *   station rejects pre-execution (unknown/expired reservation, tx mismatch, its own pre-exec rejection) and
 *   charges nothing. */
async function sponsor_fetch(url: string, body: unknown, post_submit = false): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    if (post_submit) throw sponsor_outcome_unknown_error()
    throw new Error(i18n.t('errors.sponsor_unreachable'))
  }
  if (response.ok) {
    try {
      return await response.json()
    } catch (error) {
      if (post_submit) throw sponsor_outcome_unknown_error() // answered, but the receipt did not survive the wire
      throw error
    }
  }
  if (post_submit && response.status >= 500) throw sponsor_outcome_unknown_error()
  const response_body = await response.text().catch((error) => {
    game_log('tx', 'sponsor refusal body was unreadable — retaining the HTTP refusal', error)
    return ''
  })
  const { detail, reason, chain_error } = decode_sponsor_error(response_body)
  throw map_sponsor_error(detail, response.status, reason, chain_error)
}

/**
 * @param build_client DEPRECATED, unused: the kind-only build now self-heals via `build_sponsored_kind` above
 *   (offline-first, gRPC-client fallback for runtime object inputs). Param kept so caller signatures stay stable.
 * @param sponsor_url  the @server sponsor endpoint BASE (env-injected so this module stays side-effect-free) —
 *   /reserve and /execute are POSTed under it (station two-call contract).
 */
export async function execute_sponsored_tx({
  wallet,
  address,
  transaction,
  chain,
  sponsor_url,
}: {
  wallet: WalletStandard
  address: string
  transaction: Transaction
  chain: string
  build_client?: unknown
  sponsor_url: string
}): Promise<SponsoredReceipt> {
  // MONEY LAW (#73, structural single-home): sponsorship is zkLogin-only. Every sponsored path funnels
  // through this one door, so refusing a non-Enoki (wallet) session HERE — PRE-network, humanized — makes
  // the sponsor structurally unreachable for a connected wallet (it self-pays). Test: wallet_self_pay.test.ts.
  if (!is_zklogin_wallet(wallet)) throw new Error(i18n.t('errors.sponsor_zklogin_only'))

  // (The S-64 client-direct station flag that used to branch here was DELETED 07-10: the
  // Mysten sui-gas-pool is an identity-blind internal primitive — only the fronting sponsor service may
  // reach it. sponsor.mjs delegating its gas mechanics to the station later is a backend-only swap; this
  // door and its callers stay byte-identical.)

  // #51.1 zkLogin gate: prove the sender is a zkLogin (Enoki) identity by signing a fresh, sender-bound
  // challenge with the wallet's personal-message signer. The sponsor re-derives the exact message,
  // verifies the sig against `sender` AND asserts the scheme is zkLogin (frontend is not trusted).
  // Resolved BEFORE the build so an unsupported wallet still refuses without building anything.
  const pm = wallet.features['sui:signPersonalMessage'] as SignPersonalMessageFeature | undefined
  if (!pm?.signPersonalMessage) throw new Error('Wallet does not support signPersonalMessage')
  const challenge = `aresrpg-sponsor:${address}:${Date.now()}`
  // FIRST SIGN of a fresh zkLogin session — Enoki generates the zkLogin proof LAZILY on the first sign
  // (wallet.mjs createZkLoginZkp), so a brand-new / second Google account reaching create signs for the very
  // first time RIGHT HERE, before the sponsor POST. If Enoki's proving fails (a not-yet-ready or second-session
  // proof), signPersonalMessage REJECTS with a raw Enoki error — no tx built, no digest, ZERO gas. Left
  // unwrapped that raw error leaked into the shared decoder's generic fallback and mislabelled a pre-send sign
  // failure as "failed on-chain — nothing was changed" (the P0 second-account bug: the sponsor counters prove
  // the POST below never fired). Convert it to the honest pre-send sign-verification copy (re-sign & retry),
  // keeping the mechanical cause in the console (no-silent-failure law).
  const sign_challenge = async () => {
    try {
      return await pm.signPersonalMessage({
        account: { address },
        message: new TextEncoder().encode(challenge),
        chain,
      })
    } catch (error) {
      game_log('sponsor', 'zkLogin personal-message sign failed (pre-POST, zero gas):', error)
      throw new Error(i18n.t('errors.sponsor_zklogin'))
    }
  }
  // #1663 PREPARE LEG, CONCURRENT: the kind-only bytes and the challenge signature are INDEPENDENT — the
  // challenge is `aresrpg-sponsor:<sender>:<ms>` and never reads the PTB, and the build never reads the
  // signature — yet they were awaited in series, so every sponsored transaction paid build THEN zkp-sign before
  // its first byte reached /reserve (on a fresh Enoki session the sign leg is the lazy zkLogin PROOF fetch, the
  // slowest single hop in the flow). Racing them makes the leg cost max() instead of sum(). The challenge
  // timestamp is minted before both, so it only gets FRESHER against the sponsor's 5-minute TTL
  // (SPONSOR_CHALLENGE_TTL_MS / assert_zklogin_challenge), never staler. Order of the POST body is unchanged.
  // Each leg is timed AT the leg (?txtiming=1 only prints it — the marks themselves are two now() calls).
  const sponsored_started = now()
  const [built, signed] = await Promise.all([
    timed(() => build_sponsored_kind(transaction, address)),
    timed(sign_challenge),
  ])
  const kind = built.value
  const { signature } = signed.value
  const prepare_ms = now() - sponsored_started

  // ── RESERVE (endpoint 1) ── same policy inputs as the retired single call (the kind-only PTB + the zkLogin
  // challenge). The sponsor enforces ALL money + identity policy HERE (pre-gas); any refusal is decoder-mapped by
  // sponsor_fetch (PRE-execution, zero gas). `self-pay-required` comes back TAGGED so the caller silently self-pays.
  mark_engage_reserve_started(transaction)
  const reserved = await timed(() =>
    sponsor_fetch(`${sponsor_url}/reserve`, {
      txKindBytes: toBase64(kind),
      sender: address,
      challenge,
      signature,
    })
  )
  const { reservationId, sponsorAddress, gasCoins, gasBudget } = reserved.value
  mark_engage_reserve_finished(transaction)

  // ── BETWEEN THE CALLS ── apply the reserved gas EXACTLY to the SAME tx object (the kind stays byte-identical, so
  // the station's re-parse matches the reservation — do NOT rebuild the PTB from scratch; carry the object through).
  transaction.setSender(address)
  transaction.setGasOwner(sponsorAddress)
  transaction.setGasPayment(gasCoins)
  transaction.setGasBudget(gasBudget)

  // The reservation's server-priced budget is the sponsored trust anchor: /reserve already simulated this kind,
  // and /execute verifies it is still byte-identical. Do not repeat that transport dry-run here. Self-pay remains
  // behind guard()'s client-side simulation above.
  mark_engage_simulation_finished(transaction)

  // Sign the SENDER half — the wallet builds + signs the SAME (gas-pinned) tx and returns the EXACT bytes it
  // signed; those bytes go to /execute so the sender signature covers them byte-for-byte (mirrors the self-pay
  // sign-only fast path). The station holds the sponsor gas signature and co-signs + SUBMITS — the client NEVER
  // submits a sponsored tx.
  const st = wallet.features['sui:signTransaction'] as SignTransactionFeature | undefined
  if (!st?.signTransaction) throw new Error('Wallet does not support signTransaction')
  const wallet_signed = await timed(() => st.signTransaction({ account: { address }, transaction, chain }))
  const { signature: userSig, bytes: txBytes } = wallet_signed.value
  mark_engage_wallet_signed(transaction)

  // ── EXECUTE (endpoint 2) ── the station co-signs the gas half + submits + returns the CERTIFIED effects. A
  // present `effects` ⇒ the tx EXECUTED (gas burned) — NEVER retried (tx-retry-burn law); an execute 400 is a
  // PRE-execution rejection decoder-mapped by sponsor_fetch (nothing charged). Consume the effects DIRECTLY (this
  // is faster than any client-side wait — the station already waited for finality). `post_submit` marks the leg
  // as unanswerable-by-silence: every failure shape that cannot PROVE non-execution refuses BLOCKING instead of
  // falling through to a self-pay re-sign of a transaction that may already be on chain.
  const executed = await timed(() => sponsor_fetch(`${sponsor_url}/execute`, { reservationId, txBytes, userSig }, true))
  const { effects, digest } = executed.value
  mark_engage_execution_finished(transaction)
  flush_sponsor_legs({
    build_ms: built.ms,
    zkp_sign_ms: signed.ms,
    prepare_ms,
    reserve_ms: reserved.ms,
    wallet_sign_ms: wallet_signed.ms,
    execute_ms: executed.ms,
    total_ms: now() - sponsored_started,
  })
  const ok = effects?.status?.status === 'success'
  const receipt_digest = digest ?? effects?.transactionDigest ?? ''
  // #1862 ADOPTION ON THE CERTIFIED RECEIPT. The station waited for finality before answering, and (since the
  // /execute response carries objectChanges + events) that answer already names every object the transaction
  // created, WITH its on-chain type. Hand it back through the SAME `effects_result` door the self-pay
  // execute-cert lane uses, so a sponsored create proceeds on the execute round-trip instead of paying a
  // separate waitForTransaction + read-layer catch-up (the structural half of the ≈7s felt create).
  // NOT a second submit and never a retry — this is the proof of the ONE execution that already happened.
  // A station that cannot carry the changes yields null here, and the caller keeps its honest wait.
  const effects_result = sponsored_execute_result(executed.value, receipt_digest)
  return {
    digest: receipt_digest,
    ...(effects_result ? { effects_result } : {}),
    effects: {
      status: {
        status: ok ? 'success' : 'failure',
        // The station returns JSON-RPC effects — `status.error` is ALREADY the legacy MoveAbort STRING the shared
        // decoder maps (create-modal name-taken via roster/store.ts's ENAME_TAKEN, abort_copy's TABLE, etc.);
        // pass a string straight through, format_abort only a structured error (defensive — a future gRPC station).
        error: ok
          ? undefined
          : typeof effects?.status?.error === 'string'
            ? effects.status.error
            : format_abort(effects?.status?.error),
      },
    },
  }
}

// gRPC returns a STRUCTURED ExecutionError; the create-character consumer (roster/store.ts) still matches
// the OLD JSON-RPC error-string shape — `ENAME_TAKEN = /106\) in command/` and abort_copy.js's ABORT_RE.
// Reconstruct a string that matches BOTH so name-taken detection and abort-code → player-copy keep working
// byte-for-byte. Non-MoveAbort errors pass their `.message` through (abort_copy.js jargon-gates any chain blob).
function format_abort(error: unknown): string {
  const e = error as
    { message?: string; MoveAbort?: { abortCode?: string; location?: { module?: string } } } | null | undefined
  const ab = e?.MoveAbort
  if (ab?.abortCode != null) {
    const module = ab.location?.module ?? 'unknown'
    return `MoveAbort(MoveLocation { module: Identifier("${module}") }, ${ab.abortCode}) in command 0`
  }
  return e?.message ?? 'Transaction failed'
}
