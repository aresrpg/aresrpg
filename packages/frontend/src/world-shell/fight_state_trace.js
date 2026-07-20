// Fight-state switchboard for deterministic wedge captures. Disabled by default; enable with `?fighttrace=1`
// or `window.__ARES_FIGHT_TRACE_ENABLED = true`, then read `window.__ARES_FIGHT_TRACE` from the same page.

const TRACE_LIMIT = 500
let trace_sequence = 0

/** @param {string} search */
export function fight_trace_enabled(search = '') {
  return new URLSearchParams(search).get('fighttrace') === '1'
}

/** @param {number} sequence @param {number} at_ms @param {string} event @param {Record<string, unknown>} details */
export function fight_trace_row(sequence, at_ms, event, details = {}) {
  return { sequence, at_ms, event, ...details }
}

/** Diagnostic side effect, gated off in ordinary play. @param {string} event @param {Record<string, unknown>} [details] */
export function fight_state_trace(event, details = {}) {
  if (typeof window === 'undefined') return null
  const enabled =
    /** @type {any} */ (window).__ARES_FIGHT_TRACE_ENABLED === true ||
    fight_trace_enabled(window.location?.search ?? '')
  if (!enabled) return null
  const row = fight_trace_row(++trace_sequence, Date.now(), event, details)
  const target = /** @type {any} */ (window)
  const rows = Array.isArray(target.__ARES_FIGHT_TRACE) ? target.__ARES_FIGHT_TRACE : []
  rows.push(row)
  if (rows.length > TRACE_LIMIT) rows.splice(0, rows.length - TRACE_LIMIT)
  target.__ARES_FIGHT_TRACE = rows
  console.info('[fight-state]', row)
  return row
}
