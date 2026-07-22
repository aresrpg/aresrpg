// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #166 — the in-fight bug-report capture is deliberately tiny: current fight identity, the core's
// applied state version, and a bounded tail of the already-projected event log. These tests pin the clipboard
// payload itself; the HUD must never copy an unbounded fight history or mutate the reducer-owned log.

import { describe, expect, test } from 'bun:test'

import {
  FIGHT_BUG_REPORT_EVENT_LIMIT,
  capture_fight_bug_report,
  copy_fight_bug_report,
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

  test('the clipboard edge receives exactly the compact capture and remains BigInt-safe', async () => {
    const written = []
    const state = {
      fight_id: '0xfight',
      applied_version: 51,
      log: [{ ...event(0), chain_value: 9n }],
    }

    await copy_fight_bug_report(state, (blob) => {
      written.push(blob)
      return Promise.resolve()
    })

    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0])).toMatchObject({
      fight_id: '0xfight',
      version: 51,
      event_count: 1,
      events: [{ chain_value: '9' }],
    })
  })
})
