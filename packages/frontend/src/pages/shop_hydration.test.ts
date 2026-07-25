// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, mock, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'

// MISSING-ARTIFACT (#117): scripts/lib/item_catalog_transform.mjs is content-pipeline tooling, absent by
// design in this public repo. shop_hydration_metadata's own tests all pass explicit template lists (never
// read the mocked catalog directly), so an empty fallback keeps them genuine — only a real-catalog-dependent
// consumer would need a skip, and none exists in this file.
const TRANSFORM_PATH = fileURLToPath(new URL('../../../../scripts/lib/item_catalog_transform.mjs', import.meta.url))
const { catalog, slugs } = existsSync(TRANSFORM_PATH)
  ? (await import('../../../../scripts/lib/item_catalog_transform.mjs')).build_item_catalog()
  : { catalog: {}, slugs: {} }
mock.module('virtual:item_catalog', () => ({ catalog, slugs }))

reset_auth_mock()
const window_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  writable: true,
  value: Object.assign(new EventTarget(), {
    location: { href: 'http://localhost/', origin: 'http://localhost', search: '' },
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  }),
})

const { shop_hydration_metadata } = await import('./shop')
if (window_descriptor) Object.defineProperty(globalThis, 'window', window_descriptor)
else delete (globalThis as { window?: unknown }).window

describe('shop optimistic purchase hydration', () => {
  test('joins a generic sale item_type by template name and carries the exact template object id', () => {
    expect(
      shop_hydration_metadata({ item_template_id: 'relic', template_id: '0xexact-template', name: 'Storm Chronicle' }, [
        { id: 'other_item', name: 'Other Item', level: 1 },
        { id: 'storm_chronicle', name: 'Storm Chronicle', level: 37 },
      ])
    ).toEqual({ item_type: 'relic', template_id: '0xexact-template', level: 37 })
  })

  test('prefers an exact authored id and refuses an ambiguous name-only level', () => {
    const templates = [
      { id: 'wrong_twin', name: 'Twin Relic', level: 98 },
      { id: 'exact_twin', name: 'Twin Relic', level: 100 },
    ]
    expect(
      shop_hydration_metadata({ item_template_id: 'exact_twin', template_id: '0x100', name: 'Twin Relic' }, templates)
        .level
    ).toBe(100)
    expect(
      shop_hydration_metadata({ item_template_id: 'relic', template_id: '0xunknown', name: 'Twin Relic' }, templates)
        .level
    ).toBe(1)
  })

  // #856: the templates handed in are now the PUBLISHED corpus (pages/encyclopedia/item_corpus.ts), whose
  // rows are keyed by the on-chain template OBJECT id and carry the authored art slug as `item_type`. The
  // bundled seed catalog this page used to read is `{}` by construction, so every purchase painted the
  // level-1 default; a corpus row must join on either key.
  test('joins a published corpus row by its template object id, and by its art slug', () => {
    const corpus = [
      { id: '0xstorm', item_type: 'storm_chronicle', name: 'Storm Chronicle', level: 37 },
      { id: '0xother', item_type: 'other_relic', name: 'Other Relic', level: 4 },
    ]
    expect(
      shop_hydration_metadata({ item_template_id: 'relic', template_id: '0xstorm', name: 'Storm Chronicle' }, corpus)
    ).toEqual({ item_type: 'relic', template_id: '0xstorm', level: 37 })
    expect(
      shop_hydration_metadata(
        { item_template_id: 'storm_chronicle', template_id: '0xunindexed', name: 'Renamed On Chain' },
        corpus
      ).level
    ).toBe(37)
  })

  test('uses the shop seed default level when a cosmetic is absent from the local item corpus', () => {
    expect(
      shop_hydration_metadata({ item_template_id: 'cloak', template_id: '0xcosmetic', name: 'Shop-only Cloak' }, [])
    ).toEqual({ item_type: 'cloak', template_id: '0xcosmetic', level: 1 })
  })
})
