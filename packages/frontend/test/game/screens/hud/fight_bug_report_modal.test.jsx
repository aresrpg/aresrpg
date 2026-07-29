// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OWNER LIVE REPORT 2026-07-25 — the fight "copy bug report" button opened a GitHub issue whose template read
// "Fight trace — it is already on your clipboard, paste it below" while the clipboard was EMPTY: the
// permission-gated `navigator.clipboard.writeText` had failed silently, so every report arrived traceless. His
// ruling: "the browser permissions to use clipboard is too scary in crypto, let's find something else, like a
// modal with 'copy text'". This pins the replacement WINDOW: the trace is visible text the player can select
// and copy by hand, so the flow has a floor that cannot fail — the COPY button is a convenience above it.
//
// `FightBugReportCard` is the portal-free half (this repo's component tests are renderToStaticMarkup with no
// jsdom — a portal has no target here; same split PetFeedModal documents), so the window's markup and its
// three buttons are directly render-testable.
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightBugReportCard } from '../../../../src/game/screens/hud/FightBugReportModal.jsx'
import en from '../../../../src/i18n/locales/en.json'

const TRACE = '{"fight_id":"0xfeedface","version":47,"event_count":1,"events":[{"kind":"Hit"}]}'

const render = (overrides = {}) =>
  renderToStaticMarkup(
    createElement(FightBugReportCard, {
      trace: TRACE,
      title: en.fight.bug_report_title,
      message: en.fight.bug_report_intro,
      copy_label: en.fight.bug_report_copy,
      issue_label: en.fight.bug_report_open_issue,
      close_label: en.fight.bug_report_close,
      on_copy: () => {},
      on_open_issue: () => {},
      on_close: () => {},
      ...overrides,
    })
  )

test('RED-FIRST: the window RENDERS the trace as copyable text — the player never depends on a clipboard write', () => {
  const html = render()

  expect(html).toContain('data-fight-bug-report-trace')
  expect(html).toContain('0xfeedface') // the trace itself is on screen, selectable by hand
  expect(html).toMatch(/readonly/i) // shown for copying, never edited into a lie
})

test('both actions are present: copy the text, and open the prefilled issue', () => {
  const html = render()

  expect(html).toContain(en.fight.bug_report_copy)
  expect(html).toContain(en.fight.bug_report_open_issue)
  expect(html).toContain(en.fight.bug_report_close)
  expect(html).toContain(en.fight.bug_report_title)
})

test('the manual floor: a refused copy shows the Ctrl/Cmd+C hint, and nothing is shown when it is not needed', () => {
  expect(render({ hint: en.fight.bug_report_copy_failed })).toContain('Ctrl+C')
  expect(render()).not.toContain('Ctrl+C')
})

test('the COPY button flips to the brief acknowledgement label when the copy landed', () => {
  const html = render({ copy_label: en.fight.bug_report_copied })

  expect(html).toContain(en.fight.bug_report_copied)
  expect(html).not.toContain(`>${en.fight.bug_report_copy}<`)
})

test('every window string ships in all six locales (house i18n law)', async () => {
  const keys = [
    'bug_report',
    'bug_report_title',
    'bug_report_intro',
    'bug_report_copy',
    'bug_report_copied',
    'bug_report_copy_failed',
    'bug_report_open_issue',
    'bug_report_close',
  ]
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    const strings = (await import(`../../../../src/i18n/locales/${locale}.json`)).default
    for (const key of keys) expect(strings.fight[key]).toBeString()
  }
})
