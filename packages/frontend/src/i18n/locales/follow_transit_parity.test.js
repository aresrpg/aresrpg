// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #509: every party transit status shown beside a follower exists in all six shipped locales.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['follow_joining', 'follow_in_transit', 'follow_arrived', 'follow_background']

describe('i18n · party follow-transit strings are complete in all six locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty party.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.party?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }
})
