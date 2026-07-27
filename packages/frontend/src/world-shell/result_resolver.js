// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1383 — THE AUTO-RESOLUTION LOOP. A settled fight's reward must arrive with ZERO user action: "fight settles →
// silent dry-run loop → one submission → XP arrives." This module is that loop, and nothing else.
//
// WHY IT EXISTS (the live coop finding): a coop partner's `FightOutcome` is minted by the OTHER seat's settle.
// The partner's client lost that settle race pre-flight (zero gas), re-read `/v1/pending-outcomes` ONCE
// milliseconds later, and the indexer had not yet ingested the checkpoint that created the outcome — an empty
// answer was read as "nothing pending" and the strand was dropped for the whole session. Nothing else re-detects
// (the boot pass fires once per wallet), so the result parked on a badge until the player went looking.
//
// THE RULE: SIMULATION IS FREE, SUBMISSION IS NOT. Every attempt below rides the S-54 tx gate, which dry-runs the
// open and REFUSES at zero gas if it would abort; the sponsored route dry-runs server-side with the same
// pre-flight provenance. So a refused attempt costs nothing and re-arms, while an EXECUTED failure (a digest =
// gas burned) opens the spend guard's circuit for that outcome and is never submitted again — one machine, the
// existing one (spend_guard.js), never a second circuit. The loop's pacing IS the guard's own backoff schedule.
//
// BOUNDED: this is not a poller. It is armed by a signal (boot, or a settlement that halted), runs a bounded
// budget of ticks, and stops the moment the projection is clean or every remaining row is stuck.

import { backoff_delay_ms } from './spend_guard.js'

/** Ticks one arming may spend. With the guard's schedule (1s·2s·4s·8s·16s·32s·60s…) this is ~2 minutes of
 *  free re-simulation — orders of magnitude more than any observed indexer lag, and still finite. */
export const RESOLVER_MAX_TICKS = 8

/** Consecutive zero-gas refusals after which a result stops being "lagging" and starts being STUCK. On the
 *  guard's schedule that is ~7s of free re-simulation before any recovery UI is offered — long enough that an
 *  indexer catching up never flashes a button, short enough that a genuinely dead open is reachable. */
export const RESOLVER_STUCK_REFUSALS = 3

/**
 * PURE — is this result genuinely stuck, i.e. does it deserve the last-resort recovery surface? The badge is the
 * ONLY consumer; the normal path is silent and automatic, so anything short of this renders nothing.
 * @param {{ attempt?: string|null, circuit_open?: boolean, refusals?: number }} state `attempt` = the
 *   pending-outcomes registry state, `circuit_open`/`refusals` = the spend guard's ledger for this open's intent.
 * @returns {boolean}
 */
export const result_is_stuck = ({ attempt = null, circuit_open = false, refusals = 0 }) =>
  attempt === 'latched' || circuit_open || refusals >= RESOLVER_STUCK_REFUSALS

/**
 * PURE — is this projection row still worth another AUTOMATIC attempt? Two terminal answers, both meaning "gas
 * was burned or the reward already landed": an opened receipt tombstone, and an executed failure (the registry
 * latch and the spend guard's circuit are the same fact seen from two ledgers). Everything else — including a
 * zero-gas refusal — is retryable, because re-simulating costs nothing.
 * @param {{ attempt?: string|null, circuit_open?: boolean }} state @returns {boolean}
 */
export const row_is_resolvable = ({ attempt = null, circuit_open = false }) =>
  attempt !== 'opened' && attempt !== 'latched' && !circuit_open

/**
 * PURE — the wait before tick number `tick` (1 = the first retry). ONE schedule for the whole system: the spend
 * guard's own per-intent backoff, so the loop can never re-attempt faster than the guard would admit.
 * @param {number} tick @param {number} [jitter] the caller's random draw in [0,1)
 * @returns {number} milliseconds
 */
export const resolver_delay_ms = (tick, jitter = 0) => backoff_delay_ms(tick, jitter)

/**
 * PURE — does the loop keep going after a pass?
 * @param {{ pending: number, seen: boolean }} pass  `pending` = rows still unresolved and NOT stuck after this
 *   pass; `seen` = at least one row has been OBSERVED since the arming (resolved or not — a row that opened on
 *   the tick it appeared still answers "the outcome we were owed has arrived").
 * @param {{ tick: number, await_row: boolean }} run  `await_row` = the arming KNOWS an outcome is owed (a
 *   settlement halted pre-flight, so someone else's settle minted mine) — an empty projection is then read as
 *   INDEXER LAG, not as "nothing pending", and the loop waits for the row to appear.
 * @returns {boolean}
 */
export function resolver_continues(pass, { tick, await_row }) {
  if (tick >= RESOLVER_MAX_TICKS) return false
  if (pass.pending > 0) return true
  return await_row && !pass.seen // still waiting for a row we know is coming
}

/**
 * THE LOOP (effect edge). Runs `pass` — one detection+open sweep, returning how many rows are still unresolved —
 * on the guard's backoff schedule until `resolver_continues` says stop. Never throws: a pass that fails is a read
 * hiccup, and the next tick re-checks.
 *
 * ONE LOOP PER WALLET, RE-ARMABLE: a second signal arriving while a loop runs does not start a competing loop
 * (that would double the read/simulate rate) and does not get swallowed either — it REPLACES the live loop's pass
 * and widens its arming, then resets the budget. A new signal is new information; the loop restarts its ticks
 * because of it.
 * @param {string} address
 * @param {() => Promise<{ rows: number, pending: number }>} pass one sweep → how many rows the projection held,
 *   and how many are still unresolved AND still retryable (0 = clean, or every remainder is stuck)
 * @param {{ await_row?: boolean, sleep?: (ms:number)=>Promise<void>, jitter?: () => number }} [opts]
 * @returns {Promise<{ ticks: number, pending: number }>}
 */
export function resolve_pending_results(address, pass, { await_row = false, sleep, jitter } = {}) {
  if (!address || typeof pass !== 'function') return Promise.resolve({ ticks: 0, pending: 0 })
  const live = running.get(address)
  if (live) {
    // eslint-disable-next-line functional/immutable-data -- the module-owned loop record IS the re-arming door
    live.arming = { pass, await_row: live.arming.await_row || await_row, generation: live.arming.generation + 1 }
    return live.flight
  }
  /** @type {{ arming: { pass: () => Promise<number>, await_row: boolean, generation: number }, flight: any }} */
  const record = { arming: { pass, await_row, generation: 0 }, flight: null }
  // eslint-disable-next-line functional/immutable-data -- the flight is bound back onto the record it drives
  record.flight = drive(record, {
    sleep: sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    jitter: jitter ?? Math.random,
  }).finally(() => {
    if (running.get(address) === record) running.delete(address)
  })
  running.set(address, record)
  return record.flight
}

/** @type {Map<string, any>} the per-wallet loop record (its live arming + flight) */
const running = new Map()

async function drive(record, { sleep, jitter }) {
  let tick = 0
  let seen = false
  let pending = 0
  let { generation } = record.arming
  for (;;) {
    if (record.arming.generation !== generation) {
      // A fresh signal landed while we worked or waited: adopt it and give it its own full budget.
      ;({ generation } = record.arming)
      tick = 0
      seen = false
    }
    tick += 1
    const { pass, await_row } = record.arming
    const swept = await pass().catch(() => null)
    // A failed sweep proves nothing — hold the loop open only while an outcome is owed.
    pending = swept ? swept.pending : await_row ? 1 : 0
    if (swept && swept.rows > 0) seen = true
    const stop = !resolver_continues({ pending, seen }, { tick, await_row })
    if (stop && record.arming.generation === generation) return { ticks: tick, pending }
    await sleep(resolver_delay_ms(tick, jitter()))
  }
}

/** Test-only: drop the per-wallet loop registry (the bun test process is long-lived). */
export function reset_resolver_for_test() {
  running.clear()
}
