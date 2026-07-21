// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RECORDER — the client fight BLACK BOX: a pure, bounded, in-memory ring buffer that TAPS the
// reducer door. Every input crossing reduce()'s edge is appended: the opening snapshot (arena +
// raw spell templates + initial teams) and then each command, timestamped, with the pre/post
// state VERSIONS (content digests). Oldest evicts past capacity. `dump_capsule` folds the ring
// back into a timeline.js Capsule (meta.source: 'sentry') that replays through the EXACT same
// door as the authored goldens (see timeline.js `replay_capsule`) — so a captured fight becomes a
// replay-gate fixture. R1 is tap + buffer + dump ONLY; the durable IndexedDB flush and the ~3-fight
// / 15-minute retention are R4/R8, which consume this module unchanged.
//
// PURE + TOTAL: no I/O, no Date.now, no Math.random — the timestamp `at` is injected by the caller
// (the edge), so the module stays byte-deterministic and tests script the clock (the sim's own law).
// The tap is a read-only observer OUTSIDE the reducer (one-pipeline law: effects at the edges); it
// never mutates what it observes, and it is structurally unable to throw into the game — a
// malformed observation costs at most one entry, never a frame. Consumers read `rec.entries` for
// forensics; `dump_capsule` is the clean, replayable export.

import { digest, check_tripwires } from './timeline.js'

/** ~3 fights of commands (issue #62) — the in-memory hot-buffer bound; durable retention is R4/R8. */
export const DEFAULT_CAPACITY = 512

/** @typedef {import('./timeline.js').Capsule} Capsule */

/**
 * @typedef {object} OpenEntry  the opening snapshot — the capsule header crossing the door.
 * @property {'open'} kind
 * @property {number} seq       monotonic id, never reused (survives across eviction gaps)
 * @property {string} fight_id
 * @property {number} at        injected timestamp (the caller's clock)
 * @property {Capsule['arena']} arena
 * @property {object} templates_raw
 * @property {Capsule['initial']} initial
 * @property {object} meta       partial capsule meta (source is forced to 'sentry' at dump)
 */

/**
 * @typedef {object} StepEntry  one reduce() call observed at the edge.
 * @property {'step'} kind
 * @property {number} seq
 * @property {string} fight_id
 * @property {number} at
 * @property {object} command   the input (sim command) that crossed the reducer door
 * @property {object[]} events  the events reduce() emitted for it
 * @property {string} pre       digest of the state BEFORE the command (the pre version)
 * @property {string} post      digest of the state AFTER  the command (the post version)
 */

/** @typedef {OpenEntry | StepEntry} Entry */

/**
 * @typedef {object} Recorder
 * @property {number} capacity
 * @property {number} seq       the next sequence number to assign
 * @property {Entry[]} entries  the ring, oldest-first, length <= capacity
 */

/**
 * A fresh, empty recorder. Immutable — every record step returns a NEW recorder.
 * @param {number} [capacity]
 * @returns {Recorder}
 */
export const create_recorder = (capacity = DEFAULT_CAPACITY) => ({
  capacity:
    Number.isInteger(capacity) && capacity > 0 ? capacity : DEFAULT_CAPACITY,
  seq: 0,
  entries: [],
})

/**
 * digest that never throws (a nullish state has no version rather than crashing the tap).
 * @param {unknown} state
 * @returns {string}
 */
const version_of = state => (state == null ? '00000000' : digest(state))

/**
 * Append one entry, stamping the next seq and evicting the oldest past capacity. Pure.
 * (`Omit` distributes per-member so each variant keeps its own fields — `Omit<union>` would
 * collapse to the shared keys only.)
 * @param {Recorder} rec
 * @param {Omit<OpenEntry, 'seq'> | Omit<StepEntry, 'seq'>} entry
 * @returns {Recorder}
 */
const append = (rec, entry) => ({
  capacity: rec.capacity,
  seq: rec.seq + 1,
  entries: [
    ...rec.entries,
    /** @type {Entry} */ ({ ...entry, seq: rec.seq }),
  ].slice(-rec.capacity),
})

/**
 * Open a recording: append the capsule HEADER (arena + raw templates + initial teams) for a fight.
 * The header is an input too — the opening snapshot crossing the door. Total.
 * @param {Recorder} rec
 * @param {{ fight_id: string, arena: Capsule['arena'], templates_raw: object, initial: Capsule['initial'], at?: number, meta?: object }} params
 * @returns {Recorder}
 */
export const open_recording = (
  rec,
  { fight_id, arena, templates_raw, initial, at = 0, meta = {} },
) =>
  append(rec, {
    kind: 'open',
    fight_id,
    at,
    arena,
    templates_raw,
    initial,
    meta,
  })

/**
 * THE TAP: observe one reduce() call at the edge. Records the command, the events it produced, the
 * injected timestamp, and the pre/post state VERSIONS (content digests). Reads only — it never
 * mutates pre_state/post_state and never throws into the game. Total.
 * @param {Recorder} rec
 * @param {{ fight_id: string, command: object, pre_state: object, post_state: object, events?: object[], at?: number }} params
 * @returns {Recorder}
 */
export const observe_reduce = (
  rec,
  { fight_id, command, pre_state, post_state, events = [], at = 0 },
) =>
  append(rec, {
    kind: 'step',
    fight_id,
    at,
    command,
    events: Array.isArray(events) ? events : [],
    pre: version_of(pre_state),
    post: version_of(post_state),
  })

/**
 * THE CHECKED TAP (issue #63 · R2): observe one reduce() call AND run the physics tripwires over the
 * SAME transition at the SAME edge. Returns the updated recorder plus the violation records for this
 * step — the sensor-net signal R3/R4 consume to snip the surrounding window (`dump_capsule`) into a
 * travelling capsule. Pure and TOTAL: records and reports, never mutates the observed states and is
 * structurally unable to throw into the game (a live invariant breach is DATA, not a crash). Composes
 * R1's `observe_reduce` with timeline.js `check_tripwires` — zero duplication.
 * @param {Recorder} rec
 * @param {{ fight_id: string, command: object, pre_state: object, post_state: object, events?: object[], at?: number }} params
 * @returns {{ rec: Recorder, violations: { rule: string, entities: string[], message: string, evidence: string }[] }}
 */
export const observe_reduce_checked = (rec, params) => ({
  rec: observe_reduce(rec, params),
  violations: check_tripwires(
    params.pre_state,
    params.post_state,
    params.command,
    params.events ?? [],
  ),
})

/** The fight_id of the most recently opened recording still in the buffer (or null). */
const latest_open_fight = rec => {
  const opens = rec.entries.filter(entry => entry.kind === 'open')
  return opens.length > 0 ? opens[opens.length - 1].fight_id : null
}

/**
 * Fold the buffered entries for ONE fight back into a replayable timeline.js Capsule: the LAST open
 * header for that fight (a re-open supersedes the earlier attempt) plus every step recorded after
 * it, in order. Deterministic ordering, JSON-serializable, no `expected` block — a sentry capsule's
 * expectation is authored on ingest by the gate's `record_expectation` (R4/R8). Returns null when
 * nothing is dumpable (the open was evicted or never recorded). Pure.
 * @param {Recorder} rec
 * @param {string} [fight_id]  defaults to the most recent open recording
 * @returns {Capsule | null}
 */
export const dump_capsule = (rec, fight_id) => {
  const target = fight_id ?? latest_open_fight(rec)
  if (target == null) return null
  const scoped = rec.entries.filter(entry => entry.fight_id === target)
  const open_idx = scoped.map(entry => entry.kind).lastIndexOf('open')
  if (open_idx === -1) return null
  const header = /** @type {OpenEntry} */ (scoped[open_idx])
  const commands = scoped
    .slice(open_idx + 1)
    .filter(entry => entry.kind === 'step')
    .map(entry => /** @type {StepEntry} */ (entry).command)
  return {
    meta: { id: target, ...header.meta, source: 'sentry' },
    arena: header.arena,
    templates_raw: header.templates_raw,
    initial: header.initial,
    commands,
  }
}
