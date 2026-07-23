// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UNOPENED FIGHT RESULTS — the PERMANENT post-settle surface (not a recovery edge case).
// `settlement::settle_and_destroy` transfers ONE soulbound `FightOutcome` to EVERY seat owner silently, so any
// non-janitor participant holds unopened results until their own `results::open` lands (which is also the ONLY
// fight_marker discharge — an unopened outcome blocks every new fight with abort 111). The roster pill reads
// this surface via `GET /v1/pending-outcomes?owner=` (chain-direct reads are ABOLISHED; the
// projection is served by the packages/rpc lane) and the press fires the open PTB with the row's own ids.
//
// MEMOIZED per wallet: every roster-row pill shares ONE fetch per signal (mount / post-open invalidation),
// never polled. A FAILED fetch is never cached (a transient read error must not permanently hide the pill).
//
// LEAF ON PURPOSE: the fetcher arrives as an argument (callers pass rpc/client's `get_pending_outcomes`), so
// the mapper + memo are unit-testable with a plain fake — zero `mock.module` (process-global collision law).

import { parse_move_abort } from '../game/core/abort_copy.js'

import { error_executed_digest, error_preflight_marked } from './tx_digest_error.js'

/**
 * PURE: `/v1/pending-outcomes` rows → Map<character_id, row>. Rows without an outcome_id/character_id are
 * skipped (an unreadable row must never fake a pending state); the first row per character wins — the
 * fight_marker admits at most one unopened outcome per character in practice (a marked character cannot enter
 * a new fight), and after an open lands the invalidated memo re-fetches whatever remains.
 * @param {Array<{ outcome_id?: string, character_id?: string, fight_id?: string|null, world_id?: string|null,
 *                 pvp?: boolean, outcome?: number, aged_bp?: number }>} rows
 * @returns {Map<string, { outcome_id: string, character_id: string, fight_id: string|null, world_id: string|null }>}
 */
export function map_pending_outcomes(rows) {
  const by_character = new Map()
  for (const row of rows ?? []) {
    const character_id = typeof row?.character_id === 'string' && row.character_id ? row.character_id : null
    const outcome_id = typeof row?.outcome_id === 'string' && row.outcome_id ? row.outcome_id : null
    if (!character_id || !outcome_id) continue
    if (!by_character.has(character_id))
      by_character.set(character_id, {
        outcome_id,
        character_id,
        fight_id: typeof row?.fight_id === 'string' ? row.fight_id : null,
        world_id: typeof row?.world_id === 'string' ? row.world_id : null,
      })
  }
  return by_character
}

/** @type {{ address: string|null, promise: Promise<Map<string, any>>|null }} the per-wallet memo */
let cache = { address: null, promise: null }

/**
 * The wallet's unopened outcomes, keyed by character — ONE `/v1/pending-outcomes` fetch per wallet per signal
 * (all roster-row pills share it). Never polled; `invalidate_pending_outcomes()` after any open resolution (or
 * an account switch) re-arms the next mount's fetch.
 * @param {string} address the signed-in wallet
 * @param {(address: string) => Promise<any[]>} fetch_rows rpc/client's `get_pending_outcomes` (injected — leaf law)
 * @returns {Promise<Map<string, { outcome_id: string, character_id: string, fight_id: string|null, world_id: string|null }>>}
 */
export function pending_outcomes_for(address, fetch_rows) {
  if (!address || typeof fetch_rows !== 'function') return Promise.resolve(new Map())
  if (cache.address === address && cache.promise) return cache.promise
  const promise = (async () => map_pending_outcomes(await fetch_rows(address)))().catch((error) => {
    if (cache.promise === promise) cache = { address: null, promise: null } // never memoize a failure
    throw error
  })
  cache = { address, promise }
  return promise
}

/** Drop the memo (an open resolved / account switch) — the next pill mount re-fetches honestly. */
export function invalidate_pending_outcomes() {
  cache = { address: null, promise: null }
}

// ── AUTO-OPEN attempt registry (unopened stuff always auto-opens whenever detected,
// with the burn-law rails) — the ONE session-scoped home, keyed per outcome_id:
//   'inflight'  → owns the shared Promise (every detector awaits the SAME open; never double-compose);
//   'latched'   → an EXECUTED failure OR a refused AUTO attempt: auto never re-fires this session, while the
//                 preserved error gives the engage door its honest surface and the manual press stays available;
//   'opened'    → receipt landed; a lagging /v1 row cannot auto-compose the consumed outcome a second time;
//   (absent)    → attemptable. Only callers that explicitly classify their operation as transient (the separate
//                 terminal-settlement retry engine) clear back to absent.

/** @type {Map<string, { state:'inflight'|'latched'|'opened', promise:Promise<any>|null, error:unknown|null }>} */
const attempts = new Map()

// The pill renders attempt state REACTIVELY (detection no longer lives in its mount — boot plus the awaited
// engage/join door own the trigger): a plain listener set notified on every begin/end, so a mounted
// badge re-derives its beat ('opening' ⇄ latched fallback ⇄ gone) without polling.
/** @type {Set<() => void>} */
const attempt_listeners = new Set()
const notify_attempts = () => {
  for (const cb of attempt_listeners) {
    try {
      cb()
    } catch {
      /* a listener must never break the registry */
    }
  }
}

/** Subscribe to attempt-registry transitions (pill reactivity). Returns the unsubscribe. */
export function subscribe_attempts(/** @type {() => void} */ cb) {
  attempt_listeners.add(cb)
  return () => attempt_listeners.delete(cb)
}

/**
 * Claim the single-flight slot for one outcome. AUTO attempts are refused while inflight OR latched; a MANUAL
 * press is refused only while inflight (the user may retry a latched outcome — one attempt per press).
 * @param {string} outcome_id @param {{ manual?: boolean }} [opts] @returns {boolean} true = attempt owned
 */
export function begin_attempt(outcome_id, { manual = false } = {}) {
  if (!outcome_id) return false
  const state = attempts.get(outcome_id)?.state
  if (state === 'inflight') return false
  if (state === 'opened') return false
  if (state === 'latched' && !manual) return false
  attempts.set(outcome_id, { state: 'inflight', promise: null, error: null })
  notify_attempts()
  return true
}

/**
 * Release the slot with the attempt's verdict. Opened keeps a result receipt tombstone; executed failure and
 * refused AUTO attempts latch with their honest error; transient/settled fight attempts clear normally.
 * @param {string} outcome_id @param {'opened' | 'settled' | 'transient' | 'refused' | 'executed_failure'} verdict
 * @param {unknown} [error]
 */
export function end_attempt(outcome_id, verdict, error = null) {
  if (!outcome_id) return
  if (verdict === 'opened') attempts.set(outcome_id, { state: 'opened', promise: null, error: null })
  else if (verdict === 'executed_failure' || verdict === 'refused')
    attempts.set(outcome_id, { state: 'latched', promise: null, error })
  else attempts.delete(outcome_id)
  notify_attempts()
}

/** Bind the Promise owned by an already-claimed inflight slot. */
export function bind_attempt_flight(/** @type {string} */ outcome_id, /** @type {Promise<any>} */ promise) {
  const attempt = attempts.get(outcome_id)
  if (attempt?.state === 'inflight') attempts.set(outcome_id, { ...attempt, promise })
}

/** The shared open flight, when one detector already owns it. */
export function attempt_flight(/** @type {string} */ outcome_id) {
  const attempt = attempts.get(outcome_id)
  return attempt?.state === 'inflight' ? attempt.promise : null
}

/** The exact failed-open error retained for the honest engage/manual fallback surface. */
export function attempt_error(/** @type {string} */ outcome_id) {
  return attempts.get(outcome_id)?.error ?? null
}

/**
 * Acquire the store-wide settlement flight; concurrent result ids queue without spending their attempt. The
 * claim routes through the store's `claim_settling` action door (an async result re-entering as an INPUT, never
 * a laundered external setState), so a waiter's re-claim on release is a store-owned reducer transition. Every
 * release notification re-reads live state; the first waiter to win the door hands the slot off exactly once.
 */
export function acquire_settlement_flight(store) {
  if (store.getState().claim_settling()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      // Re-read live state: another waiter may have claimed it from an earlier callback in this notification.
      if (!store.getState().claim_settling()) return
      unsubscribe()
      resolve()
    })
  })
}

/**
 * Own one result-open flight from detection through its receipt. The slot is claimed and its Promise is bound
 * synchronously, before `open` can perform an awaited run lookup or compose a transaction, so boot/engage/manual
 * detectors for the same result always await one effect. An attempted open that fails latches its exact error;
 * a local deferral did not attempt the open and therefore re-arms an untouched result.
 * @param {string} outcome_id
 * @param {() => Promise<{status:'opened'|'failed'|'deferred',receipt?:any,error?:unknown}>} open
 * @param {{manual?:boolean}} [opts]
 * @returns {Promise<{status:'opened',receipt:any}|{status:'blocked'|'failed',error:unknown|null}>}
 */
export function run_result_auto_open(outcome_id, open, { manual = false } = {}) {
  if (!outcome_id || typeof open !== 'function') return Promise.resolve({ status: 'blocked', error: null })
  const shared = attempt_flight(outcome_id)
  if (shared) return shared
  const prior = attempts.get(outcome_id) ?? null
  if (prior?.state === 'opened') return Promise.resolve({ status: 'opened', receipt: null })
  if (prior?.state === 'latched' && !manual) return Promise.resolve({ status: 'blocked', error: prior.error })
  if (!begin_attempt(outcome_id, { manual })) {
    const raced = attempt_flight(outcome_id)
    if (raced) return raced
    const current = attempts.get(outcome_id)
    return Promise.resolve(
      current?.state === 'opened'
        ? { status: 'opened', receipt: null }
        : { status: 'blocked', error: current?.error ?? null }
    )
  }
  const flight = (async () => {
    try {
      const result = await open()
      if (result?.status === 'opened') {
        end_attempt(outcome_id, 'opened')
        return { status: 'opened', receipt: result.receipt ?? null }
      }
      if (result?.status === 'deferred') {
        // A manual press may temporarily borrow an executed-failure latch. If no tx was attempted, restore it;
        // otherwise a local busy guard could accidentally re-arm AUTO after gas had already been burned.
        if (manual && prior?.state === 'latched') {
          attempts.set(outcome_id, prior)
          notify_attempts()
        } else end_attempt(outcome_id, 'transient')
        return { status: 'blocked', error: result.error ?? null }
      }
      const error = result?.error ?? null
      end_attempt(outcome_id, error_executed_digest(error) ? 'executed_failure' : 'refused', error)
      return { status: 'failed', error }
    } catch (error) {
      end_attempt(outcome_id, error_executed_digest(error) ? 'executed_failure' : 'refused', error)
      return { status: 'failed', error }
    }
  })()
  bind_attempt_flight(outcome_id, flight)
  return flight
}

/**
 * Production fight-entry recovery coordinator. Only a proven preflight `fight::111` may detect/open; the exact
 * row and result-open action are injected by dungeon_settlement so this reducer-facing core stays directly
 * drivable. The open action owns the result-id single-flight above and returns its receipt as reducer input.
 * @param {unknown} refusal
 * @param {{find_result:()=>Promise<any>,open_result:(row:any)=>Promise<any>}} effects
 */
export async function recover_marked_fight_entry(refusal, { find_result, open_result }) {
  const abort = parse_move_abort(refusal)
  if (
    error_executed_digest(refusal) ||
    !error_preflight_marked(refusal) ||
    abort?.module !== 'fight' ||
    abort.code !== 111
  )
    throw refusal
  const row = await find_result()
  if (!row?.outcome_id) throw refusal
  const opened = await open_result(row)
  if (opened?.status === 'opened') return opened.receipt ?? null
  throw opened?.error ?? refusal
}

/** @param {string} outcome_id @returns {'inflight' | 'latched' | 'opened' | null} */
export function attempt_state(outcome_id) {
  return attempts.get(outcome_id)?.state ?? null
}

// ── BOOT gate — detection must not depend on a UI surface (a session-restore straight
// into the WORLD never mounts the roster, so a badge-mounted trigger never fired). The auth wire (dungeon_store
// tail) kicks the shared auto-open ONCE per signed-in wallet; this gate is what makes "once" true across the
// init read + the subscribe stream (and re-arms on an account switch).
let booted_wallet = /** @type {string|null} */ (null)

/** True exactly once per wallet transition — the boot wire's dedupe. @param {string|null|undefined} address */
export function should_boot_open(address) {
  if (!address || address === booted_wallet) return false
  booted_wallet = address
  return true
}

/** Test-only: reset the session registry + boot gate (bun test process is long-lived). */
export function reset_attempts_for_test() {
  attempts.clear()
  booted_wallet = null
}

/**
 * BURN-LAW failure classifier for the open tx: only POSITIVELY pre-flight/network failures return true
 * (re-armable); anything ambiguous is treated as EXECUTED → latch. Rationale: the executed throw in this path
 * is `tx_error()` (humanized message + `.cause` = the raw chain error) but network stacks may also set
 * `.cause`, so the discriminator is the MESSAGE class, ordered client-throws → network → default-executed.
 * A false "executed" costs one manual press; a false "transient" could burn gas — round toward latching.
 * Digest proof always wins over message text: a finality wait can say "network timeout" after submission.
 * @param {unknown} error @returns {boolean} true = pre-flight/network (re-armable)
 */
export function is_preflight_failure(error) {
  if (error_executed_digest(error)) return false
  // The gas-guard's OWN dry-run refusal — STRUCTURAL provenance stamped at the throw site (tx_error
  // { preflight: true } → the SimulationError marker; error_preflight_marked walks it, never message text).
  // 07-18 victory-card starvation: without this arm the terminal-race settle refusal (the fullnode's dry-run
  // lagging the killing commit → simulated settlement::101, ZERO gas, NO digest) was byte-identical to an
  // executed abort → latched → the fight core's retry engine starved → the card skeletoned forever.
  if (error_preflight_marked(error)) return true
  const message = String(/** @type {any} */ (error)?.message ?? error ?? '')
  // our own pre-submit client refusals (dungeon_actions/open_outcome throw these before any bytes are built)
  if (/not connected|not signed in|not in your kiosk/i.test(message)) return true
  // transport-class failures (fetch/undici/browser network stacks — no execution reached)
  if (/failed to fetch|fetch failed|network|timeout|timed out|socket|ECONN|abort(ed)? before start/i.test(message))
    return true
  // BUILD-time object resolution (a stale /v1 row whose outcome was already consumed elsewhere): the tx never
  // produced bytes — no digest possible. The invalidated memo's refetch then drops the ghost row entirely.
  if (/not found|does not exist/i.test(message)) return true
  return false
}
