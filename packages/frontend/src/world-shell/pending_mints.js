// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// pending_mints.js — THE RECEIPT-DRIVEN MINT+BURN QUEUE (stranded-loot recovery). Decouples the loot mint from
// the flaky bounded display read that stranded 41 FightResults soulbound: the mint no longer rides a
// ~5s read that gives up SILENTLY (finish_result's old `if (result)` gate — a null read SKIPPED mint_all_and_burn,
// so the opened FightResult never burned and its rolled items never minted). TWO receipt-driven sources feed ONE
// pipeline:
//   • finish_result enqueues the result_id it HOLDS the instant `results::open` lands — NO read gate;
//   • the boot/world-join SWEEP enumerates the wallet's opened-but-un-burned FightResults (`/v1/fight-results`,
//     the sanctioned enumeration — chain-direct owned-object listing is abolished) and enqueues each.
//
// ONE single-flight drainer reads each FightResult CHAIN-DIRECT (`get_fight_result` gRPC — the mint ELIGIBILITY is
// CHAIN truth: the opened object exists = mintable; NEVER a read-layer answer, that was the root violation) and
// fires the ONE atomic `mint_all_and_burn` — mint every rolled `item_template` then burn (results.move gates the
// burn on its OWN `rolled.is_empty()` assert), or a BARE burn for an empty husk (`templates` []). Both entry, NO
// &Random — the ordinary sponsor-first/self-pay `sign` choke budgets them (no D747 fixed ceiling needed).
//
// UNBOUNDED-until-settled: a null read is read-after-write lag on an object we KNOW exists → RETRY with backoff,
// never a 5s give-up; past the in-session cap the entry PARKS and the durable boot sweep (re-reads /v1 truth every
// session) re-drives it — the cross-session backstop, so nothing strands permanently.
// IDEMPOTENT by construction: a minted result is BURNED (gone) → `done` tombstone; a re-enqueue (a later sweep) is
// a NO-OP → ZERO recompose. BURN LAW: an EXECUTED mint failure (a digest = gas already burned) LATCHES — never
// auto-recomposed this session (`is_preflight_failure` rounds ambiguous → latch); only a positively pre-flight or
// network failure re-arms.
//
// LEAF ON PURPOSE (headless-testable, zero `mock.module` — the pending_outcomes.js pattern): the heavy deps (the
// chain read, the mint composer, the /v1 fetch, the toast) ARRIVE AS ARGUMENTS from the call sites; this module
// imports only leaves (the burn-law classifier + the logger).

import { game_log } from '../core/log.js'

import { is_preflight_failure } from './pending_outcomes.js'

/**
 * @typedef {{ read_result: (id: string) => Promise<any>, mint_and_burn: (id: string, templates: string[]) =>
 *   Promise<any>, now?: () => number, schedule?: (fn: () => void, ms: number) => any }} MintDeps
 * @typedef {{ verdict: 'minted', result_id: string, settlement: any } |
 *   { verdict: 'latched', result_id: string }} MintOutcome
 */

// result_id → retry state + ONE settlement promise. The promise exposes the async mint outcome as DATA to the
// enqueuing edge; no terminal callback ever writes a store. status: 'pending' (queued/retrying) | 'done'
// (minted+burned terminal tombstone) |
// 'latched' (executed failure — terminal, burn-law). A terminal entry is a NO-OP on re-enqueue.
/** @type {Map<string, { status: 'pending'|'done'|'latched', attempts: number, next_due: number,
 *   settled: Promise<MintOutcome>, settle: (outcome: MintOutcome) => void }>} */
const queue = new Map()

// The first retry is quick (read-after-write lag usually clears in ~1-2s), then backs off, capping at 30s. Past
// IN_SESSION_CAP attempts an entry PARKS (no more timers churn for it) — the boot sweep is the durable re-drive.
const BACKOFF_MS = [1600, 3000, 6000, 12000, 30000]
const IN_SESSION_CAP = 12 // ~a few minutes of in-session retries before parking for the cross-session sweep
const backoff_for = (/** @type {number} */ attempts) => BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]

const default_now = () => Date.now()
const default_schedule = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
  const timer = setTimeout(fn, ms)
  if (typeof (/** @type {any} */ (timer)?.unref) === 'function') /** @type {any} */ (timer).unref() // never hold the process open
  return timer
}

let drain_promise = /** @type {Promise<void> | null} */ (null)
let retry_timer = /** @type {any} */ (null)

/**
 * Enqueue a result_id for its atomic mint+burn. IDEMPOTENT: an already-terminal id (`done`/`latched`) is a NO-OP
 * (the minted tombstone + the burn-law latch) — a later sweep re-enqueuing the same id NEVER recomposes. A still-
 * pending id keeps its retry state and returns the SAME promise. The promise resolves exactly once with the
 * successful settlement receipt/handle or a latch verdict, including when a later backoff timer does the work.
 * @param {string} result_id @returns {Promise<MintOutcome> | null}
 */
export function enqueue_mint(result_id) {
  if (!result_id) return null
  const entry = queue.get(result_id)
  if (entry) return entry.settled // pending keeps its retry state; terminal returns its already-settled outcome
  /** @type {(outcome: MintOutcome) => void} */
  let settle = () => {}
  const settled = new Promise((resolve_settled) => {
    settle = resolve_settled
  })
  queue.set(result_id, { status: 'pending', attempts: 0, next_due: 0, settled, settle })
  return settled
}

/**
 * Process ONE result: CHAIN read → the atomic `mint_and_burn` → a verdict. The mint DECISION is the chain object
 * ALONE (exists + opened), never a /v1 answer. A null/non-opened read RETRIES (never a mint composed against a
 * blind read); a landed read mints every rolled template + burns (an empty `rolled` composes a BARE burn — the
 * husk dies same-sweep). A mint failure classifies by the burn law: a digest/ambiguous LATCHES, pre-flight re-arms.
 * @param {string} result_id @param {MintDeps} deps
 * @returns {Promise<MintOutcome | { verdict: 'retry', result_id: string }>}
 */
export async function process_mint(result_id, { read_result, mint_and_burn }) {
  const result = await read_result(result_id).catch(() => null)
  // null = read-after-write lag on an object we KNOW exists (or a burned-elsewhere race); non-opened = a misread
  // that must never compose a burn against the wrong object type. Either way RETRY — the chain gates every mint.
  if (!result || !result.is_opened) return { verdict: 'retry', result_id }
  const templates = (result.rolled ?? []).map((/** @type {any} */ e) => e.item_template)
  try {
    const settlement = await mint_and_burn(result_id, templates) // atomic mint×N + burn; [] ⇒ bare burn
    return { verdict: 'minted', result_id, settlement }
  } catch (error) {
    // BURN LAW: a digest (executed) or anything ambiguous ⇒ LATCH (never re-fire spent gas); only a positively
    // pre-flight/network failure re-arms for a retry. is_preflight_failure rounds toward latching on doubt.
    return is_preflight_failure(error) ? { verdict: 'retry', result_id } : { verdict: 'latched', result_id }
  }
}

/**
 * Drain every DUE pending result to terminal-or-parked, COALESCING concurrent callers onto ONE in-flight pass (so
 * a sweep can `await` it and count what settled while finish_result's own drain shares the work). Re-loops while a
 * pass makes progress, then arms a backoff timer for any entry still retrying under the cap. Resolves once the
 * currently-due set is processed — future backoff retries land through the armed timer, not this promise.
 * @param {MintDeps} deps @returns {Promise<void>}
 */
export function drain_pending_mints(deps) {
  if (drain_promise) return drain_promise
  const now = deps.now ?? default_now
  drain_promise = (async () => {
    try {
      let progressed = true
      while (progressed) {
        progressed = false
        for (const [result_id, entry] of [...queue]) {
          if (entry.status !== 'pending' || entry.next_due > now()) continue
          const outcome = await process_mint(result_id, deps)
          if (outcome.verdict === 'minted') {
            queue.set(result_id, { ...entry, status: 'done' }) // burned tombstone (idempotency)
            entry.settle(outcome) // resolve DATA only — never a terminal store-writing callback
            progressed = true
          } else if (outcome.verdict === 'latched') {
            queue.set(result_id, { ...entry, status: 'latched' }) // burn law: never recomposed
            game_log('dungeon', 'pending-mint LATCHED (executed failure — never auto-recomposed):', result_id)
            entry.settle(outcome)
            progressed = true
          } else {
            const attempts = entry.attempts + 1 // read-after-write lag → retry with backoff, never a silent give-up
            queue.set(result_id, { ...entry, attempts, next_due: now() + backoff_for(attempts) })
          }
        }
      }
    } finally {
      drain_promise = null
    }
    schedule_retry(deps)
  })()
  return drain_promise
}

/** Arm ONE shared timer for the earliest still-retrying (under-cap) entry — the in-session unbounded-until-settled
 *  backoff. Over-cap entries PARK (the boot sweep re-drives them), so no timer churns forever. @param {MintDeps} deps */
function schedule_retry(deps) {
  if (retry_timer) return
  const now = deps.now ?? default_now
  const schedule = deps.schedule ?? default_schedule
  let earliest = Infinity
  for (const entry of queue.values())
    if (entry.status === 'pending' && entry.attempts < IN_SESSION_CAP) earliest = Math.min(earliest, entry.next_due)
  if (earliest === Infinity) return
  retry_timer = schedule(
    () => {
      retry_timer = null
      void drain_pending_mints(deps)
    },
    Math.max(0, earliest - now())
  )
}

/**
 * THE RECOVERY SWEEP (leg②): enumerate the wallet's opened-but-un-burned FightResults and drive each through the
 * SAME queue — the 41 stranded results recover on the next session. Enumeration rides `/v1/fight-results`
 * (candidate discovery only — every mint is still CHAIN-gated by process_mint); `opened === true` rows are the core
 * FightResults that owe a mint/burn (the unopened engine rows are the auto-open path's concern). A quiet success
 * sweep: NO per-result toast — ONE summary once the readable set drains.
 * @param {string} address
 * @param {MintDeps & { fetch_results: (address: string) => Promise<any[]>, notify: (count: number) => void }} deps
 * @returns {Promise<number>} the count recovered (minted+burned) in this pass
 */
export async function sweep_stranded_results(address, deps) {
  if (!address) return 0
  let rows
  try {
    rows = await deps.fetch_results(address)
  } catch (error) {
    game_log('dungeon', 'mint-sweep: /v1 fight-results read failed (next boot re-checks)', error)
    return 0
  }
  const candidates = (rows ?? [])
    .filter((/** @type {any} */ r) => r?.opened && typeof r?.result_id === 'string' && r.result_id)
    .map((/** @type {any} */ r) => r.result_id)
  // FRESH = not already terminal/inflight in the queue (a re-run sweep never double-composes a done/latched id).
  const fresh = candidates.filter((/** @type {string} */ id) => {
    const entry = queue.get(id)
    return !entry || entry.status === 'pending'
  })
  for (const id of fresh) void enqueue_mint(id)
  await drain_pending_mints(deps)
  const recovered = fresh.filter((/** @type {string} */ id) => queue.get(id)?.status === 'done').length
  if (recovered > 0) deps.notify(recovered) // ONE quiet summary — never per-result spam
  return recovered
}

/** Inspect an id's queue status (tests + callers that gate on completion). @param {string} result_id */
export function pending_mint_status(result_id) {
  return queue.get(result_id)?.status ?? null
}

/** Test-only: clear the session queue + any armed timer (bun test process is long-lived). */
export function reset_pending_mints_for_test() {
  if (retry_timer && typeof clearTimeout === 'function') clearTimeout(retry_timer)
  retry_timer = null
  drain_promise = null
  queue.clear()
}
