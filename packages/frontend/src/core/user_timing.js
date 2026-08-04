// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The User Timing plumbing every cross-module latency trace shares (fight engage · fast travel). ONE home for
// the rule that makes instrumentation safe to sprinkle: a mark, a measure, or a read may NEVER alter or fail the
// path it observes. A partial/absent User Timing implementation degrades to "this phase is unmeasured", never to
// a thrown interaction.

const timing_api = () =>
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.measure === 'function'
    ? performance
    : null

/** @param {string} name */
export function timing_mark(name) {
  try {
    timing_api()?.mark(name)
  } catch {
    // Instrumentation must never alter the instrumented path.
  }
}

/** @param {string} name @param {string} start @param {string} end */
export function timing_measure(name, start, end) {
  try {
    timing_api()?.measure(name, start, end)
  } catch {
    // A missing/superseded mark leaves this phase absent; the action still proceeds unchanged.
  }
}

/** The latest duration recorded under `name`, or null when this phase never closed. @param {string} name */
export function timing_duration(name) {
  try {
    const entries = timing_api()?.getEntriesByName(name, 'measure') ?? []
    return entries[entries.length - 1]?.duration ?? null
  } catch {
    return null
  }
}

/** Drop one trace's previous entries so a fresh run measures itself alone.
 *  @param {string[]} mark_names @param {string[]} measure_names */
export function timing_clear(mark_names, measure_names) {
  const timing = timing_api()
  try {
    for (const name of mark_names) timing?.clearMarks(name)
    for (const name of measure_names) timing?.clearMeasures(name)
  } catch {
    // A partial User Timing implementation still cannot block the interaction.
  }
}
