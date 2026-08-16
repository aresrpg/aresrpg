// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { normalize_pathname, page_from_pathname, pathname_for_page } from '../../src/modules/navigation.ts'

describe('app navigation routes', () => {
  test('maps browser paths to reducer-owned pages', () => {
    expect(page_from_pathname('/')).toBe('world')
    expect(page_from_pathname('/encyclopedia')).toBe('encyclopedia')
    expect(page_from_pathname('/encyclopedia/items/aberrant_edge')).toBe('encyclopedia')
    expect(page_from_pathname('/not-a-page')).toBe('world')
  })

  test('maps reducer pages to canonical browser paths', () => {
    expect(pathname_for_page('world')).toBe('/')
    expect(pathname_for_page('encyclopedia')).toBe('/encyclopedia/items')
    expect(normalize_pathname('/encyclopedia/items/aberrant_edge/')).toBe('/encyclopedia/items/aberrant_edge')
  })

  test('folds sidebar and browser navigation through the same reducer', () => {
    const state = initial_app_state(Object.freeze({ quality: 'medium', flat_mode: false }))
    const opened = reduce_app_state(state, { type: 'page/open', page: 'encyclopedia' })
    const selected = reduce_app_state(opened, { type: 'path/open', pathname: '/encyclopedia/items/aberrant_edge' })
    const returned = reduce_app_state(selected, { type: 'route/changed', pathname: '/' })

    expect(opened.navigation.page).toBe('encyclopedia')
    expect(opened.navigation.pathname).toBe('/encyclopedia/items')
    expect(selected.navigation.pathname).toBe('/encyclopedia/items/aberrant_edge')
    expect(returned.navigation.page).toBe('world')
  })
})
