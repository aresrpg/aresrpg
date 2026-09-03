// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'
import navigation, {
  normalize_pathname,
  page_from_pathname,
  pathname_for_page,
  world_scene_active,
} from '../../src/modules/navigation.ts'

describe('app navigation routes', () => {
  test('maps browser paths to reducer-owned pages', () => {
    expect(page_from_pathname('/')).toBe('world')
    expect(page_from_pathname('/encyclopedia')).toBe('encyclopedia')
    expect(page_from_pathname('/encyclopedia/items/aberrant_edge')).toBe('encyclopedia')
    expect(page_from_pathname('/gift')).toBe('airdrop')
    expect(page_from_pathname('/simulator')).toBe('world')
    expect(page_from_pathname('/not-a-page')).toBe('world')
  })

  test('maps reducer pages to canonical browser paths', () => {
    expect(pathname_for_page('world')).toBe('/')
    expect(pathname_for_page('encyclopedia')).toBe('/encyclopedia/items')
    expect(normalize_pathname('/encyclopedia/items/aberrant_edge/')).toBe('/encyclopedia/items/aberrant_edge')
  })

  test('logout keeps a pending printed gift on its Google-first route', () => {
    const base = initial_app_state(
      Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    )
    const state = Object.freeze({
      ...base,
      navigation: Object.freeze({ ...base.navigation, page: 'airdrop' as const, pathname: '/gift' }),
      distribution: Object.freeze({ ...base.distribution, gift_link_ready: true }),
    })

    expect(reduce_app_state(state, { type: 'auth/disconnected' }).navigation).toMatchObject({
      page: 'airdrop',
      pathname: '/gift',
    })
  })

  test('keeps the world scene running for a mounted Kolizeum board', () => {
    expect(world_scene_active('world', false)).toBeTrue()
    expect(world_scene_active('kolizeum', false)).toBeFalse()
    expect(world_scene_active('kolizeum', true)).toBeTrue()
    expect(world_scene_active('characters', true)).toBeFalse()
  })

  test('returns a terminal Kolizeum fighter to World for the result card', () => {
    const base = initial_app_state(
      Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    )
    const state = {
      ...base,
      navigation: { ...base.navigation, page: 'kolizeum' as const, pathname: '/kolizeum' },
      session: { ...base.session, selected_character_id: '0xcharacter' },
      fight: {
        ...base.fight,
        kolizeum_by_fight: { '0xfight': { id: '0xkolizeum', pledge_mist: 200_000_000n } },
      },
    }
    const returned = navigation.reduce!(
      state as AppState,
      {
        type: 'fight_result/checkpoint',
        character_id: '0xcharacter',
        checkpoint: { contract: { id: '0xfight', ended: true } },
      } as never
    )

    expect(returned.navigation).toMatchObject({ page: 'world', pathname: '/' })
  })

  test('folds sidebar and browser navigation through the same reducer', () => {
    const state = initial_app_state(
      Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    )
    const creating = reduce_app_state(state, { type: 'dialog/open', dialog: 'character_create' })
    const opened = reduce_app_state(creating, { type: 'page/open', page: 'encyclopedia' })
    const selected = reduce_app_state(opened, { type: 'path/open', pathname: '/encyclopedia/items/aberrant_edge' })
    const returned = reduce_app_state(selected, { type: 'route/changed', pathname: '/' })

    expect(opened.navigation.page).toBe('encyclopedia')
    expect(opened.navigation.pathname).toBe('/encyclopedia/items')
    expect(selected.navigation.pathname).toBe('/encyclopedia/items/aberrant_edge')
    expect(returned.navigation.page).toBe('world')
    expect(returned.navigation.dialog).toBe('character_create')
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
