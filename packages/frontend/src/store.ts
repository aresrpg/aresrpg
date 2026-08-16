// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { GameSettings } from './game/core/settings.ts'
import engine, { initial_engine_state, type EngineInput, type EngineState } from './modules/engine.ts'
import fight, { initial_fight_session_state, type FightSessionInput, type FightSessionState } from './modules/fight.ts'
import type { Locale } from './i18n/locale.ts'
import type { AppCopy } from './i18n/copy.ts'
import admin, { initial_admin_state, type AdminInput, type AdminState } from './modules/admin.ts'
import locale, { type LocaleInput } from './modules/locale.ts'
import navigation, {
  initial_navigation_state,
  type NavigationInput,
  type NavigationState,
} from './modules/navigation.ts'
import session, { initial_session_state, type SessionInput, type SessionState } from './modules/session.ts'
import simulator, { initial_simulator_state, type SimulatorInput, type SimulatorState } from './modules/simulator.ts'
import settings, { type SettingsInput } from './modules/settings.ts'

export type AppState = Readonly<{
  session: SessionState
  navigation: NavigationState
  settings: GameSettings
  locale: Locale
  engine: EngineState
  fight: FightSessionState
  copy: AppCopy | null
  simulator: SimulatorState
  admin: AdminState
}>

export type AppInput =
  | SessionInput
  | NavigationInput
  | SettingsInput
  | LocaleInput
  | EngineInput
  | SimulatorInput
  | FightSessionInput
  | AdminInput

type EventArguments = {
  [K in AppInput['type']]: [Extract<AppInput, { type: K }>]
} & { STATE_UPDATED: [AppState, AppState] }

export type AppEvents = Readonly<{
  on: <K extends keyof EventArguments>(name: K, listener: (...arguments_: EventArguments[K]) => void) => void
}>

export type AppContext = Readonly<{
  events: AppEvents
  signal: AbortSignal
  get_state: () => AppState
  dispatch: (input: AppInput) => void
}>

export type AppModule = Readonly<{
  name: string
  reduce?: (state: AppState, input: AppInput) => AppState
  observe?: (context: AppContext) => void
}>

const MODULES: readonly AppModule[] = Object.freeze([
  session,
  navigation,
  settings,
  locale,
  engine,
  simulator,
  fight,
  admin,
])

export const initial_app_state = (settings_state: GameSettings): AppState =>
  Object.freeze({
    session: initial_session_state(),
    navigation: initial_navigation_state(),
    settings: settings_state,
    locale: 'en',
    engine: initial_engine_state(),
    fight: initial_fight_session_state(),
    copy: null,
    simulator: initial_simulator_state(),
    admin: initial_admin_state(),
  })

const create_events = () => {
  const listeners = new Map<keyof EventArguments, Set<(arguments_: readonly unknown[]) => void>>()
  return Object.freeze({
    api: Object.freeze({
      on: <K extends keyof EventArguments>(name: K, listener: (...arguments_: EventArguments[K]) => void): void => {
        const bucket = listeners.get(name) ?? new Set<(arguments_: readonly unknown[]) => void>()
        bucket.add((arguments_) => listener(...(arguments_ as EventArguments[K])))
        listeners.set(name, bucket)
      },
    }) satisfies AppEvents,
    emit: <K extends keyof EventArguments>(name: K, ...arguments_: EventArguments[K]): void => {
      for (const listener of listeners.get(name) ?? []) listener(arguments_)
    },
    clear: (): void => listeners.clear(),
  })
}

const create_app = () => {
  const default_settings = Object.freeze({ quality: 'medium', flat_mode: false }) satisfies GameSettings
  let state = initial_app_state(default_settings)
  let active_observers: AbortController | null = null
  const store = createStore<AppState>(() => state)
  const events = create_events()

  const dispatch = (input: AppInput): void => {
    const previous = state
    const next = reduce_app_state(previous, input)
    state = next
    if (next !== previous) store.setState(next, true)
    events.emit(input.type, input as never)
    if (next !== previous) events.emit('STATE_UPDATED', next, previous)
  }

  return Object.freeze({
    store,
    dispatch,
    initialize: (settings_state: GameSettings): void => {
      state = initial_app_state(settings_state)
      store.setState(state, true)
    },
    observe: (): (() => void) => {
      active_observers?.abort()
      events.clear()
      const controller = new AbortController()
      active_observers = controller
      const context: AppContext = Object.freeze({
        events: events.api,
        signal: controller.signal,
        get_state: () => state,
        dispatch,
      })
      for (const module of MODULES) module.observe?.(context)
      return () => {
        if (active_observers !== controller) return
        controller.abort()
        events.clear()
        active_observers = null
      }
    },
  })
}

export const reduce_app_state = (state: AppState, input: AppInput): AppState =>
  MODULES.reduce((folded, module) => (module.reduce ? module.reduce(folded, input) : folded), state)

const app = create_app()

export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(app.store, selector)
export const dispatch_app = app.dispatch
export const initialize_app_store = app.initialize
export const observe_app = app.observe
