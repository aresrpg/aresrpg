// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { parse_server_packet, VIOLATION_DROP_REASONS, type ClientPacket } from '@aresrpg/protocol'

import type { AuthSession } from './auth.ts'
import { env } from './env.ts'
import type { AppInput } from './store.ts'

const BACKOFF_START_MS = 1_000
const BACKOFF_CAP_MS = 30_000
/** retry pace while the server's violation cool-off holds the door shut */
const VIOLATION_RETRY_MS = 60_000
const LATENCY_INTERVAL_MS = 5_000
const PACKET_COLORS = Object.freeze({ in: '#3fb950', out: '#58a6ff' })

const clock_ms = (): number => globalThis.performance?.now() ?? Date.now()

const log_packet = (direction: keyof typeof PACKET_COLORS, packet: Readonly<ClientPacket> | object): void => {
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

const AUTH_REJECTION_REASONS = new Set(['INVALID_SIGNATURE', 'INVALID_PACKET', 'SIGNATURE_TIMEOUT'])

export const is_terminal_auth_close = (code: number, reason: string): boolean =>
  code === 1008 && AUTH_REJECTION_REASONS.has(reason)

export const create_login_response = async (
  session: Pick<AuthSession, 'sign_personal_message'>,
  challenge: string
): Promise<Extract<ClientPacket, { type: 'packet/signature_response' }>> => {
  const proof = await session.sign_personal_message(new TextEncoder().encode(`aresrpg::${challenge}`))
  return Object.freeze({ type: 'packet/signature_response', ...proof })
}

export const connect_server = ({ session, dispatch }: ServerLinkOptions): ServerLink => {
  let socket: WebSocket | null = null
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
      next.addEventListener('open', () => {
        retry_ms = BACKOFF_START_MS
      })
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
                if (!disposed && socket === next) dispatch({ type: 'link/rejected', reason: 'INVALID_SIGNATURE' })
              })
            return
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
        stop_latency()
        if (is_terminal_auth_close(code, reason)) {
          dispatch({ type: 'link/rejected', reason })
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
      if (socket?.readyState !== WebSocket.OPEN) return false
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
    },
  })
}
