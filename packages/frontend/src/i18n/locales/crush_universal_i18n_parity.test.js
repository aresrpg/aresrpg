// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — the universal-crush bundle (issue #270 "restated ruling": crushing is universal;
// a zero-rune item's confirm dialog + result toast reframe as an honest destroy instead of the rune-yield
// copy). The 6-locale law (CLAUDE.md): every user-facing string lands in ALL locales; a missing/empty locale
// would print the raw key in the confirm modal or the result toast. This pins presence + non-emptiness across
// all six, mechanically. See crush_menu.tsx's crush_line_key / crush_success_key.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

// [namespace, key] pairs added by this bundle.
const KEYS = [
  ['crush', 'destroy_line'], // the confirm headline for a definitive zero-yield item
  ['crush', 'success_destroyed'], // the result toast for a definitive zero-yield item
]

describe('i18n · universal-crush honest-destroy strings present in ALL 6 locales', () => {
  for (const [ns, key] of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty ${ns}.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.[ns]?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  // The destroy headline MUST keep the {{item}} interpolation slot in every locale, or the item's name drops
  // out of the confirm dialog (mirrors crush.line's own {{item}} slot).
  test.each(LOCALES)('%s.json crush.destroy_line interpolates {{item}}', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(json.crush.destroy_line).toContain('{{item}}')
  })
})
