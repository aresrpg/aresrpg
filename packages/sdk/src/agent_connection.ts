// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  parse_client_packet,
  parse_server_packet,
  SERVER_PACKET_TYPES,
  TAKEOVER_DROP_REASONS,
  VIOLATION_DROP_REASONS,
  type CharacterRow,
  type ClientPacket,
  type ServerPacket,
} from '@aresrpg/protocol'

import { create_login_response } from './login_proof.ts'

export type AgentSocket = Readonly<{
  send: (raw: string) => void
  close: (code: number, reason: string) => void
}>

export type AgentTransport = Readonly<{
  open: (
    url: string,
    handlers: Readonly<{
      origin: string
      on_message: (raw: string) => Promise<void>
      on_close: (code: number, reason: string) => void
    }>
  ) => AgentSocket
}>

export type AgentConnectionOptions = Readonly<{
  endpoint: string
  origin: string
  signer: Readonly<{
    address: string
    sign_personal_message: (message: Uint8Array) => Promise<Readonly<{ bytes: string; signature: string }>>
  }>
  transport: AgentTransport
  authorize?: (stage: 'connect' | 'sign' | 'send') => Promise<void>
}>

type Status =
  'disconnected' | 'connecting' | 'signing' | 'authenticating' | 'resyncing' | 'ready' | 'stopped' | 'failed'
export type AgentConnectionState = Readonly<{
  status: Status
  characters: readonly CharacterRow[]
  last_packet: ServerPacket | null
  error: string | null
}>

const empty_state = (status: Status, error: string | null = null): AgentConnectionState => ({
  status,
  characters: [],
  last_packet: null,
  error,
})

const connection_url = ({ endpoint, origin, signer }: AgentConnectionOptions): string => {
  const url = new URL(endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local))
    throw new Error('Use wss:// or a loopback ws:// endpoint')
  if ([url.pathname !== '/', url.username, url.password, url.search, url.hash].some(Boolean))
    throw new Error('Endpoint must be a bare server root')
  const origin_url = new URL(origin)
  if (!['http:', 'https:'].includes(origin_url.protocol) || origin_url.origin !== origin)
    throw new Error('Origin must be an HTTP or HTTPS origin')
  if (!/^0x[0-9a-f]{64}$/.test(signer.address)) throw new Error('Signer address must be normalized')
  url.searchParams.set('address', signer.address)
  return url.href
}

// Validate only the roster fields used as authority by this read-only client. The protocol
// owns the full projection; its server parser is a JSON decoder, not a runtime schema.
const valid_roster = (characters: readonly CharacterRow[]): boolean =>
  Array.isArray(characters) &&
  characters.every((character) => {
    if (!character || typeof character.id !== 'string') return false
    if (character.custody !== 'fight') return character.active_fight === undefined
    const fight = character.active_fight
    return (
      !!fight &&
      typeof fight.id === 'string' &&
      /^0x[0-9a-f]{64}$/.test(fight.id) &&
      Number.isSafeInteger(fight.seat) &&
      fight.seat >= 0
    )
  })

const decode_packet = (raw: string): ServerPacket => {
  const packet = parse_server_packet(raw)
  if (!packet || !SERVER_PACKET_TYPES.includes(packet.type)) throw new Error('Unknown server packet')
  if (packet.type === 'packet/game_state' && packet.frozen !== null && typeof packet.frozen !== 'boolean')
    throw new Error('Invalid game state')
  if (packet.type === 'packet/characters' && !valid_roster(packet.characters)) throw new Error('Invalid roster')
  return packet
}

type ConnectionAction =
  | Readonly<{ type: 'reset'; status: Status; error?: string }>
  | Readonly<{ type: 'status'; status: Status }>
  | Readonly<{ type: 'packet'; packet: ServerPacket }>

const reduce_connection = (state: AgentConnectionState, action: ConnectionAction): AgentConnectionState => {
  switch (action.type) {
    case 'reset':
      return empty_state(action.status, action.error)
    case 'status':
      return { ...state, status: action.status }
    case 'packet':
      return action.packet.type === 'packet/characters'
        ? { ...state, status: 'ready', characters: action.packet.characters, last_packet: action.packet }
        : { ...state, last_packet: action.packet }
  }
}

/** Explicit connection lifecycle, with no keys, transaction signing, replay, or automatic retries.
 * The injected transport must deliver JSON text. A new roster is required on every connection.
 * stop() is permanent; disconnect() permits a later explicit connect().
 */
export const create_agent_connection = (options: AgentConnectionOptions) => {
  const url = connection_url(options)
  const listeners = new Set<(state: AgentConnectionState) => void>()
  let state = empty_state('disconnected')
  let socket: AgentSocket | null = null
  let generation = 0
  let stopped = false
  let initial_game_state: Extract<ServerPacket, { type: 'packet/game_state' }> | null = null
  const dispatch = (action: ConnectionAction) => {
    state = reduce_connection(state, action)
    for (const listener of listeners) listener(structuredClone(state))
  }
  const retire = (status: Status, error?: string) => {
    initial_game_state = null
    generation += 1
    const previous = socket
    socket = null
    dispatch({ type: 'reset', status, error })
    try {
      previous?.close(1000, 'CLIENT_CLOSED')
    } catch (close_error) {
      dispatch({ type: 'reset', status, error: String(close_error) })
      console.error('Agent transport close failed', close_error)
    }
  }
  const report_error = (error: unknown) => retire('failed', String(error))
  const connect = async (): Promise<void> => {
    if (stopped) return
    retire('connecting')
    const active_generation = generation
    const current = () => generation === active_generation
    const send_proof = async (payload: string) => {
      if (
        state.status !== 'connecting' ||
        typeof payload !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload)
      )
        throw new Error('Unexpected login challenge')
      dispatch({ type: 'status', status: 'signing' })
      if (options.authorize) await options.authorize('sign')
      if (!current()) return
      const packet = await create_login_response(options.signer, payload)
      if (!current()) return
      dispatch({ type: 'status', status: 'authenticating' })
      if (!socket) throw new Error('Transport unavailable')
      socket.send(JSON.stringify(packet))
    }
    const accept = (address: string) => {
      if (state.status !== 'authenticating' || address !== options.signer.address)
        throw new Error('Unexpected connection acceptance')
      dispatch({ type: 'status', status: 'resyncing' })
      if (initial_game_state) dispatch({ type: 'packet', packet: initial_game_state })
      initial_game_state = null
    }
    const application_packet = (packet: ServerPacket) => {
      // Server promotion emits game_state synchronously, just before connection_accepted.
      if (packet.type === 'packet/game_state' && state.status === 'authenticating') {
        initial_game_state = packet
        return
      }
      if (!['resyncing', 'ready'].includes(state.status)) throw new Error('Packet before admission')
      dispatch({ type: 'packet', packet })
    }
    const receive = async (raw: string): Promise<void> => {
      // Defer synchronous test transports until open() has returned its socket.
      await Promise.resolve()
      if (!current()) return
      try {
        const packet = decode_packet(raw)
        switch (packet.type) {
          case 'packet/signature_request':
            return await send_proof(packet.payload)
          case 'packet/connection_accepted':
            return accept(packet.address)
          default:
            application_packet(packet)
        }
      } catch (error) {
        if (current()) report_error(error)
      }
    }
    try {
      if (options.authorize) await options.authorize('connect')
      if (!current() || stopped) return
      socket = options.transport.open(url, {
        origin: options.origin,
        on_message: receive,
        on_close: (_code, reason) => {
          if (!current()) return
          socket = null
          stopped =
            TAKEOVER_DROP_REASONS.has(reason) ||
            VIOLATION_DROP_REASONS.has(reason) ||
            ['INVALID_SIGNATURE', 'INVALID_PACKET'].includes(reason)
          retire(stopped ? 'stopped' : 'disconnected', reason)
        },
      })
      if (!current()) {
        socket.close(1000, 'CLIENT_CLOSED')
        socket = null
      }
    } catch (error) {
      report_error(error)
    }
  }
  const request_fight_resync = (fight: string): boolean => {
    if (
      !!options.authorize ||
      state.status !== 'ready' ||
      !socket ||
      !state.characters.some((character) => character.custody === 'fight' && character.active_fight?.id === fight)
    )
      return false
    try {
      const packet = parse_client_packet(JSON.stringify({ type: 'packet/fight_resync', fight }))
      socket.send(JSON.stringify(packet))
      return true
    } catch (error) {
      report_error(error)
      return false
    }
  }
  return Object.freeze({
    connect,
    reconnect: connect,
    disconnect: () => retire(stopped ? 'stopped' : 'disconnected'),
    stop: () => {
      stopped = true
      retire('stopped')
    },
    state: (): AgentConnectionState => structuredClone(state),
    request_fight_resync,
    subscribe: (listener: (state: AgentConnectionState) => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    send: async (packet: ClientPacket): Promise<boolean> => {
      const active_generation = generation
      if (state.status !== 'ready' || !socket || packet.type === 'packet/signature_response') return false
      await options.authorize?.('send')
      if (active_generation !== generation || state.status !== 'ready' || !socket) return false
      const validated = parse_client_packet(JSON.stringify(packet))
      socket.send(JSON.stringify(validated))
      return true
    },
  })
}
