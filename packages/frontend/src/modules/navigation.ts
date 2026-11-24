// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ServerPacket } from '@aresrpg/protocol'

import { agent_tab_source } from '../agents/character_tabs.ts'
import type { DetailTab } from '../characters/character_navigation.ts'
import { is_admin_address } from '../admin_access.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export const pages = ['world', 'mastery', 'kolizeum', 'settings', 'admin'] as const

export type Page = (typeof pages)[number]
export type AppDialog =
  | 'welcome'
  | 'character_create'
  | 'travel'
  | 'leave_game'
  | 'world_map'
  | `character_${DetailTab}`
  | `mob:${string}`
  | `fight:${string}`

export type NavigationState = Readonly<{
  page: Page
  pathname: string
  dialog: AppDialog | null
}>

export type NavigationInput =
  | Readonly<{ type: 'page/open'; page: Page }>
  | Readonly<{ type: 'path/open'; pathname: string }>
  | Readonly<{ type: 'dialog/open'; dialog: AppDialog | null }>
  | Readonly<{ type: 'auth/rejected'; error: string }>
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>

export const initial_navigation_state = (): NavigationState =>
  Object.freeze({ page: 'world', pathname: '/world', dialog: null })

export const normalize_pathname = (pathname: string): string => {
  const normalized = `/${pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean).join('/') ?? ''}`
  return normalized === '' ? '/' : normalized
}

/** The game's document serves every address under this prefix. A game page's own path follows it. */
const GAME_ROOT = '/world'
/** The browser address of a game path: `/kolizeum/wagered` is `/world/kolizeum/wagered`; the world is the root itself. */
export const game_address = (pathname: string): string =>
  pathname === GAME_ROOT ? GAME_ROOT : `${GAME_ROOT}${pathname}`
/** The game path of a browser address. An address outside the game's prefix is the world. */
export const game_pathname = (address: string): string => {
  const normalized = normalize_pathname(address)
  return normalized.startsWith(`${GAME_ROOT}/`) ? normalized.slice(GAME_ROOT.length) : GAME_ROOT
}

export const page_from_pathname = (pathname: string): Page => {
  const [segment = ''] = normalize_pathname(pathname).split('/').filter(Boolean)
  return pages.find((page) => page === segment) ?? 'world'
}

/** Every page of the game has its own address; the game itself is `/world`, never the site's root. */
export const pathname_for_page = (page: Page): string => `/${page}`

export const is_world_page = (page: Page): boolean => page === 'world'

const open_page = (state: AppState, page: Page): AppState => {
  if (page === 'admin' && !is_admin_address(state.session.wallet?.address ?? null)) return state
  return Object.freeze({
    ...state,
    navigation: Object.freeze({ ...state.navigation, page, pathname: pathname_for_page(page) }),
  })
}

const open_path = (state: AppState, requested_pathname: string): AppState => {
  const pathname = normalize_pathname(requested_pathname)
  const page = page_from_pathname(pathname)
  if (page === 'admin' && !is_admin_address(state.session.wallet?.address ?? null))
    return Object.freeze({
      ...state,
      navigation: Object.freeze({ ...state.navigation, page: 'world', pathname: pathname_for_page('world') }),
    })
  return Object.freeze({
    ...state,
    navigation: Object.freeze({ ...state.navigation, page, pathname }),
  })
}

const open_dialog = (state: AppState, dialog: AppDialog | null): AppState => {
  const host = dialog === 'character_create' ? open_page(state, 'world') : state
  return Object.freeze({ ...host, navigation: Object.freeze({ ...host.navigation, dialog }) })
}

const return_from_kolizeum_fight = (
  state: AppState,
  input: Extract<AppInput, { type: 'fight_result/checkpoint' }>
): AppState => {
  const selected = input.character_id === state.session.selected_character_id
  const managed = state.fight.kolizeum_by_fight[input.checkpoint.contract.id] !== undefined
  return selected && input.checkpoint.contract.ended && managed ? open_page(state, 'world') : state
}

const arrived_fight = (state: AppState, reason: string): AppState => {
  const { run } = state.run_to
  if (reason !== 'arrived' || run?.source !== 'fight' || !state.world.fights[run.fight_id]) return state
  return open_dialog(state, `fight:${run.fight_id}`)
}

const roster_navigation = (state: AppState, has_agent_characters: boolean): AppState => {
  if (state.session.characters.length === 0 && !has_agent_characters) return open_dialog(state, 'welcome')
  // Roster updates also carry equipment changes; only roster onboarding owns automatic dismissal.
  return state.navigation.dialog === 'welcome' ? open_dialog(state, null) : state
}

const packet_navigation = (state: AppState, packet: Readonly<ServerPacket>): AppState => {
  if (state.session.agent_view.request) return state
  const has_agent_characters = agent_tab_source(state.session).characters.length > 0
  if (has_agent_characters && state.navigation.dialog === 'welcome') return open_dialog(state, null)
  if (packet.type === 'packet/characters') return roster_navigation(state, has_agent_characters)
  if (
    packet.type === 'packet/fight_phase' &&
    packet.phase === 'ended' &&
    state.navigation.dialog === `fight:${packet.fight}`
  )
    return open_dialog(state, null)
  return state
}

const reduce_window = (state: AppState, input: AppInput): AppState | null => {
  switch (input.type) {
    case 'dialog/open':
      return open_dialog(state, input.dialog)
    default:
      return null
  }
}

type RouteInput = Extract<AppInput, { type: 'page/open' | 'path/open' | 'location/changed' }>
const NAVIGATION_TRANSFORMS: { [Input in RouteInput as Input['type']]: (state: AppState, input: Input) => AppState } = {
  'page/open': (state, input) => open_page(state, input.page),
  'path/open': (state, input) => open_path(state, input.pathname),
  // The address bar moved (back, forward): the page follows it.
  'location/changed': (state, input) => open_path(state, game_pathname(input.location.pathname)),
}

const reduce_observed_navigation = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'agent/watch') return { ...state, navigation: initial_navigation_state() }
  return state
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (state.session.agent_view.request) return reduce_observed_navigation(state, input)
  if (input.type === 'run_to/stopped') return arrived_fight(state, input.reason)
  if (input.type === 'fight_result/checkpoint') return return_from_kolizeum_fight(state, input)
  const navigate = NAVIGATION_TRANSFORMS[input.type as RouteInput['type']]
  if (navigate) return navigate(state, input as never)
  const window = reduce_window(state, input)
  if (window) return window
  if (input.type === 'auth/rejected' || input.type === 'auth/disconnected')
    return Object.freeze({ ...state, navigation: initial_navigation_state() })
  if (input.type === 'server/packet') return packet_navigation(state, input.packet)
  return state
}

const observe = ({ dispatch, events, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let initial_route_read = false
  let initial_route_scheduled = false
  const read_route = (): void => dispatch({ type: 'path/open', pathname: game_pathname(get_state().location.pathname) })
  const schedule_initial_route = (): void => {
    if (initial_route_read || initial_route_scheduled || signal.aborted) return
    initial_route_scheduled = true
    globalThis.queueMicrotask(() => {
      initial_route_scheduled = false
      if (initial_route_read || signal.aborted) return
      const { wallets, sign_in } = get_state().session
      if (wallets === null || sign_in.status === 'connecting') return
      initial_route_read = true
      read_route()
    })
  }
  events.on('STATE_UPDATED', (state, previous) => {
    schedule_initial_route()
    if (state.fight.mounted && !previous.fight.mounted && state.navigation.page === 'kolizeum') {
      dispatch({ type: 'page/open', page: 'world' })
      return
    }
    const next_pathname = state.navigation.pathname
    if (next_pathname === previous.navigation.pathname || game_pathname(state.location.pathname) === next_pathname)
      return
    dispatch({ type: 'location/open', href: game_address(next_pathname) })
  })
  schedule_initial_route()
}

export default Object.freeze({
  name: 'navigation',
  initial: () => ({ navigation: initial_navigation_state() }),
  reduce,
  observe,
}) satisfies AppModule
