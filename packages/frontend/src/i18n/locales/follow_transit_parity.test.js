// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #509/#613: every follower-row state shown beside a party member exists in all six shipped locales
// (the ARRIVING legs, the with_you label, the background modifier, and the blocked fight-result state).
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = [
  'follow_joining',
  'follow_in_transit',
  'follow_with_you',
  'follow_background',
  'follow_blocked_fight_result',
  'follow_open_result_cta',
]

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
