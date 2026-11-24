// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one store: one queue of inputs, one event bus, one state. It knows no module: each entry starts it with
// its surface's list, and the state, the reducers and the observers are exactly that list's.
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { GameInput, GameState } from './game/game_modules.ts'
import type { SiteInput, SiteState } from './site_modules.ts'

export type { GameState, SiteState }
export type AppState = SiteState & GameState
export type AppInput = SiteInput | GameInput

type EventArguments<S> = {
  [K in AppInput['type']]: [Extract<AppInput, { type: K }>]
} & { STATE_UPDATED: [S, S] }

export type AppEvents<S = AppState> = Readonly<{
  on: <K extends keyof EventArguments<S>>(name: K, listener: (...arguments_: EventArguments<S>[K]) => void) => void
}>

/** What an observer works with: the bus, its lifetime, the state it may read and the one dispatch. */
export type ModuleContext<S> = Readonly<{
  events: AppEvents<S>
  signal: AbortSignal
  get_state: () => S
  dispatch: (input: AppInput) => void
  /** The surface plays the game, so a signed-in link takes the account's one seat. */
  seat: boolean
  /** An id no other request of this start has used: the server answers or fails a request by its id. */
  next_request_id: () => number
}>
export type AppContext = ModuleContext<AppState>
export type SiteContext = ModuleContext<SiteState>

/** A module of the game. `initial` gives its own slices when the store starts. */
export type AppModule = Readonly<{
  name: string
  initial?: () => Partial<AppState>
  reduce?: (state: AppState, input: AppInput) => AppState
  observe?: (context: AppContext) => void
}>

/** A module the site runs. It reads the site's slices only and returns every other slice as it found it. */
export type SiteModule = Readonly<{
  name: string
  initial?: () => Partial<SiteState>
  reduce?: <S extends SiteState>(state: S, input: AppInput) => S
  observe?: (context: SiteContext) => void
}>

/** The state a list of modules starts with: each module's own slices. */
export const initial_state_of = (modules: readonly AppModule[]): AppState =>
  Object.freeze(modules.reduce((state, module) => ({ ...state, ...module.initial?.() }), {})) as AppState

/** One input folded through the modules' reducers, in list order. */
export const reduce_with =
  (modules: readonly AppModule[]) =>
  (state: AppState, input: AppInput): AppState =>
    modules.reduce((folded, module) => (module.reduce ? module.reduce(folded, input) : folded), state)

/** The same modules, where only the named ones run their observer. The others keep their slices and reducers. */
export const observing = <M extends Readonly<{ name: string; observe?: unknown }>>(
  modules: readonly M[],
  names: readonly string[]
): readonly M[] =>
  modules.map((module) => (names.includes(module.name) ? module : Object.freeze({ ...module, observe: undefined })))

const create_events = () => {
  const listeners = new Map<keyof EventArguments<AppState>, Set<(arguments_: readonly unknown[]) => void>>()
  return Object.freeze({
    api: Object.freeze({
      on: <K extends keyof EventArguments<AppState>>(
        name: K,
        listener: (...arguments_: EventArguments<AppState>[K]) => void
      ): void => {
        const bucket = listeners.get(name) ?? new Set<(arguments_: readonly unknown[]) => void>()
        bucket.add((arguments_) => listener(...(arguments_ as EventArguments<AppState>[K])))
        listeners.set(name, bucket)
      },
    }) satisfies AppEvents,
    emit: <K extends keyof EventArguments<AppState>>(name: K, ...arguments_: EventArguments<AppState>[K]): void => {
      for (const listener of listeners.get(name) ?? []) listener(arguments_)
    },
    clear: (): void => listeners.clear(),
  })
}

export const create_app = () => {
  let state = Object.freeze({}) as AppState
  let reduce: (state: AppState, input: AppInput) => AppState = (current) => current
  let active_observers: AbortController | null = null
  let started = state
  // A render without a live subscription (a server render, a test) reads the state the surface started with.
  const store: StoreApi<AppState> = Object.freeze({
    ...createStore<AppState>(() => state),
    getInitialState: () => started,
  })
  const events = create_events()
  let input_queue: readonly AppInput[] = []
  let reducing = false

  const dispatch = (input: AppInput): void => {
    input_queue = Object.freeze([...input_queue, input])
    if (reducing) return
    reducing = true
    try {
      while (input_queue.length > 0) {
        const [next_input, ...remaining] = input_queue
        input_queue = Object.freeze(remaining)
        if (!next_input) continue
        const previous = state
        const next = reduce(previous, next_input)
        state = next
        if (next !== previous) store.setState(next, true)
        events.emit(next_input.type, next_input as never)
        if (next !== previous) events.emit('STATE_UPDATED', next, previous)
      }
    } finally {
      reducing = false
    }
  }

  /** Starts the store with a surface's modules, replacing any earlier start. Returns the stop of this start. */
  const start = (modules: readonly AppModule[], { seat }: Readonly<{ seat: boolean }>): (() => void) => {
    active_observers?.abort()
    events.clear()
    const controller = new AbortController()
    active_observers = controller
    reduce = reduce_with(modules)
    state = initial_state_of(modules)
    started = state
    store.setState(state, true)
    let request_id = 0
    const context: AppContext = Object.freeze({
      events: events.api,
      signal: controller.signal,
      get_state: () => state,
      dispatch,
      seat,
      next_request_id: () => {
        request_id += 1
        return request_id
      },
    })
    for (const module of modules) module.observe?.(context)
    return () => {
      if (active_observers !== controller) return
      controller.abort()
      events.clear()
      active_observers = null
    }
  }

  return Object.freeze({ store, dispatch, start })
}

// Lazy routes and already-mounted consumers must retain the same owner during live reload.
const app = (import.meta.hot?.data.app as ReturnType<typeof create_app> | undefined) ?? create_app()
if (import.meta.hot) {
  // eslint-disable-next-line functional/immutable-data -- Vite's mutable hot-data slot retains the single app owner across module replacement.
  import.meta.hot.data.app = app
  // Stateful core edits need a clean observer lifecycle, rather than old reducer/effect closures.
  import.meta.hot.accept(() => globalThis.location.reload())
}

export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(app.store, selector)
/** The hook for code the site loads: a selector that reads a slice of the game does not compile. */
export const useSiteStore = <T>(selector: (state: SiteState) => T): T => useStore(app.store, selector)
export const read_app_state = app.store.getState
export const subscribe_app = app.store.subscribe
export const dispatch_app = app.dispatch
export const start_app = app.start
