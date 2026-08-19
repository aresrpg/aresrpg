// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'
import navigation, { normalize_pathname, page_from_pathname, pathname_for_page } from '../../src/modules/navigation.ts'

describe('app navigation routes', () => {
  test('maps browser paths to reducer-owned pages', () => {
    expect(page_from_pathname('/')).toBe('world')
    expect(page_from_pathname('/encyclopedia')).toBe('encyclopedia')
    expect(page_from_pathname('/encyclopedia/items/aberrant_edge')).toBe('encyclopedia')
    expect(page_from_pathname('/simulator')).toBe('world')
    expect(page_from_pathname('/not-a-page')).toBe('world')
  })

  test('maps reducer pages to canonical browser paths', () => {
    expect(pathname_for_page('world')).toBe('/')
    expect(pathname_for_page('encyclopedia')).toBe('/encyclopedia/items')
    expect(normalize_pathname('/encyclopedia/items/aberrant_edge/')).toBe('/encyclopedia/items/aberrant_edge')
  })

  test('folds sidebar and browser navigation through the same reducer', () => {
    const state = initial_app_state(
      Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    )
    const opened = reduce_app_state(state, { type: 'page/open', page: 'encyclopedia' })
    const selected = reduce_app_state(opened, { type: 'path/open', pathname: '/encyclopedia/items/aberrant_edge' })
    const returned = reduce_app_state(selected, { type: 'route/changed', pathname: '/' })

    expect(opened.navigation.page).toBe('encyclopedia')
    expect(opened.navigation.pathname).toBe('/encyclopedia/items')
    expect(selected.navigation.pathname).toBe('/encyclopedia/items/aberrant_edge')
    expect(returned.navigation.page).toBe('world')
  })

  test('waits for remembered authentication before consuming the initial admin route', async () => {
    const location_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
    const history_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'history')
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/admin' } })
    Object.defineProperty(globalThis, 'history', { configurable: true, value: { pushState: () => undefined } })
    const controller = new AbortController()
    let state_listener: ((state: AppState, previous: AppState) => void) | undefined
    const dispatched: unknown[] = []
    let state = initial_app_state(
      Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    )
    try {
      navigation.observe?.({
        dispatch: (input) => dispatched.push(input),
        events: {
          on: (name, listener) => {
            if (name === 'STATE_UPDATED')
              state_listener = listener as unknown as (state: AppState, previous: AppState) => void
          },
        },
        get_state: () => state,
        signal: controller.signal,
      })
      await Promise.resolve()
      expect(dispatched).toEqual([])

      const previous = state
      state = Object.freeze({
        ...state,
        session: Object.freeze({
          ...state.session,
          auth_ready: true,
          auth_status: 'authenticated',
          wallet: Object.freeze({ address: DEFAULT_ADMIN_ADDRESS }) as never,
        }),
      })
      state_listener?.(state, previous)
      await Promise.resolve()

      expect(dispatched).toEqual([{ type: 'route/changed', pathname: '/admin' }])
    } finally {
      controller.abort()
      if (location_descriptor) Object.defineProperty(globalThis, 'location', location_descriptor)
      else Reflect.deleteProperty(globalThis, 'location')
      if (history_descriptor) Object.defineProperty(globalThis, 'history', history_descriptor)
      else Reflect.deleteProperty(globalThis, 'history')
    }
  })
})
