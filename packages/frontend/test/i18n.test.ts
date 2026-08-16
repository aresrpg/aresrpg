// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { parse } from 'yaml'

const LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'uk'] as const
const load = (locale: (typeof LOCALES)[number]): Record<string, string> =>
  parse(readFileSync(new URL(`../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8'), { uniqueKeys: true })

describe('interface copy', () => {
  test('every locale parses uniquely and carries the same keys', () => {
    const english_keys = Object.keys(load('en')).sort()
    LOCALES.forEach((locale) => expect(Object.keys(load(locale)).sort()).toEqual(english_keys))
  })

  test('the loading state names the universe rather than an invented connection step', () => {
    expect(load('en').loading_universe).toBe('Loading the universe')
    expect(load('en')).not.toHaveProperty('connecting')
  })

  test('item descriptions remain inside the six locale documents', () => {
    const english = load('en') as unknown as {
      encyclopedia_page: { item_descriptions: Record<string, string> }
    }
    const french = load('fr') as unknown as {
      encyclopedia_page: { item_descriptions: Record<string, string> }
    }
    expect(english.encyclopedia_page.item_descriptions.aberrant_edge).toStartWith('Forged wrong.')
    expect(french.encyclopedia_page.item_descriptions.aberrant_edge).toStartWith('Forgée de travers.')
  })
})
