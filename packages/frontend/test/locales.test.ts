// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'

import de from '../src/i18n/locales/de.yaml'
import en from '../src/i18n/locales/en.yaml'
import es from '../src/i18n/locales/es.yaml'
import fr from '../src/i18n/locales/fr.yaml'
import ja from '../src/i18n/locales/ja.yaml'
import uk from '../src/i18n/locales/uk.yaml'
import spells from '../../../seed/content/spells.json'

const LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'uk'] as const

/// The raw document, parsed with duplicate keys refused — the build's yaml
/// import silently keeps the last of a duplicated pair.
const raw = (locale: (typeof LOCALES)[number]): Record<string, unknown> =>
  parse(readFileSync(new URL(`../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8'), { uniqueKeys: true })

const leaf_paths = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => leaf_paths(child, prefix ? `${prefix}.${key}` : key))
    : [prefix]

test('all six authored locale documents parse uniquely and carry the same keys, to the leaf', () => {
  LOCALES.forEach((locale) => expect(() => raw(locale)).not.toThrow())

  const expected = [...leaf_paths(en)].sort()
  for (const document of [de, es, fr, ja, uk]) expect([...leaf_paths(document)].sort()).toEqual(expected)
})

test('authored copy names the universe and keeps item descriptions inside the locale documents', () => {
  const english = en as unknown as {
    loading_universe: string
    encyclopedia_page: { item_descriptions: Record<string, string> }
  }
  const french = fr as unknown as {
    encyclopedia_page: { item_descriptions: Record<string, string> }
  }

  expect(english.loading_universe).toBe('Loading the universe')
  expect(en).not.toHaveProperty('connecting')
  expect(english.encyclopedia_page.item_descriptions.water).toBe('')
  expect(french.encyclopedia_page.item_descriptions.water).toBe('')
  const description_documents = [de, en, es, fr, ja, uk] as unknown as readonly {
    encyclopedia_page: { item_descriptions: Record<string, string> }
  }[]
  for (const locale of description_documents) {
    expect(locale.encyclopedia_page.item_descriptions.scroll_of_oblivion).not.toBe('')
    expect(locale.encyclopedia_page.item_descriptions.scroll_of_rebirth).not.toBe('')
  }
  expect(english.encyclopedia_page.item_descriptions).not.toHaveProperty('aberrant_edge')
})

test('every spell identity has one localized display name in all six locales', () => {
  const identities = spells.map(({ name }) => name).toSorted()
  for (const document of [de, en, es, fr, ja, uk]) {
    const names = (document as unknown as { spell_names: Record<string, string> }).spell_names
    expect(Object.keys(names).toSorted()).toEqual(identities)
    expect(Object.values(names).every((name) => name.trim().length > 0)).toBeTrue()
  }

  expect((en as unknown as { spell_names: Record<string, string> }).spell_names["Senshi's Wrath"]).toBe(
    "Senshi's Wrath"
  )
  expect((fr as unknown as { spell_names: Record<string, string> }).spell_names["Senshi's Wrath"]).toBe(
    'Colère du Senshi'
  )
})
