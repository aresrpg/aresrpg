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
import { backoff_delay_ms } from './spend_guard.js'

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
 * #1383 ② — THE FREE-DRY-RUN BUDGET. A PRE-FLIGHT refusal burned NOTHING: the tx choke simulates every open
 * before the wallet signs, so a would-fail open is refused at zero gas (src/tx guard). Parking the player on a
 * manual badge after ONE such refusal made the recovery surface the normal flow; simulation is free, so the
 * open re-attempts on the house backoff (spend_guard's ONE schedule) until the simulation passes — then it
 * submits exactly once. Four attempts ≈ 1s + 2s + 4s of waiting; past that the badge is the honest last resort.
 * An EXECUTED failure never enters this loop at all: a digest means the gas is already gone.
 */
export const OPEN_RETRY_ATTEMPTS = 4

const default_sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Own one result-open flight from detection through its receipt. The slot is claimed and its Promise is bound
 * synchronously, before `open` can perform an awaited run lookup or compose a transaction, so boot/engage/manual
 * detectors for the same result always await one effect (and coalesce onto its free retries too). A PRE-FLIGHT
 * refusal is retried for free; an EXECUTED failure latches its exact error at once; a local deferral did not
 * attempt the open and therefore re-arms an untouched result.
 * @param {string} outcome_id
 * @param {() => Promise<{status:'opened'|'failed'|'deferred',receipt?:any,error?:unknown}>} open
 * @param {{manual?:boolean, max_attempts?:number, sleep?:(ms:number)=>Promise<any>}} [opts]
 * @returns {Promise<{status:'opened',receipt:any}|{status:'blocked'|'failed',error:unknown|null}>}
 */
export function run_result_auto_open(
  outcome_id,
  open,
  { manual = false, max_attempts = OPEN_RETRY_ATTEMPTS, sleep = default_sleep } = {}
) {
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
    for (let attempt = 1; ; attempt += 1) {
      /** @type {{status?:string, receipt?:any, error?:unknown}} */
      let result
      try {
        result = await open()
      } catch (error) {
        result = { status: 'failed', error }
      }
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
      // ONE HONEST FAILURE, ZERO RETRIES (burn law): a digest — or any error this classifier cannot POSITIVELY
      // prove pre-flight — is treated as executed. Re-sending would burn a second time.
      if (!is_preflight_failure(error) || attempt >= max_attempts) {
        end_attempt(outcome_id, error_executed_digest(error) ? 'executed_failure' : 'refused', error)
        return { status: 'failed', error }
      }
      // PROVEN PRE-FLIGHT: nothing was signed, nothing was spent. Wait out the house backoff and dry-run again.
      await sleep(backoff_delay_ms(attempt, Math.random()))
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

/**
 * THE SETTLE-OBSERVED AUTO-OPEN (#1223 ruling ③). A settlement that halts PRE-FLIGHT is itself the detection
 * signal: the Fight was already gone, so a racing janitor (or another seat) settled it and minted MY
 * `FightOutcome` — it exists RIGHT NOW, unopened, and the character stays fight_marker-MARKED until it opens.
 * Nothing else re-detects that this session (the boot pass fires once per wallet), so the strand used to wait for
 * a reload or for the next engage to eat abort 111. The same shape as `recover_marked_fight_entry` above, on a
 * different signal: find the row, hand it to the injected open action, report the verdict as DATA.
 *
 * BURN LAW: an EXECUTED halt (a digest exists — gas was spent and the whole PTB reverted, so the Fight is still
 * LIVE and there is no outcome to open) composes NOTHING and does not even read. Never throws: it runs
 * fire-and-forget behind an already-returned settle verdict, so a rejection here would be unhandled.
 * @param {'transient'|'executed_failure'} halt the settlement's own classification (is_preflight_failure)
 * @param {{find_result:()=>Promise<any>, open_result:(row:any)=>Promise<any>, announce?:()=>void}} effects
 *   `announce` is the visible "opening it now…" beat — fired ONLY once a row is proven, before the tx builds.
 * @returns {Promise<{status:'skipped'|'clean'|'opened'|'failed', receipt?:any, error?:unknown}>}
 */
export async function recover_settled_elsewhere(halt, { find_result, open_result, announce }) {
  if (halt !== 'transient') return { status: 'skipped', error: null }
  const row = await find_result().catch(() => null) // a blind read never composes an open
  if (!row?.outcome_id) return { status: 'clean' }
  announce?.()
  const opened = await open_result(row).catch((error) => ({ status: 'failed', error }))
  return opened?.status === 'opened'
    ? { status: 'opened', receipt: opened.receipt ?? null }
    : { status: 'failed', error: opened?.error ?? null }
}

/**
 * #1383 ① — THE ONE HOME for the line a settlement halt may honestly speak. "You have an unfinished fight
 * result" is a claim ABOUT THIS PROJECTION — the same `/v1/pending-outcomes` row the character-panel badge
 * renders — so it may only be made when the projection actually has an actionable row. It used to be pushed
 * blind from the halt path, including the EXECUTED-abort case where the whole PTB reverted and no outcome
 * exists at all: the player was sent to hunt a result that was never minted. Toast ⊆ projection truth, by
 * construction. An unreadable projection makes NO claim (hold, never invent).
 * @param {() => Promise<{ outcome_id?: string }|null|undefined>} find_row the caller's projection read
 * @returns {Promise<{ claim: 'pending_result', row: any } | { claim: 'settle_failed', row: null }>}
 */
export async function settle_halt_notice(find_row) {
  const row = await find_row().catch(() => null)
  return row?.outcome_id ? { claim: 'pending_result', row } : { claim: 'settle_failed', row: null }
}

// ── PENDING-OUTCOME SIGNAL REDUCER (#2146) ───────────────────────────────────
// Boot and a live fight's later Settled/Swept row both request the SAME effect. The store owns the state and
// hands async completion back through this reducer as data; this leaf only describes the transition/effect.

/** @returns {{next_token:number,inflight:number|null,queued_fresh:boolean,last_error:unknown|null}} */
export const initial_pending_outcome_flow = () => ({
  next_token: 0,
  inflight: null,
  queued_fresh: false,
  last_error: null,
})

const open_effect = (state, fresh) => {
  const token = state.next_token + 1
  return {
    state: { ...state, next_token: token, inflight: token, queued_fresh: false, last_error: null },
    effect: { type: 'open_pending_outcomes', token, fresh, announce: fresh },
  }
}

/**
 * One reducer door for pending-outcome detection. A settlement signal queues one fresh pass behind a boot pass
 * already in flight; repeated boot arrivals add no information and are coalesced.
 * @param {ReturnType<typeof initial_pending_outcome_flow>} value @param {any} input
 * @returns {{state:ReturnType<typeof initial_pending_outcome_flow>,effect:any|null}}
 */
export function reduce_pending_outcome_flow(value, input) {
  const state = value ?? initial_pending_outcome_flow()
  if (input?.type === 'pending_outcome_detected') {
    const fresh = input.source === 'settlement'
    if (state.inflight != null)
      return {
        state: { ...state, queued_fresh: state.queued_fresh || fresh },
        effect: null,
      }
    return open_effect(state, fresh)
  }
  if (input?.type === 'pending_outcome_open_finished') {
    if (input.token !== state.inflight) return { state, effect: null }
    if (state.queued_fresh) return open_effect({ ...state, inflight: null, last_error: input.error ?? null }, true)
    return {
      state: { ...state, inflight: null, queued_fresh: false, last_error: input.error ?? null },
      effect: null,
    }
  }
  return { state, effect: null }
}

/**
 * Recognize the indexed fight journal's settlement milestone and turn it into the reducer input above. Settled
 * and Swept both destroy the Fight and mint each seat's unopened outcome. Other journal rows are not signals.
 * @param {any} message @param {string} watched_fight_id
 * @returns {{type:'pending_outcome_detected',source:'settlement',fight_id:string}|null}
 */
export function settlement_arrival_input(message, watched_fight_id) {
  if (message?.type !== 'journal' || !watched_fight_id || String(message.fight_id ?? '') !== String(watched_fight_id))
    return null
  const settled = (message.batch?.events ?? []).some((event) => event?.kind === 'Settled' || event?.kind === 'Swept')
  return settled ? { type: 'pending_outcome_detected', source: 'settlement', fight_id: watched_fight_id } : null
}

/**
 * Execute one reducer-described scan/open effect and return completion as reducer DATA. A live settlement drops
 * the boot-era projection memo first; boot uses the memo normally. No failure escapes into the store.
 * @param {{type:string,token:number,fresh:boolean,announce:boolean}|null} effect
 * @param {{address:string|null|undefined,invalidate:()=>void,
 *   open_pending:(address:string,options:{announce:boolean})=>Promise<any>}} deps
 */
export async function run_pending_outcome_effect(effect, { address, invalidate, open_pending }) {
  if (effect?.type !== 'open_pending_outcomes')
    return { type: 'pending_outcome_open_finished', token: effect?.token ?? null, error: null }
  try {
    if (effect.fresh) invalidate()
  } catch (error) {
    return { type: 'pending_outcome_open_finished', token: effect.token, error }
  }
  const outcome = address
    ? await open_pending(address, { announce: effect.announce }).then(
        () => ({ error: null }),
        (error) => ({ error })
      )
    : { error: null }
  return { type: 'pending_outcome_open_finished', token: effect.token, error: outcome.error }
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
  // The SPEND GUARD's own refusal (tx.js `spend_guard_error`): the lane refused BEFORE anything was built,
  // simulated or signed, so it is zero-gas by construction. STRUCTURAL provenance (the error name it is stamped
  // with), never message text — and never a latch: latching here would let the guard's own transient backoff
  // permanently retire the auto-open it is protecting.
  if (/** @type {any} */ (error)?.name === 'SpendGuardRefusal') return true
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
