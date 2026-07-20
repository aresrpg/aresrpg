// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'

import { build_item_catalog } from '../../../../scripts/lib/item_catalog_transform.mjs'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'

const { catalog, slugs } = build_item_catalog()
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

  test('uses the shop seed default level when a cosmetic is absent from the local item corpus', () => {
    expect(
      shop_hydration_metadata({ item_template_id: 'cloak', template_id: '0xcosmetic', name: 'Shop-only Cloak' }, [])
    ).toEqual({ item_type: 'cloak', template_id: '0xcosmetic', level: 1 })
  })
})
