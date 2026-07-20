// i18n PARITY GUARD — the FRONTEND MICRO-BUNDLE strings (navbar legend · auto-follow CTA ·
// 16:14 dungeon-key deep-link). The 6-locale law (CLAUDE.md): every user-facing string lands in ALL locales;
// a missing/empty locale would print the raw key (or drop the Trans <link> slot). This pins presence +
// non-emptiness across all six, mechanically. The sidebar hints did not exist at HEAD → this was RED for them.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

// [namespace, key] pairs added or changed by this bundle.
const KEYS = [
  ['sidebar', 'hint_lock_cursor'], // ③ navbar legend (new)
  ['sidebar', 'hint_cinematic'], //   ③ navbar legend (new)
  ['party', 'invite_owned_cta'], //   ④ "auto follow" CTA (copy changed)
  ['dungeons', 'need_key'], //        ② dungeon-key deep-link sentence (Trans <link> slot)
]

describe('i18n · micro-bundle strings present in ALL 6 locales', () => {
  for (const [ns, key] of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty ${ns}.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.[ns]?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  // The need_key Trans slot MUST keep its <link> wrapper + {{key}} interpolation in every locale, or the key
  // name stops being clickable (or the placeholder prints raw). Pins the structural contract across all six.
  test.each(LOCALES)('%s.json dungeons.need_key wraps {{key}} in the <link> slot', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(json.dungeons.need_key).toContain('<link>{{key}}</link>')
  })
})
