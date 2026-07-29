// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT BUG REPORT WINDOW — owner ruling 2026-07-25: "the browser permissions to use clipboard is too scary in
// crypto, let's find something else, like a modal with 'copy text'". The old flow wrote the trace with the
// ASYNC clipboard API and told GitHub's issue template it was "already on your clipboard" — that write was
// permission-gated and failed silently, so reporters pasted nothing. Nothing here ever asks for a
// permission: the trace is RENDERED, pre-selected, and copyable three ways that all work — the COPY button
// (legacy `document.execCommand('copy')`, no prompt), Ctrl/Cmd+C on the standing selection, or plain mouse
// selection. The button is a convenience over the manual floor, never the only door.
//
// Split like PetFeedModal/CrushConfirmModal: `FightBugReportCard` is the portal-free, hook-free view (this
// repo's component tests are renderToStaticMarkup with no jsdom, which cannot resolve a portal target), and
// `FightBugReportModal` is the thin stateful shell that owns the selection, the copy verdict and Escape.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { copy_via_selection, select_all_text } from './fight_bug_report.js'
import './fight-bug-report.css'

/**
 * The window's markup — pure, prop-driven, portal-free so it renders under a static test.
 * @param {{
 *   trace: string,
 *   title: string,
 *   message: string,
 *   copy_label: string,
 *   issue_label: string,
 *   close_label: string,
 *   hint?: string | null,
 *   trace_ref?: import('react').Ref<HTMLTextAreaElement>,
 *   on_copy: () => void,
 *   on_open_issue: () => void,
 *   on_close: () => void,
 * }} props
 * @returns {import('react').ReactElement}
 */
export function FightBugReportCard({
  trace,
  title,
  message,
  copy_label,
  issue_label,
  close_label,
  hint = null,
  trace_ref,
  on_copy,
  on_open_issue,
  on_close,
}) {
  return (
    <div className="fight-bugreport" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div className="fight-bugreport__title">{title}</div>
      <div className="fight-bugreport__msg">{message}</div>
      <textarea
        ref={trace_ref}
        className="fight-bugreport__trace"
        data-fight-bug-report-trace
        readOnly
        spellCheck={false}
        value={trace}
        onFocus={(e) => e.currentTarget.select()}
      />
      {hint && <div className="fight-bugreport__hint">{hint}</div>}
      <div className="fight-bugreport__btns">
        <button type="button" className="fight-bugreport__btn fight-bugreport__btn--ghost" onClick={on_close}>
          {close_label}
        </button>
        <button type="button" className="fight-bugreport__btn fight-bugreport__btn--copy" onClick={on_copy}>
          {copy_label}
        </button>
        <button type="button" className="fight-bugreport__btn fight-bugreport__btn--issue" onClick={on_open_issue}>
          {issue_label}
        </button>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   trace: string | null,
 *   issue_url: string,
 *   t: (key: string) => string,
 *   on_close: () => void,
 * }} props
 * @returns {import('react').ReactElement | null}
 */
export function FightBugReportModal({ trace, issue_url, t, on_close }) {
  const trace_ref = useRef(/** @type {HTMLTextAreaElement | null} */ (null))
  const [copied, set_copied] = useState(false)
  const [copy_refused, set_copy_refused] = useState(false)
  const open = trace != null

  // Pre-select on open: Ctrl/Cmd+C is the guaranteed floor even if the button's execCommand is refused.
  useEffect(() => {
    if (!open) return
    set_copied(false)
    set_copy_refused(false)
    select_all_text(trace_ref.current)
  }, [open, trace])

  // COPIED is a brief acknowledgement, not a mode — it decays back to the action label.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => set_copied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!open) return
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open, on_close])

  if (!open) return null

  const on_copy = () => {
    const done = copy_via_selection(trace_ref.current, typeof document !== 'undefined' ? document : null)
    set_copied(done)
    set_copy_refused(!done) // refusal leaves the text selected — the hint names the manual keystroke
  }

  const on_open_issue = () => {
    if (typeof window !== 'undefined') window.open(issue_url, '_blank', 'noopener,noreferrer')
  }

  // Portal to <body>: the HUD's panels set `backdrop-filter`, which per spec makes them the containing block
  // for `position: fixed` descendants — rendered inline the scrim would anchor to the panel (see ConfirmDialog).
  return createPortal(
    <div className="fight-bugreport__scrim" onClick={on_close}>
      <FightBugReportCard
        trace={trace}
        title={t('fight.bug_report_title')}
        message={t('fight.bug_report_intro')}
        copy_label={copied ? t('fight.bug_report_copied') : t('fight.bug_report_copy')}
        issue_label={t('fight.bug_report_open_issue')}
        close_label={t('fight.bug_report_close')}
        hint={copy_refused ? t('fight.bug_report_copy_failed') : null}
        trace_ref={trace_ref}
        on_copy={on_copy}
        on_open_issue={on_open_issue}
        on_close={on_close}
      />
    </div>,
    document.body
  )
}
