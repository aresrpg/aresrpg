// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The strict-upgrade refusal is blocking, so raw/missing keys would strand an outdated client behind broken copy.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['upgrade_title', 'upgrade_body', 'upgrade_refresh']

describe('i18n · strict sponsor upgrade modal in all six locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty sponsor.${key}`, async (locale) => {
      const json = await Bun.file(new URL(`./${locale}.json`, import.meta.url)).json()
      const value = json?.sponsor?.[key]

      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  test('English copy explicitly says AresRPG was upgraded and asks for a refresh', async () => {
    const json = await Bun.file(new URL('./en.json', import.meta.url)).json()

    expect(`${json.sponsor.upgrade_title} ${json.sponsor.upgrade_body}`).toMatch(/AresRPG.*upgraded.*refresh/i)
  })
})
