// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  game_log — the ONE namespaced diagnostic logger (S-Sentry · pre-testnet law)
// ─────────────────────────────────────────────────────────────────────────────
//  Replaces raw `console.*['[tag]', …]` switchboards for KEEPER diagnostics. It does THREE things,
//  always in this order:
//    (a) RING BUFFER — the last RING_CAP timestamped entries are kept regardless of verbosity, so a
//        crash can carry the run-up (report.js attaches the tail; Sentry breadcrumbs carry the same).
//    (b) BREADCRUMB SINK — every entry is handed to a registered sink (report.js registers one that
//        forwards to Sentry) so the last ~50 game events RIDE ALONG with the next reported error.
//    (c) CONSOLE — printed ONLY when debug is on (`?debug=1` / localStorage.ares_debug / dev build);
//        SILENT for players otherwise (they never see `[dungeon] …` spam), devs keep the switchboard.
//
//  This is NOT an error channel. Genuine failures go through report.js `report_error` (loud to us) +
//  a humanized toast (clear to them). game_log is the run-up context those errors pair with.
//
//  Convention: `game_log('join', 'roster loaded', count)` — the FIRST arg is the bracket namespace
//  (the old `[join]` tag, minus the brackets); the rest are the payload, printed `[join] roster …`.

const RING_CAP = 50

/** @typedef {{ t: number, ns: string, message: string }} LogEntry */

/** @type {LogEntry[]} */
let ring = []

/** @type {((entry: LogEntry) => void) | null} */
let breadcrumb_sink = null

// Debug gate: DEV build OR `?debug=1` in the URL OR a truthy localStorage.ares_debug. Evaluated once at
// module load (a page reload re-reads it). `?debug=1` also PERSISTS to localStorage so it survives an
// in-app navigation. Fully guarded so a non-browser (bun test) context resolves it to false, never throws.
const debug_on = (() => {
  let on = false
  try {
    // import.meta.env is a Vite injection — absent under bun; the try makes the read node-safe.
    on = !!(/** @type {any} */ (import.meta).env?.DEV)
  } catch {
    /* not a Vite build — DEV stays false */
  }
  try {
    if (typeof window !== 'undefined' && window.location) {
      if (new URLSearchParams(window.location.search).get('debug') === '1') {
        on = true
        window.localStorage?.setItem('ares_debug', '1')
      }
    }
  } catch {
    /* no window / storage blocked — ignore */
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem('ares_debug')) on = true
  } catch {
    /* storage blocked — ignore */
  }
  return on
})()

/** Is the diagnostic console channel live? (exported so a call site can skip building an expensive payload) */
export function is_debug() {
  return debug_on
}

/** Coerce ONE log arg to a string that NEVER yields "[object Object]" (the no-jargon law, applied to logs). */
function format_arg(/** @type {unknown} */ a) {
  if (a == null) return String(a)
  const t = typeof a
  if (t === 'string') return a
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(a)
  if (t === 'function') return '[fn]'
  if (a instanceof Error) return `${a.name}: ${a.message}`
  try {
    const json = JSON.stringify(a)
    if (json && json !== '{}') return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    /* circular / non-serialisable */
  }
  return Object.prototype.toString.call(a)
}

/** Join args into one compact message string (total capped so a log entry can never balloon). */
function format_args(/** @type {unknown[]} */ args) {
  const msg = args.map(format_arg).join(' ')
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

/**
 * Log a namespaced diagnostic event. Buffered + breadcrumbed ALWAYS; printed only in debug.
 * @param {string} namespace the bracket tag, brackets dropped (e.g. 'join', 'gas-guard', 'DNG')
 * @param {...unknown} args the payload (strings, numbers, objects, Errors — all safely stringified)
 */
export function game_log(namespace, ...args) {
  const entry = { t: Date.now(), ns: String(namespace), message: format_args(args) }
  ring = [...ring, entry].slice(-RING_CAP)
  if (breadcrumb_sink) {
    try {
      breadcrumb_sink(entry)
    } catch {
      /* a breadcrumb sink must never break a log call */
    }
  }
  if (debug_on) console.info(`[${entry.ns}]`, ...args)
}

/** Curry helper for a hot call site: `const d = log('dungeon'); d('foo', x)`. */
export const log =
  (/** @type {string} */ namespace) =>
  (/** @type {unknown[]} */ ...args) =>
    game_log(namespace, ...args)

/** A COPY of the ring buffer (oldest → newest) — report.js attaches the tail to a reported error. */
export function get_log_buffer() {
  return ring.slice()
}

/**
 * Register the sink every future entry is handed to (report.js forwards it to Sentry as a breadcrumb).
 * One consumer, last registration wins. Pass null to detach (tests).
 * @param {((entry: LogEntry) => void) | null} sink
 */
export function set_breadcrumb_sink(sink) {
  breadcrumb_sink = sink
}

/** TEST-ONLY: reset the ring so buffer assertions start clean. */
export function _reset_log_for_test() {
  ring = []
  breadcrumb_sink = null
}
