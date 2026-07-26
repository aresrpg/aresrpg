// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight-state switchboard for deterministic wedge captures. Disabled by default; enable with `?fighttrace=1`
// or `window.__ARES_FIGHT_TRACE_ENABLED = true`, then read `window.__ARES_FIGHT_TRACE` from the same page.
//
// `trace_audience()` below is the ONE answer to "is anyone here a developer?" — the switchboard is what
// defines the trace surface, so the question lives with it.

import { resolve_hack_mode } from '../game/screens/hud/world/engine_flags_pref.js'

const TRACE_LIMIT = 500
let trace_sequence = 0

/** @param {string} search */
export function fight_trace_enabled(search = '') {
  return new URLSearchParams(search).get('fighttrace') === '1'
}

/**
 * IS THIS PAGE A DEV/TRACE SURFACE? (#912) — `?fighttrace=1`, the window switch the simulator's tee arms, or
 * HACK MODE, the QA rail. The ONE home for that question, read by the trace capture below: machinery-speak
 * renders for a driver and nowhere else — a player on a flawless win sees a flawless win.
 */
function trace_audience() {
  if (typeof window === 'undefined') return false
  const search = window.location?.search ?? ''
  return (
    /** @type {any} */ (window).__ARES_FIGHT_TRACE_ENABLED === true ||
    fight_trace_enabled(search) ||
    resolve_hack_mode(search)
  )
}

/** @param {number} sequence @param {number} at_ms @param {string} event @param {Record<string, unknown>} details */
export function fight_trace_row(sequence, at_ms, event, details = {}) {
  return { sequence, at_ms, event, ...details }
}

/** Diagnostic side effect, gated off in ordinary play. @param {string} event @param {Record<string, unknown>} [details] */
export function fight_state_trace(event, details = {}) {
  if (typeof window === 'undefined') return null
  if (!trace_audience()) return null
  const row = fight_trace_row(++trace_sequence, Date.now(), event, details)
  const target = /** @type {any} */ (window)
  const rows = Array.isArray(target.__ARES_FIGHT_TRACE) ? target.__ARES_FIGHT_TRACE : []
  rows.push(row)
  if (rows.length > TRACE_LIMIT) rows.splice(0, rows.length - TRACE_LIMIT)
  target.__ARES_FIGHT_TRACE = rows
  console.info('[fight-state]', row)
  return row
}
