// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — fights.tackled (the TACKLED floater tag shown on a denied move). The 6-locale law
// (CLAUDE.md): every user-facing string lands in ALL locales. The fight adapter renders
// i18n.t('fights.tackled') on the player's own denied move; a locale missing the key would print the raw
// "fights.tackled" string on that board. This pins presence + non-emptiness across all six, mechanically.

import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('i18n · fights.tackled present in ALL 6 locales', () => {
  test.each(LOCALES)('%s.json carries a non-empty fights.tackled', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(typeof json?.fights?.tackled).toBe('string')
    expect(json.fights.tackled.trim().length).toBeGreaterThan(0)
  })
})
