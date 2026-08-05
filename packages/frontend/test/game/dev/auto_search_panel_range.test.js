// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2180 — the range is a tier ring around world (0,0), not a radius around the player. The panel says so in
// every shipped language; this parity gate keeps a future copy edit from reverting to the ambiguous label.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'uk']

describe('#2180 — the panel labels the world-centre range', () => {
  test('the range section renders the dedicated world-centre label', () => {
    const source = readFileSync(new URL('../../../src/game/dev/auto_search_view.jsx', import.meta.url), 'utf8')
    expect(source).toContain("t('auto_search.range_label')")
  })

  test.each(LOCALES)('%s carries a non-empty localized range label', async (locale) => {
    const messages = await import(`../../../src/i18n/locales/${locale}.json`)
    expect(messages.default.auto_search.range_label.trim().length).toBeGreaterThan(0)
  })

  test('English names the anchor explicitly', async () => {
    const messages = await import('../../../src/i18n/locales/en.json')
    expect(messages.default.auto_search.range_label).toBe('Search distance from the world centre (blocks)')
  })
})
