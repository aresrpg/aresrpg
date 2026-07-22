// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #166 — compact, clipboard-sized fight diagnostics. The reducer already projects every fact this
// capture needs: fight_id, the applied state version, and a sorted action log. This leaf only takes a bounded
// immutable tail; it never reads transport state, starts a request, or grows a second fight-state home.

export const FIGHT_BUG_REPORT_EVENT_LIMIT = 20
export const FIGHT_BUG_REPORT_ISSUES_URL = 'https://github.com/aresrpg/aresrpg/issues'

const json_replacer = (_key, value) => (typeof value === 'bigint' ? value.toString() : value)

/**
 * Capture the current fight diagnostics as one compact JSON blob.
 * @param {{ fight_id?: string | null, applied_version?: number, log?: any[] } | null | undefined} state
 * @returns {string}
 */
export const capture_fight_bug_report = (state) => {
  const events = Array.isArray(state?.log) ? state.log.slice(-FIGHT_BUG_REPORT_EVENT_LIMIT) : []
  return JSON.stringify(
    {
      fight_id: state?.fight_id ?? null,
      version: state?.applied_version ?? -1,
      event_count: events.length,
      events,
    },
    json_replacer
  )
}

/** Clipboard effect edge with the writer injected for a headless proof and zero browser coupling in capture.
 * @param {{ fight_id?: string | null, applied_version?: number, log?: any[] } | null | undefined} state
 * @param {(blob: string) => Promise<void> | void} write_text
 * @returns {Promise<void>}
 */
export const copy_fight_bug_report = async (state, write_text) => {
  await write_text(capture_fight_bug_report(state))
}
