// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  parse_server_packet,
  TAKEOVER_DROP_REASONS,
  VIOLATION_DROP_REASONS,
  type ClientPacket,
} from '@aresrpg/protocol'

import type { AuthSession } from './auth.ts'
import { env } from './env.ts'
import type { AppInput } from './store.ts'

const BACKOFF_START_MS = 1_000
const BACKOFF_CAP_MS = 30_000
/** retry pace while the server's violation cool-off holds the door shut */
const VIOLATION_RETRY_MS = 60_000
const LATENCY_INTERVAL_MS = 5_000
const PACKET_COLORS = Object.freeze({ in: '#3fb950', out: '#58a6ff' })
const WEBSOCKET_OPEN = 1

const clock_ms = (): number => globalThis.performance?.now() ?? Date.now()

/** Position traffic is ~continuous in both directions — pure console noise, never logged. */
const SILENT_PACKETS: ReadonlySet<string> = new Set([
  'packet/position',
  'packet/player_moved',
  'packet/ping',
  'packet/pong',
])

const log_packet = (direction: keyof typeof PACKET_COLORS, packet: Readonly<ClientPacket> | object): void => {
  if ('type' in packet && typeof packet.type === 'string' && SILENT_PACKETS.has(packet.type)) return
  const visible =
    'type' in packet && packet.type === 'packet/signature_response'
      ? { ...packet, bytes: '[redacted]', signature: '[redacted]' }
      : packet
  console.log(`%c WS ${direction.toUpperCase()} `, `color:${PACKET_COLORS[direction]};font-weight:700`, visible)
}

export type ServerLink = Readonly<{
  send: (packet: Readonly<ClientPacket>) => boolean
  dispose: () => void
}>

type ServerLinkOptions = Readonly<{
  session: AuthSession
  dispatch: (input: AppInput) => void
}>

const AUTH_REJECTION_REASONS = new Set(['INVALID_SIGNATURE', 'INVALID_PACKET'])

export const is_terminal_auth_close = (code: number, reason: string): boolean =>
  code === 1008 && AUTH_REJECTION_REASONS.has(reason)

export const application_packet_sendable = (accepted: boolean, ready_state: number): boolean =>
  accepted && ready_state === WEBSOCKET_OPEN

/** the server seats one socket per address — the evicted one is told, and never fights back */
export const is_session_takeover_close = (code: number, reason: string): boolean =>
  TAKEOVER_DROP_REASONS.has(reason) && (code === 1000 || code === 1008)

export const create_login_response = async (
  session: Pick<AuthSession, 'sign_personal_message'>,
  challenge: string
): Promise<Extract<ClientPacket, { type: 'packet/signature_response' }>> => {
  const proof = await session.sign_personal_message(new TextEncoder().encode(`aresrpg::${challenge}`))
  return Object.freeze({ type: 'packet/signature_response', ...proof })
}

export const connect_server = ({ session, dispatch }: ServerLinkOptions): ServerLink => {
  let socket: WebSocket | null = null
  let accepted = false
  let retry_timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let retry_ms = BACKOFF_START_MS
  let latency_timer: ReturnType<typeof setInterval> | null = null
  let next_probe_id = 1
  let pending_probe: Readonly<{ id: number; started_ms: number }> | null = null

  const send = (target: Readonly<WebSocket>, packet: Readonly<ClientPacket>): void => {
    log_packet('out', packet)
    target.send(JSON.stringify(packet))
  }

  const stop_latency = (): void => {
    if (latency_timer) clearInterval(latency_timer)
    latency_timer = null
    pending_probe = null
  }

  const probe_latency = (): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const id = next_probe_id
    next_probe_id += 1
    pending_probe = Object.freeze({ id, started_ms: clock_ms() })
    send(socket, { type: 'packet/ping', id })
  }

  const start_latency = (): void => {
    stop_latency()
    probe_latency()
    latency_timer = setInterval(probe_latency, LATENCY_INTERVAL_MS)
  }

  const connection_url = (): string => {
    const url = new URL(env.server_ws_url)
    url.searchParams.set('address', session.address)
    return url.href
  }

  const open = async (): Promise<void> => {
    dispatch({ type: 'link/connecting' })
    try {
      const url = connection_url()
      if (disposed) return
      const next = new WebSocket(url)
      socket = next
      accepted = false
      next.addEventListener('message', ({ data }) => {
        if (disposed || socket !== next) return
        try {
          const packet = parse_server_packet(String(data))
          log_packet('in', packet)
          if (packet.type === 'packet/pong') {
            if (pending_probe?.id !== packet.id) return
            const latency_ms = Math.max(0, Math.round(clock_ms() - pending_probe.started_ms))
            pending_probe = null
            dispatch({ type: 'link/latency', latency_ms })
            return
          }
          if (packet.type === 'packet/signature_request') {
            void create_login_response(session, packet.payload)
              .then((response) => {
                if (!disposed && socket === next && next.readyState === WebSocket.OPEN) send(next, response)
              })
              .catch((error) => {
                console.error('Server identity proof failed.', error)
                // A hidden/browser-switched tab may interrupt its local wallet signer. No proof
                // reached the server, so this is reconnectable transport failure—not evidence
                // that the remembered wallet is invalid.
                if (!disposed && socket === next) next.close(1000, 'PROOF_INTERRUPTED')
              })
            return
          }
          if (packet.type === 'packet/connection_accepted') {
            accepted = true
            retry_ms = BACKOFF_START_MS
          }
          dispatch({ type: 'server/packet', packet })
          if (packet.type === 'packet/connection_accepted') start_latency()
        } catch (error) {
          console.warn('Malformed server frame ignored.', error)
        }
      })
      next.addEventListener('close', ({ code, reason }) => {
        if (disposed || socket !== next) return
        socket = null
        accepted = false
        stop_latency()
        if (is_terminal_auth_close(code, reason)) {
          dispatch({ type: 'link/rejected', reason })
          return
        }
        // connected from another place: stay red, never reconnect — a retry here would just
        // steal the seat back and ping-pong both tabs forever
        if (is_session_takeover_close(code, reason)) {
          dispatch({ type: 'link/replaced' })
          return
        }
        // a rule-violation drop: surface it red and retry SLOWLY — the server's cool-off ban
        // refuses the door anyway, hammering it would only be noise
        if (code === 1008 && VIOLATION_DROP_REASONS.has(reason)) {
          dispatch({ type: 'link/violation', reason })
          retry_ms = VIOLATION_RETRY_MS
          retry_timer = setTimeout(() => void open(), VIOLATION_RETRY_MS)
          return
        }
        dispatch({ type: 'link/failed', error: reason || 'Connection lost' })
        const delay = retry_ms
        retry_ms = Math.min(retry_ms * 2, BACKOFF_CAP_MS)
        retry_timer = setTimeout(() => void open(), delay)
      })
    } catch (error) {
      if (disposed) return
      console.error('Server connection failed; retrying.', error)
      dispatch({ type: 'link/failed', error: error instanceof Error ? error.message : String(error) })
      const delay = retry_ms
      retry_ms = Math.min(retry_ms * 2, BACKOFF_CAP_MS)
      retry_timer = setTimeout(() => void open(), delay)
    }
  }

  void open()
  return Object.freeze({
    send: (packet: Readonly<ClientPacket>): boolean => {
      if (!socket || !application_packet_sendable(accepted, socket.readyState)) return false
      send(socket, packet)
      return true
    },
    dispose: () => {
      disposed = true
      stop_latency()
      if (retry_timer) clearTimeout(retry_timer)
      retry_timer = null
      socket?.close(1000, 'CLIENT_CLOSED')
      socket = null
      accepted = false
    },
  })
}
