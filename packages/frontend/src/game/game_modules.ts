// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The game's modules: the site's account modules it shares, then every module of the world.
import type { JourneyState } from '../journey/model.ts'
import admin, { type AdminInput, type AdminState } from '../modules/admin.ts'
import analytics from '../modules/analytics.ts'
import audio from '../modules/audio.ts'
import automation, { type AutomationInput, type AutomationState } from '../modules/automation.ts'
import chain_clock from '../modules/chain_clock.ts'
import chat, { type ChatInput, type ChatState } from '../modules/chat.ts'
import claims, { type ClaimsInput } from '../modules/claims.ts'
import craft_lock from '../modules/craft_character_lock.ts'
import distribution from '../modules/distribution.ts'
import duel, { type DuelInput } from '../modules/duel.ts'
import dungeon, { type DungeonInput, type DungeonState } from '../modules/dungeon.ts'
import editor, { type EditorInput, type SeedEditorState } from '../modules/editor.ts'
import engine from '../modules/engine.ts'
import type { EngineInput, EngineState } from '../modules/engine_state.ts'
import external_wallet from '../modules/external_wallet.ts'
import fight, { type FightSessionInput, type FightSessionState } from '../modules/fight.ts'
import fight_chain from '../modules/fight_chain.ts'
import fight_result, { type FightResultInput, type FightResultState } from '../modules/fight_result.ts'
import friends, { type FriendsInput, type FriendsState } from '../modules/friends.ts'
import funding from '../modules/funding.ts'
import gameplay_analytics, {
  type GameplayAnalyticsInput,
  type GameplayAnalyticsState,
} from '../modules/gameplay_analytics.ts'
import hosted_agent from '../modules/hosted_agent.ts'
import job_level_up, { type JobLevelUpInput, type JobLevelUpState } from '../modules/job_level_up.ts'
import journey, { type JourneyInput } from '../modules/journey.ts'
import kolizeum, { type KolizeumInput, type KolizeumState } from '../modules/kolizeum.ts'
import locale from '../modules/locale.ts'
import location from '../modules/location.ts'
import marketplace from '../modules/marketplace.ts'
import mastery from '../modules/mastery.ts'
import mastery_quest from '../modules/mastery_quest.ts'
import navigation, { type NavigationInput, type NavigationState } from '../modules/navigation.ts'
import party, { type PartyInput, type PartyState } from '../modules/party.ts'
import party_follow from '../modules/party_follow.ts'
import type { PracticeInput, PracticeState } from '../modules/practice.ts'
import positions from '../modules/positions.ts'
import run_to, { type RunToInput, type RunToState } from '../modules/run_to.ts'
import runeforge, { type RuneforgeInput, type RuneforgeState } from '../modules/runeforge.ts'
import session from '../modules/session.ts'
import settings, { type SettingsInput } from '../modules/settings.ts'
import simulator, { type SimulatorInput, type SimulatorState } from '../modules/simulator.ts'
import suins from '../modules/suins.ts'
import tournament, { type TournamentInput, type TournamentState } from '../modules/tournament.ts'
import trade, { trade_actions } from '../modules/trade.ts'
import wallet_import from '../modules/wallet_import.ts'
import world, { type WorldInput, type WorldState } from '../modules/world.ts'
import { observing, type AppModule } from '../store.ts'

import type { GameSettings } from './core/settings.ts'

/** The slices outside the site: the world's, and those of the practice and demo pages. */
export type GameState = Readonly<{
  practice: PracticeState
  gameplay_analytics: GameplayAnalyticsState
  claim_failures: readonly string[]
  journey: JourneyState
  navigation: NavigationState
  settings: GameSettings
  engine: EngineState
  fight: FightSessionState
  fight_result: FightResultState
  simulator: SimulatorState
  admin: AdminState
  editor: SeedEditorState
  chat: ChatState
  world: WorldState
  dungeon: DungeonState
  tournament: TournamentState
  kolizeum: KolizeumState
  friends: FriendsState
  party: PartyState
  run_to: RunToState
  automation: AutomationState
  runeforge: RuneforgeState
  job_level_up: JobLevelUpState
}>

export type GameInput =
  | PracticeInput
  | GameplayAnalyticsInput
  | JourneyInput
  | NavigationInput
  | SettingsInput
  | EngineInput
  | SimulatorInput
  | FightSessionInput
  | FightResultInput
  | AdminInput
  | EditorInput
  | ChatInput
  | WorldInput
  | DuelInput
  | DungeonInput
  | TournamentInput
  | KolizeumInput
  | FriendsInput
  | PartyInput
  | RunToInput
  | AutomationInput
  | RuneforgeInput
  | ClaimsInput
  | JobLevelUpInput

/** Every module the game's slices need, each with its observer: the game, the practice and the demo pages each
 * choose which observers run. Reducers fold in this order; each comment states a real dependency on an earlier fold. */
export const WORLD_MODULES: readonly AppModule[] = Object.freeze([
  // The session folds first, so every other module reads the account it ends on.
  session,
  // A jobs window locks the played character to the one set to craft: it corrects the session's selection.
  craft_lock,
  hosted_agent,
  suins,
  chain_clock,
  external_wallet,
  location,
  navigation,
  funding,
  analytics,
  gameplay_analytics,
  settings,
  audio,
  locale,
  engine,
  // The fight board names a lab's characters, so the game keeps the lab's slice; the demo alone runs it.
  simulator,
  fight,
  fight_result,
  admin,
  // Item sources read the seed editor's slice; the demo alone runs it.
  editor,
  chat,
  world,
  duel,
  fight_chain,
  claims,
  marketplace,
  dungeon,
  kolizeum,
  tournament,
  friends,
  party,
  // Arrival consumers read the accepted target before run-to releases it.
  journey,
  run_to,
  automation,
  party_follow,
  positions,
  trade,
  trade_actions,
  runeforge,
  mastery,
  mastery_quest,
  distribution,
  wallet_import,
  job_level_up,
])

/** Every module of the game, each running its observer except the demo's lab and seed editor. */
export const GAME_MODULES: readonly AppModule[] = observing(
  WORLD_MODULES,
  WORLD_MODULES.map(({ name }) => name).filter((name) => name !== 'simulator' && name !== 'editor')
)
