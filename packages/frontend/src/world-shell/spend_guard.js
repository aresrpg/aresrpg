// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPEND GUARD (#1262) — the MECHANICAL burn law at the client's transaction door.
//
// The incident: a character escrowed in a stale fight made the client re-attempt the expired-turn advance every
// poll. Each attempt EXECUTED and failed — a digest exists, so gas was spent — and 0.0213 SUI burned in one boot.
// The burn law ("a digest = gas burned; an executed failure is never auto-retried") already existed as PROSE,
// re-derived by hand in half a dozen callers, each with its own heuristic. Prose does not survive pressure. This
// module is that law as a machine: one plain-data ledger, pure decision functions over it, and ONE gate — the
// `run_character_action` lane in tx.js — that every automated gameplay submission already passes through.
//
// THREE GATES, all scoped to AUTOMATED submissions only (a player pressing a button is never blocked by us):
//   ① CIRCUIT   — an EXECUTED FAILURE (a digest proves gas burned) opens that intent's circuit for the whole
//                 session. No automated resubmission of `advance_turn:0xFIGHT`, ever, until a reload.
//   ② BACKOFF   — a PRE-EXECUTION refusal (no digest: RPC refusal, simulate failure, network) burned nothing, so
//                 it stays retryable — on an exponential schedule with jitter, per intent, reset by a success.
//   ③ BREAKER   — automated submissions accrue a session gas ledger; past AUTOMATED_SPEND_CEILING_MIST ALL
//                 automated submissions freeze. The backstop for what ① cannot see: many DISTINCT intents each
//                 burning once, or automation that keeps SUCCEEDING and still runs away.
//
// PURE BY CONSTRUCTION. Everything above the "LEDGER DOOR" line is a transform over plain data — no i18n, no
// toast, no store, no clock of its own (`now` and `jitter` are injected). The player-facing line is returned as
// DATA (`spend_guard_notice`) and rendered by the edge that owns presentation (tx.js), so no callback here
// writes UI state.

import { error_executed_digest } from './tx_digest_error.js'

// ── CONSTANTS ────────────────────────────────────────────────────────────────────────────────────────────────

/** ② First retry wait after a pre-execution refusal, doubled per consecutive refusal. */
export const BACKOFF_BASE_MS = 1_000
/** ② The doubling stops here — a stalled dependency is polled once a minute, not abandoned. */
export const BACKOFF_CAP_MS = 60_000
/** ② Up to +25% of the computed wait, so N clients watching the same fight never re-converge on one instant. */
export const BACKOFF_JITTER_RATIO = 0.25

/**
 * ③ THE SESSION CEILING ON AUTOMATED GAS — 0.05 SUI. Derivation, from this repo's own numbers (one home):
 *  · CEILING ANCHOR: the sponsor policy's per-address DAILY cap is 1 SUI (`ADDR_DAILY_CAP_MIST`,
 *    api/sponsor_state.mjs) — the house's own statement of what one address may reasonably burn in a DAY,
 *    across every act. Automated janitor work (crank, force_start, the deadline auto-commit) is a small subset
 *    of a single SESSION, so a twentieth of a day's whole allowance is already generous to it.
 *  · FLOOR ANCHOR: a gameplay PTB runs ~0.002–0.003 SUI (stores/sui_send.ts pins a plain transfer at
 *    ~0.001–0.002; a fight PTB is a little more), so 0.05 SUI is ~20 automated transactions in one session —
 *    more than any honest run of deadline expiries produces, and ~2× the 0.0213 SUI that #1262 burned before
 *    a human noticed.
 * It is deliberately NOT #1262's fix: gate ① stops that loop at the SECOND submission, long before any
 * threshold. This is the backstop for the runaway shape a per-intent circuit cannot see.
 */
export const AUTOMATED_SPEND_CEILING_MIST = 50_000_000n

/**
 * Charged to the session ledger when the REAL number is unavailable — an executed failure hands us an error, not
 * a receipt. ~0.003 SUI, the upper end of the gameplay-PTB range above. Over-charging trips the breaker EARLIER,
 * which is the safe direction for a money guard.
 */
export const ASSUMED_TX_GAS_MIST = 3_000_000n

// ── PURE CORE ────────────────────────────────────────────────────────────────────────────────────────────────

/** @typedef {{ circuits: Record<string, { digest: string }>,
 *              backoff: Record<string, { attempts: number, retry_at_ms: number }>,
 *              automated_spend_mist: bigint }} SpendLedger */

/** @returns {SpendLedger} */
export const empty_spend_ledger = () => ({ circuits: {}, backoff: {}, automated_spend_mist: 0n })

const clamp01 = (/** @type {number} */ value) => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * PURE ② — the wait before the Nth consecutive pre-execution refusal may be retried. `jitter` is the caller's
 * random draw in [0,1), injected so the schedule is assertable.
 * @param {number} attempts consecutive refusals INCLUDING this one (1 = the first) @param {number} [jitter]
 * @returns {number} milliseconds
 */
export function backoff_delay_ms(attempts, jitter = 0) {
  const doublings = Math.max(0, Math.floor(attempts) - 1)
  const base = Math.min(BACKOFF_BASE_MS * 2 ** doublings, BACKOFF_CAP_MS)
  return base + Math.floor(base * BACKOFF_JITTER_RATIO * clamp01(jitter))
}

/** PURE ③ — has automated spend reached the session ceiling? @param {SpendLedger} ledger */
export const session_frozen = (ledger) => ledger.automated_spend_mist >= AUTOMATED_SPEND_CEILING_MIST

/**
 * PURE — net MIST a receipt's `gasUsed` actually cost (computation + storage − rebate). The ONE home for that
 * arithmetic; fight_gas_ledger.js's running fight total reads it too.
 * @param {{ computationCost?: string|number, storageCost?: string|number, storageRebate?: string|number }
 *          | null | undefined} gas_used
 * @returns {bigint}
 */
export function net_gas_mist(gas_used) {
  if (!gas_used) return 0n
  const gross = BigInt(gas_used.computationCost ?? 0) + BigInt(gas_used.storageCost ?? 0)
  return gross - BigInt(gas_used.storageRebate ?? 0)
}

/**
 * PURE — the gas a settled lane task actually spent, off whichever receipt shape it resolved with: tx.js's
 * `run()` returns `{ result, timing }`, dungeon_actions' `sign()` returns the normalized receipt itself. Both
 * carry the same `gasUsed`. Unknown shapes cost 0 (the caller falls back to ASSUMED_TX_GAS_MIST).
 * @param {any} value @returns {bigint}
 */
export const settled_gas_mist = (value) => net_gas_mist(value?.gasUsed ?? value?.result?.gasUsed)

/**
 * PURE — which side of the burn law a failure sits on. STRUCTURAL ONLY, never message text: the DIGEST is the
 * one proof that the transaction executed and the gas left the wallet, and #1262 is what message-text guessing
 * costs. Everything without one — a proven pre-flight refusal, a wallet rejection, a dropped socket, a bug —
 * is a refusal: nothing reached the chain, so it backs off rather than latching. That asymmetry is deliberate;
 * latching every unknown error would permanently disarm automation the first time a wifi hiccup landed.
 * @param {unknown} error @returns {{ kind: 'executed', digest: string } | { kind: 'refused' }}
 */
export function classify_submission_error(error) {
  const digest = error_executed_digest(error)
  return digest ? { kind: 'executed', digest } : { kind: 'refused' }
}

/**
 * PURE — may this submission go? Only AUTOMATED, intent-keyed submissions are the guard's subject: a
 * user-initiated act is the player spending the player's own gas on purpose, and is never refused here.
 * @param {SpendLedger} ledger
 * @param {{ intent?: string|null, automated?: boolean, now?: number }} request
 * @returns {{ allow: true } |
 *   { allow: false, reason: 'circuit_open', intent: string, digest: string } |
 *   { allow: false, reason: 'session_frozen', intent: string, spent_mist: bigint } |
 *   { allow: false, reason: 'backoff', intent: string, retry_at_ms: number }}
 */
export function spend_decision(ledger, { intent = null, automated = false, now = Date.now() } = {}) {
  if (!intent || !automated) return { allow: true }
  const circuit = ledger.circuits[intent]
  if (circuit) return { allow: false, reason: 'circuit_open', intent, digest: circuit.digest }
  if (session_frozen(ledger))
    return { allow: false, reason: 'session_frozen', intent, spent_mist: ledger.automated_spend_mist }
  const held = ledger.backoff[intent]
  if (held && now < held.retry_at_ms) return { allow: false, reason: 'backoff', intent, retry_at_ms: held.retry_at_ms }
  return { allow: true }
}

/**
 * PURE — consecutive PRE-EXECUTION refusals recorded for one intent (0 = none, or the last attempt succeeded).
 * The one honest measure of "this keeps refusing": #1383's auto-resolution loop reads it to decide when a result
 * is genuinely stuck (and worth a recovery surface) rather than merely lagging.
 * @param {SpendLedger} ledger @param {string} intent @returns {number}
 */
export const backoff_attempts = (ledger, intent) => ledger.backoff[intent]?.attempts ?? 0

/** PURE — is this intent permanently retired (an EXECUTED failure burned gas on it)? @param {SpendLedger} ledger
 * @param {string} intent @returns {boolean} */
export const circuit_open = (ledger, intent) => Boolean(ledger.circuits[intent])

const without = (/** @type {Record<string, any>} */ map, /** @type {string} */ key) => {
  const { [key]: _dropped, ...rest } = map
  return rest
}

const accrue = (/** @type {SpendLedger} */ ledger, /** @type {boolean} */ automated, /** @type {bigint} */ mist) =>
  automated && mist > 0n ? ledger.automated_spend_mist + mist : ledger.automated_spend_mist

/**
 * PURE ① — an EXECUTED failure. The circuit opens permanently for this intent (whoever initiated it: a
 * player's own failed act still proves the intent aborts on chain, so automation must not repeat it), the
 * backoff row is dropped as moot, and automated gas accrues.
 * @param {SpendLedger} ledger
 * @param {{ intent: string, digest: string, automated?: boolean, gas_mist?: bigint }} event
 * @returns {SpendLedger}
 */
export function note_executed_failure(ledger, { intent, digest, automated = false, gas_mist = ASSUMED_TX_GAS_MIST }) {
  return {
    circuits: { ...ledger.circuits, [intent]: { digest } },
    backoff: without(ledger.backoff, intent),
    automated_spend_mist: accrue(ledger, automated, gas_mist),
  }
}

/**
 * PURE ② — a PRE-EXECUTION refusal: nothing executed, nothing burned, so the intent stays retryable behind a
 * doubling wait. Nothing accrues to the spend ledger — there is no spend.
 * @param {SpendLedger} ledger
 * @param {{ intent: string, now?: number, jitter?: number }} event
 * @returns {SpendLedger}
 */
export function note_preflight_refusal(ledger, { intent, now = Date.now(), jitter = 0 }) {
  const attempts = (ledger.backoff[intent]?.attempts ?? 0) + 1
  return {
    ...ledger,
    backoff: { ...ledger.backoff, [intent]: { attempts, retry_at_ms: now + backoff_delay_ms(attempts, jitter) } },
  }
}

/**
 * PURE — a landed submission: the backoff schedule resets, and its REAL gas accrues when automated.
 * @param {SpendLedger} ledger @param {{ intent: string, automated?: boolean, gas_mist?: bigint }} event
 * @returns {SpendLedger}
 */
export function note_success(ledger, { intent, automated = false, gas_mist = 0n }) {
  return {
    ...ledger,
    backoff: without(ledger.backoff, intent),
    automated_spend_mist: accrue(ledger, automated, gas_mist),
  }
}

/**
 * PURE — the player-facing line an EVENT deserves, as data (the edge renders it through the toast home). Backoff
 * is machinery and never speaks; a permanently-dead intent and a frozen session are news.
 * @param {'circuit_open'|'session_frozen'|'backoff'|null} event
 * @returns {{ i18n_key: string } | null}
 */
export function spend_guard_notice(event) {
  if (event === 'circuit_open') return { i18n_key: 'errors.spend_guard_circuit_open' }
  if (event === 'session_frozen') return { i18n_key: 'errors.spend_guard_session_frozen' }
  return null
}

// ── LEDGER DOOR (module-owned state; still no I/O — the edge renders what these return) ───────────────────────

// eslint-disable-next-line functional/no-let -- module-owned session ledger, replaced (never mutated) by the pure reducers above
let ledger = empty_spend_ledger()

/** The live session ledger, for tests and `window.__SPEND_GUARD` inspection. @returns {SpendLedger} */
export const spend_guard_state = () => ledger

/** Session teardown / test isolation — a later session starts clean. */
export function reset_spend_guard() {
  ledger = empty_spend_ledger()
}

if (typeof window !== 'undefined') /** @type {any} */ (window).__SPEND_GUARD = spend_guard_state

/**
 * Gate a submission about to enter the lane. @param {{ intent?: string|null, automated?: boolean }} request
 * @returns {ReturnType<typeof spend_decision>}
 */
export const spend_guard_admit = (request) => spend_decision(ledger, { ...request, now: Date.now() })

/** Live consecutive pre-execution refusals for `intent`. @param {string} intent @returns {number} */
export const spend_guard_attempts = (intent) => backoff_attempts(ledger, intent)

/** Live circuit verdict for `intent` — true once an EXECUTED failure retired it. @param {string} intent */
export const spend_guard_circuit_open = (intent) => circuit_open(ledger, intent)

/**
 * Record a failed submission. Returns the classification plus the notice the EDGE should surface — non-null
 * only on the TRANSITION (the poll that opens a circuit / trips the breaker), so a refusing loop stays silent
 * after saying its piece once.
 * @param {unknown} error @param {{ intent: string, automated?: boolean }} context
 * @returns {{ kind: 'executed'|'refused', notice: { i18n_key: string } | null }}
 */
export function spend_guard_record_failure(error, { intent, automated = false }) {
  const verdict = classify_submission_error(error)
  if (verdict.kind === 'refused') {
    ledger = note_preflight_refusal(ledger, { intent, now: Date.now(), jitter: Math.random() })
    return { kind: 'refused', notice: null }
  }
  const was_open = Boolean(ledger.circuits[intent])
  const was_frozen = session_frozen(ledger)
  ledger = note_executed_failure(ledger, { intent, digest: verdict.digest, automated })
  if (automated && !was_frozen && session_frozen(ledger))
    return { kind: 'executed', notice: spend_guard_notice('session_frozen') }
  return { kind: 'executed', notice: was_open ? null : spend_guard_notice('circuit_open') }
}

/**
 * Record a landed submission — its real gas accrues, its backoff clears.
 * @param {any} value the lane task's resolved receipt @param {{ intent: string, automated?: boolean }} context
 * @returns {{ notice: { i18n_key: string } | null }}
 */
export function spend_guard_record_success(value, { intent, automated = false }) {
  const measured = settled_gas_mist(value)
  const was_frozen = session_frozen(ledger)
  ledger = note_success(ledger, { intent, automated, gas_mist: measured > 0n ? measured : ASSUMED_TX_GAS_MIST })
  return { notice: !was_frozen && session_frozen(ledger) ? spend_guard_notice('session_frozen') : null }
}
