// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LAZY-LOCALE proof — the active-locale-only loader. Boot statically bundles EN only; every other
// language's main translation bundle AND item-description catalog are code-split and loaded on demand
// (index.ts wires load_locale to the initial + every subsequent `languageChanged`). This pins that
// contract at runtime: load_locale registers ONLY the requested language, resolves real translated
// strings for BOTH namespaces, and a second call (a user switching languages) adds the new one without
// disturbing the first. Uses the default i18next singleton (the one load_locale mutates), inited EN-only
// exactly like index.ts minus the browser LanguageDetector (which can't run headless).
import { test, expect, beforeAll } from 'bun:test'
import i18n from 'i18next'

import en from './locales/en.json'
import { load_locale, ITEM_DESC_NS } from './lazy_locale'

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  })
})

test('boot bundles EN only — no other language is present before a load', () => {
  for (const lng of ['fr', 'de', 'es', 'ja', 'uk']) {
    expect(i18n.hasResourceBundle(lng, 'translation')).toBe(false)
    expect(i18n.hasResourceBundle(lng, ITEM_DESC_NS)).toBe(false)
  }
})

test('load_locale("fr") registers ONLY fr (translation + item_desc) with real strings', async () => {
  await load_locale('fr')

  expect(i18n.hasResourceBundle('fr', 'translation')).toBe(true)
  expect(i18n.hasResourceBundle('fr', ITEM_DESC_NS)).toBe(true)
  // real French copy resolves from BOTH namespaces
  expect(i18n.getResource('fr', 'translation', 'discovery.zone_revealed')).toBe('Zone révélée')
  expect(i18n.getResource('fr', ITEM_DESC_NS, 'aberrant_edge')).toContain("L'acier plie")

  // active-locale-only: loading fr must not have pulled any other language
  for (const lng of ['de', 'es', 'ja', 'uk']) expect(i18n.hasResourceBundle(lng, 'translation')).toBe(false)
})

test('switching language (load_locale("de")) adds de and keeps fr — the on-switch path', async () => {
  await load_locale('de')

  expect(i18n.hasResourceBundle('de', 'translation')).toBe(true)
  expect(i18n.getResource('de', 'translation', 'discovery.zone_revealed')).toBe('Zone aufgedeckt')
  expect(i18n.getResource('de', ITEM_DESC_NS, 'aberrant_edge')).toContain('Falsch geschmiedet')
  // fr from the previous load is untouched
  expect(i18n.getResource('fr', 'translation', 'discovery.zone_revealed')).toBe('Zone révélée')
})

test('load_locale("en") is a no-op — EN is the static fallback, needs no lazy chunk', async () => {
  const before = ['fr', 'de', 'es', 'ja', 'uk'].map((l) => i18n.hasResourceBundle(l, 'translation'))
  await expect(load_locale('en')).resolves.toBeUndefined()
  const after = ['fr', 'de', 'es', 'ja', 'uk'].map((l) => i18n.hasResourceBundle(l, 'translation'))
  expect(after).toEqual(before)
})
