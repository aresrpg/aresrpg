// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRACE RECORDER — a pure, bounded, in-memory ring buffer over fight/store's ONE input door. Every message
// crossing `input(msg, now)` (store.js `make_input`) is appended VERBATIM: the raw msg, the wall-clock ts, a
// monotonic seq, and the store's own version anchors AT CAPTURE TIME (forensic context, never replayed).
//
// THIS IS NOT packages/sim/src/recorder.js's Capsule. That module taps sim's reduce(state, command, ctx) — the
// CLI/Move-parity fixture door. The live browser client never drives a WHOLE fight through reduce(): only the
// local player's own next-cast preview crosses it (packages/fight/src/predict_cast.js), discarded the instant
// the chain receipt lands. Every other fact of a fight — mob turns, moves, other players, the real outcome —
// arrives as a message at fight/store's input door, which store.js's own docs name "THE ONE DOOR". A trace's
// `inputs`, folded back through a FRESH store (`.input(msg, at)` in order — dev_synth_fight.js already proves
// the pattern), reproduces the exact same projection deterministically. So the STORE is the reducer here, and
// its input log is its capsule — just never called that word (recorder.js/timeline.js keep it).
//
// PURE + TOTAL: no I/O, no Date.now — `at`/`captured_at` are injected by the caller (the effect edge, trace_tap.js).
// Immutable — every record step returns a NEW recorder (the caller holds the mutable box, same contract as
// packages/sim/src/recorder.js).

/** ~2 fights of store inputs — bounded hot-buffer. A store input includes high-frequency control messages
 *  (tick) a sim command never sees, so this bound runs well above sim recorder.js's 512-command/~3-fight one. */
export const DEFAULT_TRACE_CAPACITY = 4000

/** Bump on any breaking change to the exported shape below — the file names its own format so a future reader
 *  (human or tool) never has to guess which era of the shape it holds. */
export const TRACE_FORMAT = 1

/**
 * @typedef {object} TraceAnchors
 * @property {number} applied_version  the store's committed floor at capture time
 * @property {number} view_version     the adopted snapshot's object version at capture time
 * @property {number} receipt_seq      how many receipts had folded at capture time
 */

/**
 * @typedef {object} TraceEntry
 * @property {number} seq            monotonic id, never reused (survives across eviction gaps)
 * @property {string|null} fight_id  the fight this input is scoped to (an 'init' input: the fight it OPENS)
 * @property {number} at             injected wall-clock timestamp (the caller's clock)
 * @property {object} msg            the RAW input message, verbatim — the store's own vocabulary
 * @property {TraceAnchors} anchors  the store's version anchors at capture time
 */

/**
 * @typedef {object} TraceRecorder
 * @property {number} capacity
 * @property {number} seq
 * @property {TraceEntry[]} entries
 */

/**
 * @typedef {object} FightTrace
 * @property {number} trace_format
 * @property {string} fight_id
 * @property {string} app_version
 * @property {number} captured_at
 * @property {{ seq: number, at: number, msg: object, anchors: TraceAnchors }[]} inputs
 */

/** A fresh, empty trace recorder. Immutable — every record step returns a NEW recorder.
 * @param {number} [capacity] @returns {TraceRecorder} */
export const create_trace_recorder = (capacity = DEFAULT_TRACE_CAPACITY) => ({
  capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : DEFAULT_TRACE_CAPACITY,
  seq: 0,
  entries: [],
})

/**
 * Append one input, stamping the next seq and evicting the oldest past capacity. Pure.
 * @param {TraceRecorder} rec
 * @param {{ fight_id: string|null, msg: object, at: number, anchors: TraceAnchors }} entry
 * @returns {TraceRecorder}
 */
export const record_input = (rec, { fight_id, msg, at, anchors }) => ({
  capacity: rec.capacity,
  seq: rec.seq + 1,
  entries: [...rec.entries, { seq: rec.seq, fight_id, at, msg, anchors }].slice(-rec.capacity),
})

/** The fight_id of the most recently opened ('init') recording still in the buffer (or null). */
const latest_open_fight = (rec) => {
  const opens = rec.entries.filter((entry) => entry.msg?.type === 'init')
  return opens.length > 0 ? opens[opens.length - 1].fight_id : null
}

/**
 * Fold the buffered entries for ONE fight into an exportable trace: the LAST 'init' for that fight (a re-init
 * supersedes an earlier attempt) plus every input recorded from it onward, in order — replaying `inputs`
 * through a fresh store's `.input(msg, at)`, in order, reproduces the fight's projection. Returns null when
 * nothing is dumpable (the init was evicted past capacity, or never recorded). Pure — `app_version`/
 * `captured_at` are the caller's (the effect edge owns package.json + Date.now).
 * @param {TraceRecorder} rec
 * @param {string} app_version
 * @param {number} captured_at
 * @param {string} [fight_id]  defaults to the most recently opened fight
 * @returns {FightTrace | null}
 */
export const dump_trace = (rec, app_version, captured_at, fight_id) => {
  const target = fight_id ?? latest_open_fight(rec)
  if (target == null) return null
  const scoped = rec.entries.filter((entry) => entry.fight_id === target)
  const open_idx = scoped.map((entry) => entry.msg?.type).lastIndexOf('init')
  if (open_idx === -1) return null
  const inputs = scoped.slice(open_idx).map(({ seq, at, msg, anchors }) => ({ seq, at, msg, anchors }))
  return { trace_format: TRACE_FORMAT, fight_id: target, app_version, captured_at, inputs }
}
