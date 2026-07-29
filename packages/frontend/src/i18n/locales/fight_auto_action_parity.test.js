// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const AUTO_ACTION_KEYS = ['auto_pass_fired', 'auto_crank_fired', 'auto_force_start_fired']

describe('i18n · automatic fight actions speak in all six locales', () => {
  for (const key of AUTO_ACTION_KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty dungeons.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.dungeons?.[key]

      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }
})
