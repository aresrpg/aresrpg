// i18n PARITY GUARD — the fast_travel.* bundle (dragon fast-travel: the third player-menu option, the
// realm-unreachable refusal, and the flight-lifecycle toasts). The 6-locale law (CLAUDE.md): every
// user-facing string lands in ALL locales; a missing/empty locale would print the raw key. This pins presence
// + non-emptiness across all six, mechanically. Every key was RED before the feature landed.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['option', 'realm_unreachable', 'flying', 'cancelled', 'target_lost', 'arrived']

describe('i18n · fast_travel.* present + non-empty in ALL 6 locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty fast_travel.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.fast_travel?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }
})
