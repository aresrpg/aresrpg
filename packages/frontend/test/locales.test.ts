// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'
import { item_categories, job_slugs, stat_names } from '@aresrpg/immutable'

import { LOCALES as locale_options } from '../src/i18n/locale.ts'
import { load_app_copy } from '../src/i18n/copy.ts'
import spells from '../../../seed/content/spells.json'

const LOCALES = locale_options.map(({ code }) => code)
const documents = await Promise.all(LOCALES.map(load_app_copy))
const en = documents[0]!
const fr = documents[1]!

/// The raw document, parsed with duplicate keys refused — the build's yaml
/// import silently keeps the last of a duplicated pair.
const raw = (locale: (typeof LOCALES)[number]): Record<string, unknown> =>
  parse(readFileSync(new URL(`../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8'), { uniqueKeys: true })

const leaf_paths = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => leaf_paths(child, prefix ? `${prefix}.${key}` : key))
    : [prefix]

test('all ten authored locale documents parse uniquely and carry the same keys, to the leaf', () => {
  LOCALES.forEach((locale) => expect(() => raw(locale)).not.toThrow())

  const expected = [...leaf_paths(en)].sort()
  for (const document of documents.slice(1)) expect([...leaf_paths(document)].sort()).toEqual(expected)
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
  const description_documents = documents as unknown as readonly {
    encyclopedia_page: { item_descriptions: Record<string, string> }
  }[]
  for (const locale of description_documents) {
    expect(locale.encyclopedia_page.item_descriptions.scroll_of_oblivion).not.toBe('')
    expect(locale.encyclopedia_page.item_descriptions.scroll_of_rebirth).not.toBe('')
  }
  expect(english.encyclopedia_page.item_descriptions).not.toHaveProperty('aberrant_edge')
})

test('every spell identity has one localized display name in all ten locales', () => {
  const identities = spells.map(({ name }) => name).toSorted()
  for (const document of documents) {
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

test('all supported locales cover shared item, stat, profession and equipment-slot vocabulary', () => {
  expect(LOCALES).toEqual(['en', 'fr', 'es', 'de', 'uk', 'ja', 'zh', 'ru', 'vi', 'ko'])
  for (const document of documents) {
    for (const category of [...item_categories, 'weapon', 'tool', 'relic_slot'])
      expect(document.item_categories[category]?.trim()).not.toBeFalsy()
    for (const stat of stat_names) expect(document.simulator_page[`stat_${stat}`]?.trim()).not.toBeFalsy()
    for (const job of job_slugs) expect(document.leaderboard_page[`job_${job}`]?.trim()).not.toBeFalsy()
  }
})

test('translations retain interpolation variables, including single-brace combat templates', () => {
  const tokens = (value: unknown): readonly string[] =>
    typeof value === 'string' ? [...value.matchAll(/\{\{?([^{}]+)\}\}?/g)].map((match) => match[1]!).toSorted() : []
  const compare = (reference: unknown, translated: unknown): void => {
    if (typeof reference === 'object' && reference !== null) {
      for (const [key, value] of Object.entries(reference)) compare(value, (translated as Record<string, unknown>)[key])
    } else expect(tokens(translated)).toEqual(tokens(reference))
  }
  for (const document of documents.slice(1)) compare(en, document)
})

test('all generated effect and area identities have translated player prose', async () => {
  const { EFFECT_KINDS, AREA_SHAPES, TARGET_FILTERS } = await import('@aresrpg/fight/move_contract')
  const keys = [
    ...Object.keys(EFFECT_KINDS),
    ...Object.keys(AREA_SHAPES).map((shape) => `shape_${shape}`),
    ...Object.keys(TARGET_FILTERS)
      .filter((target) => target !== 'none')
      .map((target) => `target_${target}`),
  ]
  for (const document of documents)
    for (const key of keys) expect(document.spell_effects[key]?.trim(), key).not.toBeFalsy()
})
