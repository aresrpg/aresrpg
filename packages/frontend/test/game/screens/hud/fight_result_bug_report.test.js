// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { report_fight_bug } from '../../../../src/game/screens/hud/fight_bug_report.js'

test('REPORT BUG downloads the replay capsule before opening one prefilled GitHub issue', () => {
  const events = []

  const reported = report_fight_bug({
    trace: {
      fight_id: '0xfeedface',
      inputs: [{ anchors: { applied_version: 47 } }],
    },
    client_version: '1.13.0',
    export_replay: () => {
      events.push({ type: 'download' })
      return true
    },
    open_issue: (url, target, features) => {
      events.push({ type: 'open', url: new URL(url), target, features })
    },
  })

  expect(reported).toBe(true)
  expect(events.map(({ type }) => type)).toEqual(['download', 'open'])
  expect(events[1].url.origin + events[1].url.pathname).toBe('https://github.com/aresrpg/aresrpg/issues/new')
  expect(events[1].url.searchParams.get('title')).toContain('0xfeedface')
  expect(events[1].url.searchParams.get('body')).toContain('attach the downloaded replay capsule')
  expect(events[1]).toMatchObject({ target: '_blank', features: 'noopener,noreferrer' })
})

test('a missing replay capsule neither opens GitHub nor fabricates a report', () => {
  let opened = false
  expect(
    report_fight_bug({
      trace: null,
      export_replay: () => true,
      open_issue: () => {
        opened = true
      },
    })
  ).toBe(false)
  expect(opened).toBe(false)
})

test('REPORT BUG label and capsule instructions ship in all six locales', () => {
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../../../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
    )
    expect(messages.fight_end.report_bug).toBeString()
    expect(messages.fight_end.report_bug_hint).toBeString()
  }
})
