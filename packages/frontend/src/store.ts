// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { GameSettings } from './game/core/settings.ts'
import { CHAT_CHANNELS } from './game/core/chat_preferences.ts'
import engine, { initial_engine_state, type EngineInput, type EngineState } from './modules/engine.ts'
import fight, { initial_fight_session_state, type FightSessionInput, type FightSessionState } from './modules/fight.ts'
import type { Locale } from './i18n/locale.ts'
import type { AppCopy } from './i18n/copy.ts'
import leaderboards, {
  initial_leaderboards_state,
  type LeaderboardsState,
  type LeaderboardsInput,
} from './modules/leaderboards.ts'
import admin, { initial_admin_state, type AdminInput, type AdminState } from './modules/admin.ts'
import editor, { initial_editor_state, type EditorInput, type SeedEditorState } from './modules/editor.ts'
import chat, { initial_chat_state, type ChatInput, type ChatState } from './modules/chat.ts'
import claims, { type ClaimsInput } from './modules/claims.ts'
import duel, { type DuelInput } from './modules/duel.ts'
import fight_chain from './modules/fight_chain.ts'
import fight_result, {
  initial_fight_result_state,
  type FightResultInput,
  type FightResultState,
} from './modules/fight_result.ts'
import locale, { type LocaleInput } from './modules/locale.ts'
import navigation, {
  initial_navigation_state,
  type NavigationInput,
  type NavigationState,
} from './modules/navigation.ts'
import session, { initial_session_state, type SessionInput, type SessionState } from './modules/session.ts'
import suins, { initial_suins_state, type SuinsInput, type SuinsState } from './modules/suins.ts'
import chain_clock, { type ChainClock, type ChainClockInput } from './modules/chain_clock.ts'
import simulator, { initial_simulator_state, type SimulatorInput, type SimulatorState } from './modules/simulator.ts'
import settings, { type SettingsInput } from './modules/settings.ts'
import world, { initial_world_state, type WorldInput, type WorldState } from './modules/world.ts'
import marketplace, {
  initial_marketplace_state,
  type MarketplaceInput,
  type MarketplaceState,
} from './modules/marketplace.ts'
import dungeon, { initial_dungeon_state, type DungeonInput, type DungeonState } from './modules/dungeon.ts'
import kolizeum, { initial_kolizeum_state, type KolizeumInput, type KolizeumState } from './modules/kolizeum.ts'
import friends, { initial_friends_state, type FriendsInput, type FriendsState } from './modules/friends.ts'
import party, { initial_party_state, type PartyInput, type PartyState } from './modules/party.ts'
import party_follow from './modules/party_follow.ts'
import run_to, { initial_run_to_state, type RunToInput, type RunToState } from './modules/run_to.ts'
import automation, {
  initial_automation_state,
  type AutomationInput,
  type AutomationState,
} from './modules/automation.ts'
import trade, { initial_trade_state, type TradeInput, type TradeState } from './modules/trade.ts'
import runeforge, { initial_runeforge_state, type RuneforgeInput, type RuneforgeState } from './modules/runeforge.ts'
import mastery, { initial_mastery_state, type MasteryInput, type MasteryState } from './modules/mastery.ts'
import distribution, {
  initial_distribution_state,
  type DistributionInput,
  type DistributionState,
} from './modules/distribution.ts'
import job_level_up, {
  initial_job_level_up_state,
  type JobLevelUpInput,
  type JobLevelUpState,
} from './modules/job_level_up.ts'
import external_wallet, {
  initial_external_wallet_state,
  type ExternalWalletState,
  type ExternalWalletInput,
} from './modules/external_wallet.ts'

export type AppState = Readonly<{
  chain_clock: ChainClock
  session: SessionState
  external_wallet: ExternalWalletState
  navigation: NavigationState
  settings: GameSettings
  locale: Locale
  engine: EngineState
  fight: FightSessionState
  fight_result: FightResultState
  copy: AppCopy | null
  simulator: SimulatorState
  admin: AdminState
  editor: SeedEditorState
  chat: ChatState
  world: WorldState
  marketplace: MarketplaceState
  leaderboards: LeaderboardsState
  dungeon: DungeonState
  kolizeum: KolizeumState
  friends: FriendsState
  party: PartyState
  run_to: RunToState
  automation: AutomationState
  trade: TradeState
  runeforge: RuneforgeState
  mastery: MasteryState
  distribution: DistributionState
  job_level_up: JobLevelUpState
  suins: SuinsState
}>

export type AppInput =
  | ChainClockInput
  | SessionInput
  | ExternalWalletInput
  | NavigationInput
  | SettingsInput
  | LocaleInput
  | EngineInput
  | SimulatorInput
  | FightSessionInput
  | FightResultInput
  | AdminInput
  | EditorInput
  | ChatInput
  | WorldInput
  | DuelInput
  | MarketplaceInput
  | LeaderboardsInput
  | DungeonInput
  | KolizeumInput
  | FriendsInput
  | PartyInput
  | RunToInput
  | AutomationInput
  | TradeInput
  | RuneforgeInput
  | MasteryInput
  | DistributionInput
  | ClaimsInput
  | JobLevelUpInput
  | SuinsInput

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

// Registration owns observer availability. Keep reducer order explicit: session folds first.
const MODULE_REGISTRY = [
  [session, 'player'],
  [suins, 'player'],
  [chain_clock, 'player'],
  [external_wallet, 'player'],
  [navigation, 'player'],
  [settings, 'shared'],
  [locale, 'player'],
  [engine, 'player'],
  [simulator, 'demo'],
  [fight, 'shared'],
  [fight_result, 'player'],
  [admin, 'player'],
  [editor, 'demo'],
  [chat, 'player'],
  [world, 'player'],
  [duel, 'player'],
  [fight_chain, 'player'],
  [claims, 'player'],
  [marketplace, 'player'],
  [leaderboards, 'player'],
  [dungeon, 'player'],
  [kolizeum, 'player'],
  [friends, 'player'],
  [party, 'player'],
  [run_to, 'player'],
  [automation, 'player'],
  [party_follow, 'player'],
  [trade, 'player'],
  [runeforge, 'player'],
  [mastery, 'player'],
  [distribution, 'player'],
  [job_level_up, 'player'],
] as const satisfies readonly (readonly [AppModule, 'player' | 'demo' | 'shared'])[]

const MODULES = MODULE_REGISTRY.map(([module]) => module)
export type AppModuleName = (typeof MODULES)[number]['name']

export const PLAYER_APP_MODULES = Object.freeze(
  MODULE_REGISTRY.filter(([, runtime]) => runtime !== 'demo').map(([module]) => module.name)
)
export const DEMO_APP_MODULES = Object.freeze(
  MODULE_REGISTRY.filter(([, runtime]) => runtime !== 'player').map(([module]) => module.name)
)

export const initial_app_state = (settings_state: GameSettings): AppState =>
  Object.freeze({
    chain_clock: null,
    session: initial_session_state(),
    suins: initial_suins_state(),
    external_wallet: initial_external_wallet_state(),
    navigation: initial_navigation_state(),
    settings: settings_state,
    locale: 'en',
    engine: initial_engine_state(),
    fight: initial_fight_session_state(),
    fight_result: initial_fight_result_state(),
    copy: null,
    simulator: initial_simulator_state(),
    admin: initial_admin_state(),
    editor: initial_editor_state(),
    chat: initial_chat_state(),
    world: initial_world_state(),
    marketplace: initial_marketplace_state(),
    leaderboards: initial_leaderboards_state(),
    dungeon: initial_dungeon_state(),
    kolizeum: initial_kolizeum_state(),
    friends: initial_friends_state(),
    party: initial_party_state(),
    run_to: initial_run_to_state(),
    automation: initial_automation_state(),
    trade: initial_trade_state(),
    runeforge: initial_runeforge_state(),
    mastery: initial_mastery_state(),
    distribution: initial_distribution_state(),
    job_level_up: initial_job_level_up_state(),
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

export const create_app = () => {
  const default_settings = Object.freeze({
    quality: 'medium',
    flat_mode: false,
    music_enabled: true,
    master_volume: 1,
    footsteps_enabled: true,
    completed_tutorials: Object.freeze([]),
    follow_leader: false,
    chat_visible_channels: CHAT_CHANNELS,
    chat_speak_channel: 'general',
    auto_switch_fighter: true,
    placement_gas_warning_disabled: false,
    render_distance: null,
    fight_access: 0,
  }) satisfies GameSettings
  let state = initial_app_state(default_settings)
  let active_observers: AbortController | null = null
  const store = createStore<AppState>(() => state)
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
        const next = reduce_app_state(previous, next_input)
        state = next
        if (next !== previous) store.setState(next, true)
        events.emit(next_input.type, next_input as never)
        if (next !== previous) events.emit('STATE_UPDATED', next, previous)
      }
    } finally {
      reducing = false
    }
  }

  return Object.freeze({
    store,
    dispatch,
    initialize: (settings_state: GameSettings): void => {
      state = initial_app_state(settings_state)
      store.setState(state, true)
    },
    observe: (module_names: readonly AppModuleName[] | null = null): (() => void) => {
      active_observers?.abort()
      events.clear()
      const controller = new AbortController()
      active_observers = controller
      const selected = module_names ? new Set(module_names) : null
      const context: AppContext = Object.freeze({
        events: events.api,
        signal: controller.signal,
        get_state: () => state,
        dispatch,
      })
      for (const module of MODULES) if (!selected || selected.has(module.name)) module.observe?.(context)
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

// Lazy routes and already-mounted consumers must retain the same owner during live reload.
const app = (import.meta.hot?.data.app as ReturnType<typeof create_app> | undefined) ?? create_app()
if (import.meta.hot) {
  // eslint-disable-next-line functional/immutable-data -- Vite's mutable hot-data slot retains the single app owner across module replacement.
  import.meta.hot.data.app = app
  // Stateful core edits need a clean observer lifecycle, rather than old reducer/effect closures.
  import.meta.hot.accept(() => globalThis.location.reload())
}

export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(app.store, selector)
export const read_app_state = app.store.getState
export const dispatch_app = app.dispatch
export const initialize_app_store = app.initialize
export const observe_app = app.observe
