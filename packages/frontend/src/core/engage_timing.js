// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #438 — ONE cross-module User Timing trace for a fresh [R] pack engage. The trace follows the exact
// Transaction + minted Fight id, so unrelated party/join transactions and resumed/co-op boards cannot finish it.

import { game_log } from './log.js'

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

const mark_names = Object.values(ENGAGE_MARK_NAMES)
const measure_names = Object.values(ENGAGE_MEASURE_NAMES)

/** @type {{ source: string, transaction: object | null, fight_id: string | null, adopted: boolean } | null} */
let active_trace = null

const timing_api = () =>
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.measure === 'function'
    ? performance
    : null

const mark = (name) => {
  try {
    timing_api()?.mark(name)
  } catch {
    // User Timing instrumentation must never alter the engage path.
  }
}

const measure = (name, start, end) => {
  try {
    timing_api()?.measure(name, start, end)
  } catch {
    // A missing/superseded mark leaves this phase absent; the action still proceeds unchanged.
  }
}

const latest_duration = (name) => {
  try {
    const entries = timing_api()?.getEntriesByName(name, 'measure') ?? []
    return entries[entries.length - 1]?.duration ?? null
  } catch {
    return null
  }
}

const is_active_transaction = (transaction) =>
  !!active_trace && !!transaction && active_trace.transaction === transaction

/** The accepted marker interaction: clear only this trace's old entries, then start a fresh measurement. */
export function start_engage_timing(source = 'unknown') {
  const timing = timing_api()
  try {
    for (const name of mark_names) timing?.clearMarks(name)
    for (const name of measure_names) timing?.clearMeasures(name)
  } catch {
    // A partial User Timing implementation still cannot block the interaction.
  }
  active_trace = { source, transaction: null, fight_id: null, adopted: false }
  mark(ENGAGE_MARK_NAMES.marker_interaction)
}

/** Bind the freshly-composed fight transaction to this trace and close marker→PTB build. */
export function mark_engage_ptb_built(transaction) {
  if (!active_trace || !transaction) return
  active_trace = { ...active_trace, transaction, fight_id: null, adopted: false }
  mark(ENGAGE_MARK_NAMES.ptb_built)
  measure(ENGAGE_MEASURE_NAMES.ptb_build, ENGAGE_MARK_NAMES.marker_interaction, ENGAGE_MARK_NAMES.ptb_built)
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
