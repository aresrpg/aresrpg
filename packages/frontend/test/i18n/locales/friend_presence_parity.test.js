// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — the friends panel's presence copy, in all six locales (the 6-locale law). It also pins
// the RETIREMENT of `presence.no_online_friends` and `friends.offline`: those strings named an authority
// verdict the panel cannot hold, so the words themselves are the violation and their absence is the fix.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['none_seen', 'not_seen', 'hint_seen', 'hint_recent', 'hint_unseen']

const locale = (lang) => Bun.file(new URL(`../../../src/i18n/locales/${lang}.json`, import.meta.url)).json()

describe('i18n · friends-panel observation copy present + non-empty in ALL 6 locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty presence.${key}`, async (lang) => {
      const value = (await locale(lang))?.presence?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  test.each(LOCALES)('%s.json states no online/offline verdict for a friend', async (lang) => {
    const json = await locale(lang)
    expect(json?.presence?.no_online_friends).toBeUndefined()
    expect(json?.friends?.offline).toBeUndefined()
  })
})
