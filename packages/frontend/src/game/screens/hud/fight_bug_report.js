// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #166 — compact, clipboard-sized fight diagnostics. The reducer already projects every fact this
// capture needs: fight_id, the applied state version, and a sorted action log. This leaf only takes a bounded
// immutable tail; it never reads transport state, starts a request, or grows a second fight-state home.

export const FIGHT_BUG_REPORT_EVENT_LIMIT = 20
export const FIGHT_BUG_REPORT_ISSUES_URL = 'https://github.com/aresrpg/aresrpg/issues'

// Issue #885 — the report flow asks the reporter for ONE act: press Create. The button opens GitHub's
// new-issue page already carrying a title and a body skeleton; the trace stays on the CLIPBOARD because it
// does not fit a query string (a fight trace runs to tens of KB while browsers/servers cap a URL around
// 2-8 KB — a body-borne trace would silently truncate), so the body carries a paste marker instead. The
// body is English on purpose: it is the board's language, and a triage thread arriving in six languages
// costs the maintainer more than it saves the reporter — the PLAYER-facing half is the toast, localized.
const NEW_ISSUE_URL = `${FIGHT_BUG_REPORT_ISSUES_URL}/new`
const short_id = (id) => {
  const text = String(id ?? '')
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text || 'unknown'
}

// Vite injects the build version app-wide; the `typeof` guard keeps this module import-safe under bun test
// (the same idiom fight_trace_export.js / fight_trace_tee.js use for the same constant).
const app_version = () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')

/**
 * The prefilled new-issue URL for the current fight — pure, so the query shape is testable without a browser.
 * @param {{ fight_id?: string | null, applied_version?: number } | null | undefined} state
 * @param {string} [client_version]
 * @returns {string}
 */
export const fight_bug_report_issue_url = (state, client_version = app_version()) => {
  const fight_id = state?.fight_id ?? null
  const body = [
    '**What happened?**',
    '',
    '',
    '**Fight trace** — it is already on your clipboard, paste it below this line:',
    '',
    '',
    '---',
    `fight \`${fight_id ?? 'unknown'}\` · state version ${state?.applied_version ?? -1} · client ${client_version}`,
  ].join('\n')
  const query = new URLSearchParams({ title: `fight: ${short_id(fight_id)} — `, body })
  return `${NEW_ISSUE_URL}?${query}`
}

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
