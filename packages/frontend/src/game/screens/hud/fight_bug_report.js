// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #166 — compact, clipboard-sized fight diagnostics. The reducer already projects every fact this
// capture needs: fight_id, the applied state version, and a sorted action log. This leaf only takes a bounded
// immutable tail; it never reads transport state, starts a request, or grows a second fight-state home.

export const FIGHT_BUG_REPORT_EVENT_LIMIT = 20
export const FIGHT_BUG_REPORT_ISSUES_URL = 'https://github.com/aresrpg/aresrpg/issues'

// Issue #885 — the report flow opens GitHub's new-issue page already carrying a title and a body skeleton;
// the trace does NOT ride the query string (a fight trace runs to tens of KB while browsers/servers cap a URL
// around 2-8 KB — a body-borne trace would silently truncate), so the body carries a paste marker instead.
// The reporter gets that trace from the report MODAL, which shows it as selectable text (see below — this
// flow never asks the browser for clipboard permission). The body is English on purpose: it is the board's
// language, and a triage thread arriving in six languages costs the maintainer more than it saves the
// reporter — the PLAYER-facing half is the modal, localized.
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
    '**Fight trace** — paste the trace you copied from the report window below this line:',
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

/** Select every character of an already-rendered text field. The modal calls this on open so the trace is
 *  pre-selected: Ctrl/Cmd+C is then the guaranteed manual floor, whatever the copy button does.
 * @param {{ focus?: () => void, select?: () => void } | null | undefined} element
 * @returns {void}
 */
export const select_all_text = (element) => {
  element?.focus?.()
  element?.select?.()
}

/** THE CLIPBOARD EDGE — owner ruling 2026-07-25: "the browser permissions to use clipboard is too scary in
 *  crypto, let's find something else". The ASYNC clipboard API is permission-gated and was failing SILENTLY
 *  (the issue template promised a trace the player never had); it is banned from this flow — the tests scan
 *  these sources for its name, so it may not even be spelled here. The legacy `document.execCommand('copy')`
 *  is a different beast: it needs no permission at all — it just copies the current selection when it runs
 *  inside a user gesture. It can still refuse, so it returns a verdict rather than throwing: on `false` the
 *  caller leaves the text selected and says press Ctrl/Cmd+C.
 * @param {{ focus?: () => void, select?: () => void } | null | undefined} element
 * @param {{ execCommand?: (command: string) => boolean } | null | undefined} doc
 * @returns {boolean} true only when the document reports the copy actually happened
 */
export const copy_via_selection = (element, doc) => {
  if (!element || typeof doc?.execCommand !== 'function') return false
  select_all_text(element)
  try {
    return doc.execCommand('copy') === true
  } catch {
    return false
  }
}
