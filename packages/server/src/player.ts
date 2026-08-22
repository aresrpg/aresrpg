// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The per-connection harness (legacy player.js pattern): ONE state, ONE reducer door, observers.
// REDUCERS ARE PURE — `(state, action) => state`, no context, no I/O: their only role is to fold
// actions into state. After each fold the loop emits the action's type and STATE_UPDATED on the
// context's local `events` emitter (the legacy loop verbatim); OBSERVERS wire listeners there and
// own every effect: a packet that needs validation is caught on its action event, validated
// (async allowed), and re-enters as an internal `action/*` dispatch; the reducer folds it; the
// STATE DELTA is what observers act on. A packet that needs no validation may fold directly.
// Teardown rides the abort `signal`. No callback ever writes state.

import { EventEmitter } from 'node:events'

import {
  parse_client_packet,
  type ClientPacket,
  type ServerPacket,
  type PresenceRow,
  type VisibleSlot,
  type MarketObservation,
  type CharacterRow,
} from '@aresrpg/protocol'

import logger from './logger.ts'
import { channels } from './protocol.ts'
import type { Graph } from './graph.ts'
import type { GameState } from './game_state.ts'
import type { Pubsub } from './pubsub_bus.ts'
import player_load from './modules/player_load.ts'
import player_info from './modules/player_info.ts'
import player_events from './modules/player_events.ts'
import player_world from './modules/player_world.ts'
import player_chat from './modules/player_chat.ts'
import player_fight from './modules/player_fight.ts'
import player_party from './modules/player_party.ts'
import player_items from './modules/player_items.ts'
import player_market from './modules/player_market.ts'
import player_shop from './modules/player_shop.ts'
import player_trade from './modules/player_trade.ts'
import player_kolizeum from './modules/player_kolizeum.ts'
import player_admin from './modules/player_admin.ts'
import player_requests from './modules/player_requests.ts'
import { create_request_limiter, type RequestLimiter } from './request_limiter.ts'

const log = logger(import.meta)

/** The embodied presence — a PresenceRow pinned to the world it walks in. */
export type Embodied = PresenceRow & { world: string }
export type MoveAnchor = Readonly<{ x: number; z: number; at_ms: number; blocks: number }>
export type TrackedCharacter = Readonly<{
  presence: Embodied
  move_anchor: MoveAnchor
  party: string | null
  fight: string | null
  fight_seat: number | null
  active_fighter: number | null
}>

/** Actions the reducers fold: client packets + validated internal actions + lifecycle marks. */
export type PlayerAction =
  | ClientPacket
  | {
      type: 'action/track_character'
      character: Embodied
      friends: ReadonlySet<string>
      party: string | null
      fight: string | null
      fight_seat: number | null
      at_ms: number
    }
  | { type: 'action/character_roster'; characters: readonly CharacterRow[] }
  | {
      type: 'action/move'
      character_id: string
      x: number
      y: number
      z: number
      riding: boolean
      at_ms: number
      budget_blocks: number
    }
  /** the OWN character's visible-slot change (chain event folded back into presence truth) */
  | { type: 'action/equip'; character_id: string; slot: VisibleSlot; item_type: string | null }
  | {
      type: 'action/fight'
      character_id: string
      fight: string | null
      seat?: number | null
      active_fighter?: number | null
    }
  | { type: 'action/party'; character_id: string; party: string | null }
  | { type: 'action/spectate'; character_id: string; fight: string | null }
  | { type: 'close' }

export type PlayerState = {
  /** Every owned character tracked by this connection, keyed by explicit wire identity. */
  characters: Readonly<Record<string, TrackedCharacter>>
  /** The capped server roster; it is also the complete server-managed tracking set. */
  allowed_characters: ReadonlySet<string>
  /** Chain-anchor signatures decide which server-managed track needs refreshing. */
  character_signatures: Readonly<Record<string, string>>
  /** friend addresses — address-wide visibility-cap bypass */
  friends: ReadonlySet<string>
  /** Optional spectator watch, explicitly anchored to one owned character. */
  spectating: Readonly<{ character_id: string; fight: string }> | null
  /** the marketplace category window under observation */
  market_observation: MarketObservation | null
}

export type PlayerContext = {
  address: string
  admin: boolean
  graph: Graph
  /** the two pub/sub doors — `graph` (the bound indexer set's evt:* truth) and `mesh` (the
   *  cluster redis for player-published ephemera); channel names route via create_watcher */
  pubsub: Pubsub
  /** Shared cached comparison of indexed checkpoint against the fullnode head. */
  indexing_lag: () => Promise<number | null>
  /** Process-wide chain game state, loaded once and updated by the indexer wire. */
  game_state: GameState
  /** the LOCAL loop emitter (legacy `events`): every folded action re-emits under its type,
   *  every state change emits `STATE_UPDATED(state, previous)` — observers listen here */
  events: EventEmitter
  send: (packet: ServerPacket) => void
  /** Kill the connection with a loud reason — the hacker door (speed, flood). */
  drop: (reason: string) => void
  channels: typeof channels
  get_state: () => PlayerState
  dispatch: (action: PlayerAction) => void
  /** aborts when the connection closes — observers hang their teardown here (legacy signal) */
  signal: AbortSignal
}

export type PlayerModule = {
  name: string
  reduce?: (state: PlayerState, action: PlayerAction) => PlayerState
  observe?: (context: PlayerContext) => void
}

export type Player = {
  dispatch: (action: PlayerAction) => void
  on_message: (raw: string | Buffer) => void
  on_close: () => void
}

const MODULES: PlayerModule[] = [
  player_load,
  player_info,
  player_events,
  player_world,
  player_chat,
  player_fight,
  player_party,
  player_market,
  player_items,
  player_shop,
  player_trade,
  player_kolizeum,
  player_requests,
  player_admin,
]

/** The packets whose handling reaches the graph — the ONE list the read gate matches on.
 *  Modules never rate-limit themselves; the door does (owner 2026-08-16: one global gate,
 *  loose enough — never per-module sprinkling). */
const READ_PACKETS = new Set<string>([
  'packet/spectate',
  'packet/market_observe',
  'packet/character_owner_request',
  'packet/admin_request',
])

const INITIAL_STATE = (): PlayerState => ({
  characters: {},
  allowed_characters: new Set(),
  character_signatures: {},
  friends: new Set(),
  spectating: null,
  market_observation: null,
})

type PlayerWires = Pick<PlayerContext, 'address' | 'admin' | 'graph' | 'pubsub'> & {
  game_state?: GameState
  indexing_lag?: () => Promise<number | null>
  request_limiter?: RequestLimiter
  realtime_limiter?: RequestLimiter
  ws: { send: (raw: string) => unknown; close: (code?: number, reason?: string) => unknown }
}

const UNKNOWN_GAME_STATE: GameState = Object.freeze({
  get: () => null,
  listen: () => () => {},
  start: async () => {},
})

/** Mount one verified connection — returns the ws handler's whole surface. */
export function create_player({
  ws,
  address,
  admin,
  graph,
  pubsub,
  game_state = UNKNOWN_GAME_STATE,
  indexing_lag = async () => null,
  request_limiter = create_request_limiter(),
  realtime_limiter = create_request_limiter({ capacity: 120, window_ms: 1_000 }),
}: PlayerWires): Player {
  let state = INITIAL_STATE()
  const send = (packet: ServerPacket) => void ws.send(JSON.stringify(packet))
  const drop = (reason: string) => void ws.close(1008, reason)

  const events = new EventEmitter()
  events.setMaxListeners(0)
  const controller = new AbortController()

  const context: PlayerContext = {
    address,
    admin,
    graph,
    pubsub,
    game_state,
    indexing_lag,
    events,
    send,
    drop,
    channels,
    get_state: () => state,
    signal: controller.signal,
    dispatch: (action) => {
      const previous = state
      const next = MODULES.reduce(
        (folded, module) => (module.reduce ? module.reduce(folded, action) : folded),
        previous
      )
      state = next
      events.emit(action.type, action)
      // compare the FOLD's output, not the live state — a nested dispatch from an action
      // listener already emitted its own delta; re-emitting here would double every effect
      if (next !== previous) events.emit('STATE_UPDATED', next, previous)
    },
  }

  for (const module of MODULES) module.observe?.(context)

  return {
    dispatch: (action) => context.dispatch(action),
    on_message: (raw) => {
      if (!realtime_limiter.take(address)) return drop('RATE_LIMIT')
      try {
        const packet = parse_client_packet(raw)
        if (READ_PACKETS.has(packet.type) && !request_limiter.take(address)) {
          const id = 'id' in packet && Number.isInteger(packet.id) ? { id: packet.id } : {}
          send({ type: 'packet/error', ...id, reason: 'rate limited' })
          return
        }
        context.dispatch(packet)
      } catch (error) {
        log.warn({ address, error: (error as Error).message }, 'packet refused')
        send({ type: 'packet/error', reason: (error as Error).message })
      }
    },
    on_close: () => {
      context.dispatch({ type: 'close' })
      controller.abort()
    },
  }
}
