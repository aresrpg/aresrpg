// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #166 — the in-fight bug-report capture is deliberately tiny: current fight identity, the core's
// applied state version, and a bounded tail of the already-projected event log. These tests pin the captured
// payload itself; the HUD must never render an unbounded fight history or mutate the reducer-owned log.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  FIGHT_BUG_REPORT_EVENT_LIMIT,
  FIGHT_BUG_REPORT_ISSUES_URL,
  capture_fight_bug_report,
  copy_via_selection,
  fight_bug_report_issue_url,
  select_all_text,
} from './fight_bug_report.js'

const event = (event_idx) => ({
  kind: 'Hit',
  version: 40 + event_idx,
  event_idx,
  source: 'receipt',
  remaining_hp: 100 - event_idx,
})

describe('fight bug report capture', () => {
  test('RED-FIRST: the compact JSON shape carries fight id, applied version, and an explicit bounded event count', () => {
    const blob = capture_fight_bug_report({
      fight_id: '0xfight',
      applied_version: 47,
      log: [event(0), event(1)],
    })
    const captured = JSON.parse(blob)

    expect(blob).not.toContain('\n')
    expect(captured.fight_id).toBe('0xfight')
    expect(captured.version).toBe(47)
    expect(captured.event_count).toBe(2)
    expect(captured.events.map((entry) => entry.event_idx)).toEqual([0, 1])
  })

  test('keeps only the recent event window without mutating the reducer-owned projection', () => {
    const log = Array.from({ length: FIGHT_BUG_REPORT_EVENT_LIMIT + 3 }, (_unused, event_idx) => event(event_idx))
    const before = log.map((entry) => ({ ...entry }))
    const captured = JSON.parse(capture_fight_bug_report({ fight_id: '0xfight', applied_version: 99, log }))

    expect(captured.event_count).toBe(FIGHT_BUG_REPORT_EVENT_LIMIT)
    expect(captured.events).toHaveLength(FIGHT_BUG_REPORT_EVENT_LIMIT)
    expect(captured.events[0].event_idx).toBe(3)
    expect(captured.events.at(-1).event_idx).toBe(FIGHT_BUG_REPORT_EVENT_LIMIT + 2)
    expect(log).toEqual(before)
  })

  test('the rendered capture stays BigInt-safe — a chain u64 in the log serializes instead of throwing', () => {
    const captured = JSON.parse(
      capture_fight_bug_report({
        fight_id: '0xfight',
        applied_version: 51,
        log: [{ ...event(0), chain_value: 9n }],
      })
    )

    expect(captured).toMatchObject({
      fight_id: '0xfight',
      version: 51,
      event_count: 1,
      events: [{ chain_value: '9' }],
    })
  })
})

// Issue #885 — the flow opens GitHub's new-issue page ALREADY prefilled so Create is the only remaining click;
// the trace never fits a query string, so the player brings it from the report window. These pin the URL
// contract: the destination, the identity of the fight, and the paste marker the body must carry.
describe('the prefilled issue destination', () => {
  const url_of = (state) => new URL(fight_bug_report_issue_url(state, '1.13.0'))

  test('RED-FIRST: the button lands on the repository new-issue form, prefilled', () => {
    const url = url_of({ fight_id: '0xfeedfacecafebabe0000000000000000deadbeef', applied_version: 47 })

    expect(url.origin + url.pathname).toBe(`${FIGHT_BUG_REPORT_ISSUES_URL}/new`)
    expect(url.searchParams.get('title')).toContain('0xfeedfa…beef')
    const body = url.searchParams.get('body') ?? ''
    expect(body).toContain('paste the trace you copied')
    expect(body).toContain('0xfeedfacecafebabe0000000000000000deadbeef')
    expect(body).toContain('state version 47')
    expect(body).toContain('client 1.13.0')
  })

  test('the URL stays inside the browser address ceiling — the TRACE never rides the query string', () => {
    const state = {
      fight_id: '0xfight',
      applied_version: 51,
      log: Array.from({ length: 500 }, (_unused, i) => ({ kind: 'Hit', event_idx: i, remaining_hp: i })),
    }

    expect(fight_bug_report_issue_url(state, '1.13.0').length).toBeLessThan(2000)
    expect(fight_bug_report_issue_url(state, '1.13.0')).not.toContain('remaining_hp')
  })

  test('a fight with no id still yields a usable form', () => {
    const url = url_of({})

    expect(url.searchParams.get('title')).toContain('unknown')
    expect(url.searchParams.get('body')).toContain('unknown')
  })
})

// OWNER RULING 2026-07-25 (live report): the button opened an issue whose template said the trace was "already
// on your clipboard" while the clipboard was EMPTY — `navigator.clipboard.writeText` is permission-gated and
// was failing silently. His call: "the browser permissions to use clipboard is too scary in crypto, let's find
// something else, like a modal with 'copy text'". So the ban is mechanical, not a habit: NOTHING in this flow
// may name `navigator.clipboard`, and the issue template may never claim the clipboard again.
describe('the report flow never asks for a clipboard permission (owner ruling 2026-07-25)', () => {
  const source_of = (file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

  test('RED-FIRST: no file in the flow touches navigator.clipboard', () => {
    for (const file of ['fight_bug_report.js', 'FightBugReportModal.jsx', 'FightControls.jsx'])
      expect(source_of(file)).not.toContain('navigator.clipboard')
  })

  test('the copy path runs on the LEGACY, prompt-free document.execCommand seam', () => {
    expect(source_of('fight_bug_report.js')).toContain("execCommand('copy')")
  })

  test('the issue template no longer claims the trace is already on the clipboard', () => {
    const body = new URL(fight_bug_report_issue_url({ fight_id: '0xfight', applied_version: 3 }, '1.13.0'))
      .searchParams.get('body')

    expect(body).not.toContain('clipboard')
    expect(body).toContain('paste the trace you copied')
  })
})

describe('copy_via_selection — the prompt-free copy edge, and its guaranteed manual floor', () => {
  const field = () => {
    const calls = { focus: 0, select: 0 }
    return { calls, focus: () => (calls.focus += 1), select: () => (calls.select += 1) }
  }

  test('selects the field and reports the document verdict — and never reads navigator.clipboard', () => {
    // A poisoned clipboard: any read of the property is an immediate, loud failure.
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      get() {
        throw new Error('navigator.clipboard must never be read by the fight bug-report flow')
      },
    })
    try {
      const element = field()
      expect(copy_via_selection(element, { execCommand: (command) => command === 'copy' })).toBe(true)
      expect(element.calls.select).toBe(1)
      expect(element.calls.focus).toBe(1)
    } finally {
      if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original)
      else delete globalThis.navigator.clipboard
    }
  })

  test('a REFUSED copy is a false verdict with the text left selected — never a throw, never a dead end', () => {
    const refused = field()
    expect(
      copy_via_selection(refused, {
        execCommand: () => {
          throw new Error('blocked')
        },
      })
    ).toBe(false)
    expect(refused.calls.select).toBe(1) // still selected ⇒ Ctrl/Cmd+C works

    expect(copy_via_selection(field(), { execCommand: () => false })).toBe(false)
    expect(copy_via_selection(field(), {})).toBe(false) // no execCommand at all (old/locked-down engine)
    expect(copy_via_selection(null, { execCommand: () => true })).toBe(false) // nothing rendered yet
  })

  test('select_all_text is null-safe — an unmounted field is a no-op, not a crash', () => {
    expect(() => select_all_text(null)).not.toThrow()
    const element = field()
    select_all_text(element)
    expect(element.calls).toEqual({ focus: 1, select: 1 })
  })
})
