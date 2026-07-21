// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('i18n · character-switch refusal reasons exist in all six locales', () => {
  test.each(LOCALES)('%s.json carries a non-empty errors.character_switch_in_progress', async (locale) => {
    const json = await Bun.file(new URL(`./${locale}.json`, import.meta.url)).json()
    const value = json?.errors?.character_switch_in_progress
    expect(typeof value).toBe('string')
    expect(value.trim().length).toBeGreaterThan(0)
  })
})
