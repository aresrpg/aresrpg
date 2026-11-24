// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The per-connection harness: one state, one reducer door, observers. Reducers are pure
// `(state, action) => state`. After each fold the loop emits the action's type and STATE_UPDATED on
// the local `events` emitter; observers own every effect: a packet that needs validation is caught
// on its action event, validated (async allowed), and re-enters as an internal `action/*` dispatch.
// Teardown rides the abort `signal`. No callback writes state. The connection's stage, fixed at
// upgrade, selects the mounted modules from one table.

import { EventEmitter } from 'node:events'

import { create_request_limiter } from '@aresrpg/protocol/request-limiter'
import {
  parse_client_packet,
  MAX_TRACKED_CHARACTERS,
  POSITION_INTERVAL_MS,
  type Claim,
  type ClientPacket,
  type ServerPacket,
  type PresenceRow,
  type PlayerPosition,
  type VisibleSlot,
  type MarketObservation,
  type MarketPriceObservation,
  type LeaderboardObservation,
  type CharacterRow,
  VIOLATION_DROP_REASONS,
} from '@aresrpg/protocol'

import { create_player_output, type PlayerSocket } from './player_output.ts'
import type { PublicMarket } from './public_market.ts'
import type { PublicWorld } from './public_world.ts'
import logger from './logger.ts'
import type { Graph } from './graph.ts'
import type { GameState } from './game_state.ts'
import type { IndexingHealth } from './indexing_health.ts'
import type { Pubsub } from './pubsub_bus.ts'
import account_streams, { type AccountDomain } from './modules/account_streams.ts'
import player_info from './modules/player_info.ts'
import player_equipment from './modules/player_equipment.ts'
import player_agent_observation, { type AgentWatch } from './modules/player_agent_observation.ts'
import player_world from './modules/player_world.ts'
import player_dungeon from './modules/player_dungeon.ts'
import player_chat from './modules/player_chat.ts'
import player_fight from './modules/player_fight.ts'
import player_party from './modules/player_party.ts'
import player_inventory_observation from './modules/player_inventory_observation.ts'
import player_agent_status from './modules/player_agent_status.ts'
import player_market from './modules/player_market.ts'
import player_leaderboards, { type Leaderboards } from './modules/player_leaderboards.ts'
import type { ResolveName } from './suins.ts'
import player_admin from './modules/player_admin.ts'
import player_inspection from './modules/player_inspection.ts'
import player_requests from './modules/player_requests.ts'
import player_allocation from './modules/player_allocation.ts'
import type { Allocation } from './allocation/runtime.ts'

const log = logger(import.meta)
// Preserve the six-character traffic floor; larger authenticated tracking sets receive
// the same cadence and control headroom without resetting spent requests.
const realtime_budget = (tracked: number) =>
  Math.ceil(1_000 / POSITION_INTERVAL_MS) * Math.max(MAX_TRACKED_CHARACTERS, tracked) + 30

export type Embodied = PresenceRow & { world: string }
export type MoveAnchor = Readonly<{ x: number; z: number; at_ms: number; blocks: number }>
export type TrackedCharacter = Readonly<{
  presence: Embodied
  move_anchor: MoveAnchor
  checkpoint: string
  party: string | null
  fight: string | null
  fight_seat: number | null
  active_fighter: number | null
  dungeon_run: CharacterRow['dungeon_run'] | null
}>

/** Actions the reducers fold: client packets + validated internal actions + lifecycle marks. */
export type PlayerAction =
  | ClientPacket
  | { type: 'action/agent_watch'; watch: AgentWatch | null }
  | { type: 'action/agent_rows'; request: AgentWatch['request']; characters: readonly CharacterRow[] }
  | {
      type: 'action/track_character'
      character: Embodied
      party: string | null
      fight: string | null
      fight_seat: number | null
      dungeon_run: CharacterRow['dungeon_run'] | null
      at_ms: number
    }
  | { type: 'action/refresh_account'; domain: AccountDomain }
  | { type: 'action/character_roster'; characters: readonly CharacterRow[] }
  | {
      type: 'action/move'
      character_id: string
      x: number
      y: number
      z: number
      riding: boolean
      gliding: boolean
      at_ms: number
      budget_blocks: number
    }
  | { type: 'action/equip'; character_id: string; slot: VisibleSlot; item_type: string | null }
  | {
      type: 'action/fight'
      character_id: string
      fight: string | null
      seat?: number | null
      active_fighter?: number | null
    }
  | { type: 'action/party'; character_id: string; party: string | null }
  | { type: 'action/friends'; friends: readonly string[] }
  | { type: 'action/character_watch_ready'; character_id: string }
  | { type: 'action/party_invites_changed'; character_id: string }
  | { type: 'action/nearby_fight'; nearby: PlayerState['nearby_fight'] }
  | { type: 'action/spectate'; character_id: string; fight: string | null }
  | { type: 'action/fight_preview'; character_id: string; fight: string | null }
  | { type: 'close' }

export type PlayerState = {
  /** Read-only; never grants presence, relay or transaction authority. */
  agent_watch?: AgentWatch | null
  /** This socket shared a hosted bot status. Self-declared: counted, never authority. */
  agent?: true
  /** Every owned character tracked by this connection, keyed by explicit wire identity. */
  characters: Readonly<Record<string, TrackedCharacter>>
  /** The indexed roster by id: the proof of ownership and the complete tracking set. */
  roster: Readonly<Record<string, CharacterRow>>
  /** Friend addresses pass the visibility cap. */
  friends: ReadonlySet<string>
  spectating: Readonly<Record<string, string>>
  fight_previews: Readonly<Record<string, string>>
  nearby_fight: Readonly<{ character_id: string; fight: string; world: string; x: number; z: number }> | null
  market_observation: MarketObservation | null
  market_price_observation: MarketPriceObservation | null
  inspection: Extract<ClientPacket, { type: 'packet/inspection_request' }> | null
  leaderboard_observation: LeaderboardObservation | null
}

/** What every stage's modules receive. It names no account: a public module reads public data. */
export type PublicContext = {
  allocation?: Allocation
  public_world: PublicWorld
  public_market: PublicMarket
  leaderboards: Leaderboards
  /** Whom public reads are shaped for: a proven address leaves its own offers out of a market page
   *  and gains its own rank; null reads both anonymously. */
  viewer: string | null
  resolve_name?: ResolveName
  admin: boolean
  graph: Graph
  pubsub: Pubsub
  indexing_health: () => Promise<IndexingHealth>
  game_state: GameState
  /** Every folded action re-emits under its type; every state change emits `STATE_UPDATED(state, previous)`. */
  events: EventEmitter
  send: (packet: ServerPacket) => void
  send_position: (position: PlayerPosition) => void
  /** The server's own decision to end this socket (speed, flood, a failed snapshot). */
  drop: (reason: string) => void
  get_state: () => PlayerState
  dispatch: (action: PlayerAction) => void
  /** Aborts when the connection closes. */
  signal: AbortSignal
}

/** What account and gameplay modules receive: the address this socket proved, and its stage. */
export type PlayerContext = PublicContext & Readonly<{ address: string; stage: Exclude<Stage, 'open'> }>

/** A packet no mounted module folds or listens to changes nothing on that socket. */
export type PlayerModule<Context = PlayerContext> = {
  name: string
  reduce?: (state: PlayerState, action: PlayerAction) => PlayerState
  observe?: (context: Context) => void
}
/** A module every stage may mount: its observer is typed out of any address. */
export type PublicModule = PlayerModule<PublicContext>

export type Player = {
  /** Live tracked identities, including fights/dungeons; never the full ownership catalogue. */
  online_characters: () => readonly string[]
  is_agent: () => boolean
  dispatch: (action: PlayerAction) => void
  on_message: (raw: string | Buffer) => void
  on_close: () => void
}

type Stage = Claim['stage']
type Mount =
  Readonly<{ from: 'open'; module: PublicModule }> | Readonly<{ from: Exclude<Stage, 'open'>; module: PlayerModule }>

/** THE STAGE TABLE — every module in mount (and fold) order with the first stage that mounts it;
 *  the stages nest (open ⊂ signed ⊂ seated). `open` and `signed` mount no module that takes gameplay
 *  input or publishes presence, so such a packet has no handler and changes nothing there. */
const MODULES: readonly Mount[] = [
  { from: 'signed', module: account_streams },
  { from: 'open', module: player_info },
  { from: 'seated', module: player_equipment },
  { from: 'signed', module: player_agent_observation },
  { from: 'seated', module: player_world },
  { from: 'seated', module: player_dungeon },
  { from: 'seated', module: player_chat },
  { from: 'seated', module: player_fight },
  { from: 'seated', module: player_party },
  { from: 'open', module: player_market },
  { from: 'open', module: player_leaderboards },
  { from: 'signed', module: player_inventory_observation },
  { from: 'seated', module: player_agent_status },
  { from: 'open', module: player_requests },
  { from: 'signed', module: player_allocation },
  { from: 'open', module: player_inspection },
  { from: 'seated', module: player_admin },
]
const STAGE_RANK: Readonly<Record<Stage, number>> = Object.freeze({ open: 0, signed: 1, seated: 2 })

/** Whether a socket of `stage` mounts what `from` names; the stages nest. */
export const reaches = (from: Stage, stage: Stage): boolean => STAGE_RANK[from] <= STAGE_RANK[stage]

const modules_of = (stage: Stage): readonly Mount[] => MODULES.filter(({ from }) => reaches(from, stage))

/** Graph-reaching packets: the one list the read gate matches. Modules never rate-limit themselves. */
const READ_PACKETS = new Set<string>([
  'packet/agent_observe',
  'packet/inventory_observe',
  'packet/allocation_request',
  'packet/spectate',
  'packet/fight_preview',
  'packet/fight_nearby',
  'packet/fight_resync',
  'packet/market_observe',
  'packet/market_prices_observe',
  'packet/inspection_request',
  'packet/leaderboard_observe',
  'packet/character_owner_request',
  'packet/admin_request',
])

// Only the declared cancellation shape of each packet may bypass the graph-read allowance.
const cancels_read = (packet: Readonly<ClientPacket>): boolean => {
  if (
    'observation' in packet &&
    [
      'packet/agent_observe',
      'packet/inventory_observe',
      'packet/market_observe',
      'packet/market_prices_observe',
      'packet/leaderboard_observe',
    ].includes(packet.type)
  )
    return packet.observation === null
  switch (packet.type) {
    case 'packet/spectate':
    case 'packet/fight_preview':
    case 'packet/fight_nearby':
      return packet.fight === null
    case 'packet/inspection_request':
      return packet.query === null
    default:
      return false
  }
}
const requests_graph = (packet: Readonly<ClientPacket>): boolean =>
  READ_PACKETS.has(packet.type) && !cancels_read(packet)

const INITIAL_STATE = (): PlayerState => ({
  characters: {},
  roster: {},
  friends: new Set(),
  spectating: {},
  fight_previews: {},
  nearby_fight: null,
  market_observation: null,
  market_price_observation: null,
  leaderboard_observation: null,
  inspection: null,
})

type PlayerWires = Pick<
  PublicContext,
  | 'graph'
  | 'pubsub'
  | 'resolve_name'
  | 'public_world'
  | 'public_market'
  | 'leaderboards'
  | 'admin'
  | 'allocation'
  | 'game_state'
  | 'indexing_health'
> & {
  /** What this socket proved at its door; it alone selects the mounted modules. */
  claim: Claim
  /** Called when the server itself drops this verified player for a violation: the one source of a cool-off. */
  penalize?: () => void
  ws: PlayerSocket
}

/** Both allowances belong to this socket alone, so one key names its whole bucket. */
const SOCKET = 'socket'

/** Observe every mounted module: an open socket hands its public modules the public context; an
 *  account hands every mounted module the context that names its address. */
const observe = (claim: Claim, mounts: readonly Mount[], context: PublicContext): void => {
  if (claim.stage === 'open')
    return mounts.forEach((mount) => {
      if (mount.from === 'open') mount.module.observe?.(context)
    })
  const account: PlayerContext = { ...context, address: claim.address, stage: claim.stage }
  mounts.forEach(({ module }) => module.observe?.(account))
}

/** Mount one admitted connection — returns the ws handler's whole surface. */
export function create_player(wires: PlayerWires): Player {
  const { ws, claim, allocation, resolve_name, graph, pubsub, public_world, public_market, leaderboards } = wires
  const mounts = modules_of(claim.stage)
  const viewer = claim.stage === 'open' ? null : claim.address
  // 60 graph reads a minute (the limiter's default), held by this socket alone.
  const reads = create_request_limiter()
  const penalize = wires.penalize ?? (() => undefined)
  let state = INITIAL_STATE()
  const realtime = create_request_limiter({
    capacity: () => realtime_budget(Object.keys(state.characters).length),
    window_ms: 1_000,
  })
  let closed = false
  const controller = new AbortController()
  const { send, position: send_position } = create_player_output(ws, controller.signal)
  /** The server's own decision to end this socket. A violation earns the cool-off here, never from a close frame. */
  const drop = (reason: string): void => {
    if (VIOLATION_DROP_REASONS.has(reason)) penalize()
    ws.close(1008, reason)
  }

  const events = new EventEmitter()
  events.setMaxListeners(0)
  const context: PublicContext = {
    allocation,
    resolve_name,
    admin: wires.admin,
    graph,
    pubsub,
    public_world,
    public_market,
    leaderboards,
    viewer,
    game_state: wires.game_state,
    indexing_health: wires.indexing_health,
    events,
    send,
    send_position,
    drop,
    get_state: () => state,
    signal: controller.signal,
    dispatch: (action) => {
      if (closed) return
      const previous = state
      const next = mounts.reduce(
        (folded, { module }) => (module.reduce ? module.reduce(folded, action) : folded),
        previous
      )
      state = next
      events.emit(action.type, action)
      // compare the FOLD's output, not the live state — a nested dispatch from an action
      // listener already emitted its own delta; re-emitting here would double every effect
      if (next !== previous) events.emit('STATE_UPDATED', next, previous)
    },
  }
  observe(claim, mounts, context)

  return {
    online_characters: () => Object.keys(state.characters),
    is_agent: () => state.agent === true,
    dispatch: (action) => context.dispatch(action),
    on_message: (raw) => {
      if (closed) return
      if (!realtime.take(SOCKET)) return drop('RATE_LIMIT')
      try {
        const packet = parse_client_packet(raw)
        if (requests_graph(packet) && !reads.take(SOCKET)) {
          const id = 'id' in packet ? { id: packet.id } : {}
          send(
            packet.type === 'packet/inspection_request'
              ? { type: 'packet/inspection_error', id: packet.id }
              : { type: 'packet/error', ...id, reason: 'rate limited' }
          )
          return
        }
        context.dispatch(packet)
      } catch (error) {
        log.warn({ address: viewer, error: (error as Error).message }, 'packet refused')
        send({ type: 'packet/error', reason: (error as Error).message })
      }
    },
    on_close: () => {
      if (closed) return
      controller.abort()
      context.dispatch({ type: 'close' })
      closed = true
      events.removeAllListeners()
    },
  }
}
