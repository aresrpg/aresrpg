// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LATENCY TRACE — the ONE home for "how this codebase measures click → visible" (D51, the 1-second law).
// Two things live here and nowhere else:
//   · the User Timing primitives, which must never be able to alter or break the path they measure (every call
//     is caught, and a missing/partial implementation degrades to no marks, never to a throw);
//   · `create_latency_trace`, a linear stage recorder for a flow whose identity is known AT THE CLICK: start on
//     the interaction with that id, stamp each stage as it lands, close at the moment the actor can SEE the
//     result. Consecutive stages are measured pairwise plus one total span, so the log line reads as a bill.
// engage_timing.js keeps its own bespoke recorder — its stages bind to a Transaction object and then to a fight
// id that does not exist until finality, which no click-time key models — but shares these primitives, so the
// measuring code still has one home.

import { game_log } from './log.js'

const timing_api = () =>
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.measure === 'function'
    ? performance
    : null

/** Stamp one User Timing mark. Instrumentation NEVER alters the path it measures. */
export const perf_mark = (name) => {
  try {
    timing_api()?.mark(name)
  } catch {
    // A partial User Timing implementation leaves this stage unmarked; the action proceeds unchanged.
  }
}

/** Measure between two marks. A missing/superseded mark leaves the phase absent, never throws. */
export const perf_measure = (name, start, end) => {
  try {
    timing_api()?.measure(name, start, end)
  } catch {
    // Same contract as perf_mark: an absent phase is an honest gap, not a broken interaction.
  }
}

/** Drop these entries only — a fresh interaction must never read the previous one's marks. */
export const perf_clear = (mark_names, measure_names) => {
  const timing = timing_api()
  try {
    for (const name of mark_names) timing?.clearMarks(name)
    for (const name of measure_names) timing?.clearMeasures(name)
  } catch {
    // A partial implementation cannot block the interaction; stale entries are inert data at worst.
  }
}

/** The most recent duration recorded under `name`, or null when the phase never closed. */
export const perf_latest_duration = (name) => {
  try {
    const entries = timing_api()?.getEntriesByName(name, 'measure') ?? []
    return entries[entries.length - 1]?.duration ?? null
  } catch {
    return null
  }
}

const ms = (value) => `${value == null ? '?' : Math.round(value)}ms`

/**
 * A linear click→visible recorder for one flow.
 *
 * `stages` is the ordered stage list, first entry = the interaction itself. Marks are `<prefix>:<stage>`, the
 * measure between consecutive stages is `<prefix>:<from>-to-<to>`, and `<prefix>:total` spans the whole flow.
 * Every call carries the flow's KEY (the fight id being joined, the character being invited): a stage or finish
 * for a different key cannot touch this trace, so a concurrent unrelated flow can never fabricate a fast number.
 *
 * @param {{ prefix: string, stages: readonly string[], namespace: string, label: string }} spec
 */
export function create_latency_trace({ prefix, stages, namespace, label }) {
  const mark_of = (stage) => `${prefix}:${stage}`
  const span_of = (from, to) => `${prefix}:${from}-to-${to}`
  const total = `${prefix}:total`
  const spans = stages.slice(1).map((stage, index) => ({ from: stages[index], to: stage }))
  const mark_names = stages.map(mark_of)
  const measure_names = [...spans.map(({ from, to }) => span_of(from, to)), total]
  const [first_stage] = stages
  const last_stage = stages[stages.length - 1]

  /** @type {{ source: string, key: string, reached: string[] } | null} */
  let active = null

  /** The interaction, for the flow identified by `key`. Clears this trace's previous entries. */
  const start = (key, source = 'unknown') => {
    if (key == null) return
    perf_clear(mark_names, measure_names)
    active = { source, key: String(key), reached: [first_stage] }
    perf_mark(mark_of(first_stage))
  }

  /** Stamp one stage of `key`'s flow, closing the span from the stage before it. Unknown/repeat stages no-op. */
  const stage = (name, key) => {
    if (!active || active.key !== String(key) || !stages.includes(name) || active.reached.includes(name)) return
    const previous = active.reached[active.reached.length - 1]
    active = { ...active, reached: [...active.reached, name] }
    perf_mark(mark_of(name))
    perf_measure(span_of(previous, name), mark_of(previous), mark_of(name))
  }

  /**
   * The actor can SEE the result: close the last stage + the total span and emit the one-line bill. Returns the
   * per-span durations as a unit-test seam (production ignores them); null when `key` owns no live trace.
   */
  const finish = (key) => {
    if (!active || active.key !== String(key)) return null
    stage(last_stage, key)
    perf_measure(total, mark_of(first_stage), mark_of(last_stage))
    const durations = Object.fromEntries([
      ...spans.map(({ from, to }) => [span_of(from, to), perf_latest_duration(span_of(from, to))]),
      [total, perf_latest_duration(total)],
    ])
    const { source } = active
    active = null
    game_log(
      namespace,
      `${source} ${label} stages: ` +
        spans.map(({ from, to }) => `${from}→${to} ${ms(durations[span_of(from, to)])}`).join(' · ') +
        ` · total ${ms(durations[total])}`
    )
    return durations
  }

  /** A refused/failed flow cannot finish; its partial marks stay inspectable until the next `start`. */
  const cancel = () => {
    active = null
  }

  return {
    start,
    stage,
    finish,
    cancel,
    /** Unit seam: the live trace's key, or null. */
    key: () => active?.key ?? null,
    names: Object.freeze({ marks: Object.freeze(mark_names), measures: Object.freeze(measure_names), total }),
  }
}
