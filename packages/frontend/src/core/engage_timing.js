// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #438 — ONE cross-module User Timing trace for a fresh [R] pack engage. The trace follows the exact
// Transaction + minted Fight id, so unrelated party/join transactions and resumed/co-op boards cannot finish it.

import { game_log } from './log.js'
// The User Timing primitives have ONE home (latency_trace.js) — this recorder owns only WHICH stages a fresh
// engage has and how they bind to a Transaction + minted fight id.
import { perf_clear, perf_latest_duration, perf_mark, perf_measure } from './latency_trace.js'

export const ENGAGE_MARK_NAMES = Object.freeze({
  marker_interaction: 'fight-engage:marker-interaction',
  ptb_built: 'fight-engage:ptb-built',
  sponsor_reserve_started: 'fight-engage:sponsor-reserve-started',
  sponsor_reserve_finished: 'fight-engage:sponsor-reserve-finished',
  sponsor_simulation_finished: 'fight-engage:sponsor-simulation-finished',
  wallet_signed: 'fight-engage:wallet-signed',
  execution_finished: 'fight-engage:execution-finished',
  receipt_ready: 'fight-engage:receipt-ready',
  fight_adopted: 'fight-engage:fight-adopted',
  board_mounted: 'fight-engage:board-mounted',
})

export const ENGAGE_MEASURE_NAMES = Object.freeze({
  ptb_build: 'fight-engage:ptb-build',
  sponsor_prepare: 'fight-engage:sponsor-prepare',
  sponsor_reserve: 'fight-engage:sponsor-reserve',
  sponsor_simulation: 'fight-engage:sponsor-simulation',
  wallet_sign: 'fight-engage:wallet-sign',
  execution_wait: 'fight-engage:execution-wait',
  effects_wait: 'fight-engage:effects-wait',
  fight_adoption: 'fight-engage:fight-adoption',
  board_mount: 'fight-engage:board-mount',
  total: 'fight-engage:total',
})

/**
 * #2155 — the INSIDE of `ptb-build`, the phase that owns 41-47% of an engage. Its legs are not consecutive
 * stages: the read fan runs as one `Promise.all`, so each leg carries its OWN span (start+end marks) and the
 * bill names WHICH read owns the compose's wall clock rather than implying a sequence that does not exist.
 * `ptb` is the synchronous composer itself — separated on purpose, so "compose is slow" can never again mean
 * "the reads before the composer are slow".
 */
export const ENGAGE_COMPOSE_LEGS = Object.freeze({
  party: 'fight-engage:compose-party',
  sdk: 'fight-engage:compose-sdk',
  kiosk: 'fight-engage:compose-kiosk',
  group_door: 'fight-engage:compose-group-door',
  live_fights: 'fight-engage:compose-live-fights',
  raised_spells: 'fight-engage:compose-raised-spells',
  ptb: 'fight-engage:compose-ptb',
})

const leg_names = Object.values(ENGAGE_COMPOSE_LEGS)
const leg_start = (name) => `${name}:start`
const leg_end = (name) => `${name}:end`

const mark_names = [...Object.values(ENGAGE_MARK_NAMES), ...leg_names.flatMap((n) => [leg_start(n), leg_end(n)])]
const measure_names = [...Object.values(ENGAGE_MEASURE_NAMES), ...leg_names]

/** @type {{ source: string, transaction: object | null, fight_id: string | null, adopted: boolean } | null} */
let active_trace = null

const mark = perf_mark
const measure = perf_measure
const latest_duration = perf_latest_duration

const is_active_transaction = (transaction) =>
  !!active_trace && !!transaction && active_trace.transaction === transaction

/** The accepted marker interaction: clear only this trace's old entries, then start a fresh measurement. */
export function start_engage_timing(source = 'unknown') {
  perf_clear(mark_names, measure_names)
  active_trace = { source, transaction: null, fight_id: null, adopted: false }
  mark(ENGAGE_MARK_NAMES.marker_interaction)
}

/**
 * Time ONE compose leg into this same trace (#2155). `work` is a thunk so a synchronous leg (the composer) and
 * an async one (a read) are billed identically. Instrumentation NEVER alters the path it measures: an unknown
 * leg, a dead trace, or a rejected work all return the caller's own value/rejection untouched.
 * @template T @param {keyof typeof ENGAGE_COMPOSE_LEGS} leg @param {() => T} work @returns {T}
 */
export function time_engage_leg(leg, work) {
  const name = ENGAGE_COMPOSE_LEGS[leg]
  if (!name || !active_trace) return work()
  const close = () => {
    mark(leg_end(name))
    measure(name, leg_start(name), leg_end(name))
  }
  mark(leg_start(name))
  try {
    const value = work()
    if (!value || typeof (/** @type {any} */ (value).then) !== 'function') {
      close()
      return value
    }
    return /** @type {any} */ (
      /** @type {any} */ (value).then(
        (/** @type {any} */ resolved) => {
          close()
          return resolved
        },
        (/** @type {any} */ error) => {
          close()
          throw error
        }
      )
    )
  } catch (error) {
    close()
    throw error
  }
}

/** The compose legs measured so far, phase → ms (null = the leg never closed). Unit/profiling seam. */
export const engage_compose_legs = () =>
  Object.fromEntries(Object.entries(ENGAGE_COMPOSE_LEGS).map(([leg, name]) => [leg, latest_duration(name)]))

/** Bind the freshly-composed fight transaction to this trace and close marker→PTB build. */
export function mark_engage_ptb_built(transaction) {
  if (!active_trace || !transaction) return
  active_trace = { ...active_trace, transaction, fight_id: null, adopted: false }
  mark(ENGAGE_MARK_NAMES.ptb_built)
  measure(ENGAGE_MEASURE_NAMES.ptb_build, ENGAGE_MARK_NAMES.marker_interaction, ENGAGE_MARK_NAMES.ptb_built)
  // The compose's own bill, at the moment it closes — the leg list has ONE home (ENGAGE_COMPOSE_LEGS above), so
  // a new leg joins this line without a second edit. Legs are PARALLEL: they do not sum to ptb-build.
  const legs = engage_compose_legs()
  game_log(
    'engage-perf',
    `compose legs (of ptb-build ${Math.round(latest_duration(ENGAGE_MEASURE_NAMES.ptb_build) ?? 0)}ms): ` +
      Object.entries(legs)
        .map(([leg, value]) => `${leg.replace(/_/g, '-')} ${value == null ? '?' : Math.round(value)}ms`)
        .join(' · ')
  )
}

/** Close PTB→sponsor preparation (kind build + challenge sign) at the reserve request. */
export function mark_engage_reserve_started(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.sponsor_reserve_started)
  measure(ENGAGE_MEASURE_NAMES.sponsor_prepare, ENGAGE_MARK_NAMES.ptb_built, ENGAGE_MARK_NAMES.sponsor_reserve_started)
}

/** Close the sponsor /reserve round trip. */
export function mark_engage_reserve_finished(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.sponsor_reserve_finished)
  measure(
    ENGAGE_MEASURE_NAMES.sponsor_reserve,
    ENGAGE_MARK_NAMES.sponsor_reserve_started,
    ENGAGE_MARK_NAMES.sponsor_reserve_finished
  )
}

/** Close reserved-gas application + the sponsor dry-run. */
export function mark_engage_simulation_finished(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.sponsor_simulation_finished)
  measure(
    ENGAGE_MEASURE_NAMES.sponsor_simulation,
    ENGAGE_MARK_NAMES.sponsor_reserve_finished,
    ENGAGE_MARK_NAMES.sponsor_simulation_finished
  )
}

/** Close the wallet's sender-transaction signature. */
export function mark_engage_wallet_signed(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.wallet_signed)
  measure(
    ENGAGE_MEASURE_NAMES.wallet_sign,
    ENGAGE_MARK_NAMES.sponsor_simulation_finished,
    ENGAGE_MARK_NAMES.wallet_signed
  )
}

/** Close the sponsor /execute round trip, which includes station submission and certified effects. */
export function mark_engage_execution_finished(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.execution_finished)
  measure(ENGAGE_MEASURE_NAMES.execution_wait, ENGAGE_MARK_NAMES.wallet_signed, ENGAGE_MARK_NAMES.execution_finished)
}

/** Close the caller's post-execute effects wait + receipt normalization. */
export function mark_engage_receipt_ready(transaction) {
  if (!is_active_transaction(transaction)) return
  mark(ENGAGE_MARK_NAMES.receipt_ready)
  measure(ENGAGE_MEASURE_NAMES.effects_wait, ENGAGE_MARK_NAMES.execution_finished, ENGAGE_MARK_NAMES.receipt_ready)
}

/** Associate the parsed created Fight id so only that fight's snapshot/mount may finish the trace. */
export function note_engage_fight_id(transaction, fight_id) {
  if (!is_active_transaction(transaction) || !fight_id) return
  active_trace = { ...active_trace, fight_id: String(fight_id), adopted: false }
}

/** The complete Fight object entered the fight core (receipt/read convergence finished). */
export function mark_engage_fight_adopted(fight_id) {
  if (!active_trace?.fight_id || active_trace.adopted || String(fight_id) !== active_trace.fight_id) return
  active_trace = { ...active_trace, adopted: true }
  mark(ENGAGE_MARK_NAMES.fight_adopted)
  measure(ENGAGE_MEASURE_NAMES.fight_adoption, ENGAGE_MARK_NAMES.receipt_ready, ENGAGE_MARK_NAMES.fight_adopted)
}

/**
 * The tactical board finished build+wiring+paint. Close the trace and emit the existing one-line perf idiom.
 * Returns the durations as a unit-test seam; production ignores them.
 */
export function finish_engage_timing(fight_id) {
  if (!active_trace?.fight_id || String(fight_id) !== active_trace.fight_id) return null
  mark(ENGAGE_MARK_NAMES.board_mounted)
  measure(ENGAGE_MEASURE_NAMES.board_mount, ENGAGE_MARK_NAMES.fight_adopted, ENGAGE_MARK_NAMES.board_mounted)
  measure(ENGAGE_MEASURE_NAMES.total, ENGAGE_MARK_NAMES.marker_interaction, ENGAGE_MARK_NAMES.board_mounted)

  const durations = Object.fromEntries(
    Object.entries(ENGAGE_MEASURE_NAMES).map(([phase, name]) => [phase, latest_duration(name)])
  )
  const { source } = active_trace
  active_trace = null

  const ms = (phase) => `${durations[phase] == null ? '?' : Math.round(durations[phase])}ms`
  game_log(
    'engage-perf',
    `${source} engage stages: ptb-build ${ms('ptb_build')} · sponsor-prepare ${ms('sponsor_prepare')} · ` +
      `reserve ${ms('sponsor_reserve')} · simulation ${ms('sponsor_simulation')} · ` +
      `wallet-sign ${ms('wallet_sign')} · execute ${ms('execution_wait')} · effects-wait ${ms('effects_wait')} · ` +
      `adopt ${ms('fight_adoption')} · board-mount ${ms('board_mount')} · total ${ms('total')}`
  )
  return durations
}

/** A refused/failed engage cannot finish; leave its partial marks inspectable until the next accepted engage. */
export function cancel_engage_timing() {
  active_trace = null
}
