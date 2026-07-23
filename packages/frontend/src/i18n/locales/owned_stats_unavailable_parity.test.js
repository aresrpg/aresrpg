// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('i18n · owned stat unavailable state exists in all six locales', () => {
  test.each(LOCALES)('%s.json carries a non-empty stats.unavailable line', async (locale) => {
    const json = await Bun.file(new URL(`./${locale}.json`, import.meta.url)).json()
    expect(json.stats?.unavailable).toBeString()
    expect(json.stats.unavailable.trim().length).toBeGreaterThan(0)
  })
})
