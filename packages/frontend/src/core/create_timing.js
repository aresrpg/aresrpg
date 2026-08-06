// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2262 — the SPONSORED CHARACTER CREATE's one bill: the seven legs a player waits through between pressing
// CREATE and seeing the character in the authoritative roster, so the fix targets the MEASURED fattest leg
// instead of a guess. The create's first four legs are already measured, at the leg, by the sponsored door
// (tx/latency.js `timed` → the `?txtiming=1` line): this recorder COLLECTS that same bill for the create's exact
// transaction rather than stamping a second set of marks over the same boundaries, and adds the three legs that
// live after execution and belong to nobody else. It supersedes #1862's coarse `create tx+wait` line — the
// receipt SOURCE (certified-effects vs finality-wait) rides on the leg it explains.
//
//   prepare   the press through zkLogin challenge sign ‖ kind build (concurrent — the leg costs max(), #1663)
//   reserve   the sponsor /reserve round trip
//   sign      the sender-half signature assembly (wallet signTransaction)
//   execute   /execute: submit → the station's CERTIFIED effects
//   receipt   those effects → the normalized receipt → the predicted character (or the finality-wait fallback)
//   indexer   the first /v1 roster read that CONTAINS the new character
//   paint     that snapshot through the reducer to the notification React can paint
//
// Bound to the Transaction object, then to the created character id — the same two-phase binding
// engage_timing.js uses, so an unrelated sponsored transaction or roster load can neither stage nor close it.
// Instrumentation NEVER alters the path it measures: every entry point is inert without a live trace.

import { timing_now } from './latency_trace.js'
import { game_log } from './log.js'

export const CREATE_TIMING_LEGS = Object.freeze([
  'prepare',
  'reserve',
  'sign',
  'execute',
  'receipt',
  'indexer',
  'paint',
])

/**
 * @typedef {{ source: string, transaction: object, character_id: string | null, adoption: string | null,
 *             started_at: number, at: number, legs: Record<string, number | null> }} CreateTrace
 */

/** The ONE trace in flight — replaced, never mutated. A player creates one character at a time. */
/** @type {CreateTrace | null} */
let active = null

const blank_legs = () => Object.fromEntries(CREATE_TIMING_LEGS.map((leg) => [leg, null]))

const owns_transaction = (/** @type {any} */ transaction) =>
  !!active && !!transaction && active.transaction === transaction

const owns_character = (/** @type {any} */ character_id) =>
  !!active && active.character_id != null && active.character_id === String(character_id)

/** Close one leg at NOW, measured from the end of the leg before it. */
function close(/** @type {string} */ leg) {
  if (!active) return
  const at = timing_now()
  active = { ...active, at, legs: { ...active.legs, [leg]: at - active.at } }
}

/**
 * The create press: bind the trace to the exact transaction the sponsored door is about to run. A second create
 * (or a retry) simply replaces the trace — only one create is ever in flight for a player.
 * @param {any} transaction @param {string} [source]
 */
export function start_create_timing(transaction, source = 'character-create') {
  if (!transaction) return
  const at = timing_now()
  active = { source, transaction, character_id: null, adoption: null, started_at: at, at, legs: blank_legs() }
}

/**
 * The sponsored door's OWN per-leg measurements, for the create's transaction — the numbers it derives at each
 * leg anyway. Read here, never re-measured. Everything after this instant is the caller's own latency.
 * @param {any} transaction
 * @param {{ reserve_ms: number, wallet_sign_ms: number, execute_ms: number }} legs
 */
export function note_create_sponsor_legs(transaction, legs) {
  if (!owns_transaction(transaction)) return
  const at = timing_now()
  const { reserve_ms: reserve, wallet_sign_ms: sign, execute_ms: execute } = legs
  // `prepare` is the REST of the span the door just spent: its own prepare leg (challenge sign ‖ kind build)
  // plus the press-to-door warm-up — ~49ms on a session's FIRST sponsored transaction, which a create usually
  // is — plus the sub-ms local work between legs (gas application, feature lookups). Derived, not re-measured,
  // so the bill is COMPLETE: every millisecond the player waited lands in exactly one leg, and a leg can never
  // quietly hide time in a gap between legs.
  const prepare = Math.max(0, at - active.at - reserve - sign - execute)
  active = { ...active, at, legs: { ...active.legs, prepare, reserve, sign, execute } }
}

/**
 * The certified effects became a normalized receipt and projected the character the roster will predict. Binds
 * the created id, so from here only THAT character's reads may stage or close this trace.
 * @param {any} transaction @param {string} character_id
 * @param {'certified-effects' | 'finality-wait'} adoption which door produced the receipt (#1862)
 */
export function mark_create_receipt(transaction, character_id, adoption) {
  if (!owns_transaction(transaction) || !character_id) return
  close('receipt')
  active = { ...active, character_id: String(character_id), adoption }
}

/** The /v1 roster read that first CONTAINS the new character — the read layer caught up. */
export function mark_create_indexer_visible(/** @type {string} */ character_id) {
  if (!owns_character(character_id) || active.legs.indexer != null) return
  close('indexer')
}

/**
 * The reconciled snapshot reached a state a React subscriber can paint. Closes the trace and emits its ONE line
 * (the house perf idiom — one namespaced `game_log`, printed only in debug, breadcrumbed always). Returns the
 * durations as a unit seam; production ignores them. An unreached leg prints `?ms` — an honest gap, never a zero.
 * @param {string} character_id @returns {Record<string, number | null> & { total: number } | null}
 */
export function finish_create_timing(character_id) {
  if (!owns_character(character_id)) return null
  // The elapsed time belongs to the FIRST leg that never closed — normally `paint`, the only one still open.
  // A bill closed while the read layer still lags bills `indexer` and leaves `paint` a `?`: the gap is named,
  // never smeared over a leg that did not spend it.
  const pending = CREATE_TIMING_LEGS.find((leg) => active.legs[leg] == null)
  if (pending) close(pending)
  const { source, adoption, started_at, legs } = active
  const durations = { ...legs, total: timing_now() - started_at }
  active = null

  const ms = (/** @type {number | null} */ value) => (value == null ? '?ms' : `${Math.round(value)}ms`)
  game_log(
    'create-perf',
    `${source} stages: ` +
      CREATE_TIMING_LEGS.map((leg) => `${leg} ${ms(legs[leg])}`).join(' · ') +
      ` · total ${ms(durations.total)} · receipt-source ${adoption ?? '?'}`
  )
  return durations
}

/** A refused/failed create cannot finish; the next press starts a fresh trace. */
export function cancel_create_timing() {
  active = null
}

/** Unit seam: the character id whose create is currently being measured, or null. */
export const create_timing_character_id = () => active?.character_id ?? null
