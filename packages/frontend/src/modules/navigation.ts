// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ServerPacket } from '@aresrpg/protocol'

import { is_admin_address } from '../admin_access.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export const pages = [
  'world',
  'characters',
  'leaderboard',
  'shop',
  'simulator',
  'encyclopedia',
  'marketplace',
  'airdrop',
  'kolizeum',
  'settings',
  'admin',
] as const

export type Page = (typeof pages)[number]
export type AppDialog = 'welcome' | 'character_create'

export type NavigationState = Readonly<{
  page: Page
  pathname: string
  dialog: AppDialog | null
  guest_spectating: boolean
}>

export type NavigationInput =
  | Readonly<{ type: 'page/open'; page: Page }>
  | Readonly<{ type: 'path/open'; pathname: string }>
  | Readonly<{ type: 'route/changed'; pathname: string }>
  | Readonly<{ type: 'dialog/open'; dialog: AppDialog | null }>
  | Readonly<{ type: 'spectate/changed'; enabled: boolean }>
  | Readonly<{ type: 'auth/rejected'; error: string }>
  | Readonly<{ type: 'auth/disconnected' }>
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>

export const initial_navigation_state = (): NavigationState =>
  Object.freeze({ page: 'world', pathname: '/', dialog: null, guest_spectating: false })

export const normalize_pathname = (pathname: string): string => {
  const normalized = `/${pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean).join('/') ?? ''}`
  return normalized === '' ? '/' : normalized
}

export const page_from_pathname = (pathname: string): Page => {
  const [segment = ''] = normalize_pathname(pathname).split('/').filter(Boolean)
  return pages.find((page) => page === segment) ?? 'world'
}

export const pathname_for_page = (page: Page): string =>
  page === 'world' ? '/' : page === 'encyclopedia' ? '/encyclopedia/items' : `/${page}`

export const is_world_page = (page: Page): boolean => page === 'world'

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'page/open') {
    if (input.page === 'admin' && !is_admin_address(state.session.wallet?.address ?? null)) return state
    const pathname = pathname_for_page(input.page)
    return Object.freeze({
      ...state,
      navigation: Object.freeze({ ...state.navigation, page: input.page, pathname }),
    })
  }
  if (input.type === 'path/open' || input.type === 'route/changed') {
    const pathname = normalize_pathname(input.pathname)
    const page = page_from_pathname(pathname)
    if (page === 'admin' && !is_admin_address(state.session.wallet?.address ?? null))
      return Object.freeze({
        ...state,
        navigation: Object.freeze({ ...state.navigation, page: 'world', pathname: '/' }),
      })
    return Object.freeze({
      ...state,
      navigation: Object.freeze({ ...state.navigation, page, pathname }),
    })
  }
  if (input.type === 'dialog/open')
    return Object.freeze({ ...state, navigation: Object.freeze({ ...state.navigation, dialog: input.dialog }) })
  if (input.type === 'spectate/changed')
    return Object.freeze({
      ...state,
      navigation: Object.freeze({ ...state.navigation, guest_spectating: input.enabled }),
    })
  if (input.type === 'auth/rejected' || input.type === 'auth/disconnected')
    return Object.freeze({ ...state, navigation: initial_navigation_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/characters')
    return Object.freeze({
      ...state,
      navigation: Object.freeze({
        ...state.navigation,
        dialog: input.packet.characters.length === 0 ? 'welcome' : null,
      }),
    })
  return state
}

const observe = ({ dispatch, events, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  if (typeof globalThis.location === 'undefined' || typeof globalThis.history === 'undefined') return
  let initial_route_read = false
  let initial_route_scheduled = false
  const read_route = (): void => dispatch({ type: 'route/changed', pathname: globalThis.location.pathname })
  const schedule_initial_route = (): void => {
    if (initial_route_read || initial_route_scheduled || signal.aborted) return
    initial_route_scheduled = true
    globalThis.queueMicrotask(() => {
      initial_route_scheduled = false
      if (initial_route_read || signal.aborted) return
      const { auth_ready, auth_status } = get_state().session
      if (!auth_ready || auth_status === 'connecting') return
      initial_route_read = true
      read_route()
    })
  }
  events.on('STATE_UPDATED', (state, previous) => {
    schedule_initial_route()
    const next_pathname = state.navigation.pathname
    if (
      next_pathname === previous.navigation.pathname ||
      normalize_pathname(globalThis.location.pathname) === next_pathname
    )
      return
    globalThis.history.pushState(null, '', next_pathname)
  })
  globalThis.addEventListener('popstate', read_route, { signal })
  schedule_initial_route()
}

export default Object.freeze({ name: 'navigation', reduce, observe }) satisfies AppModule
