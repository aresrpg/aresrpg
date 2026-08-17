// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOOT + THE LEGACY ADMISSION DOOR: transport upgrades with an address, receives a fresh
// challenge, and becomes a player only after its signature verifies on that exact socket.

import type { ServerWebSocket } from 'bun'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

import { PORT, ADMIN_ADDRESSES, ALLOWED_ORIGINS, MAX_PLAYERS, SERVER_ID } from './env.ts'
import { verify_login } from './auth.ts'
import { create_authenticated_connection, type AuthenticatedConnection } from './connection.ts'
import { graph } from './graph.ts'
import { create_indexing_health } from './indexing_health.ts'
import { pubsub } from './pubsub.ts'
import { mesh } from './protocol.ts'
import { create_player, type Player } from './player.ts'
import logger from './logger.ts'
import { create_request_limiter } from './request_limiter.ts'
import { latest_checkpoint } from './sui.ts'

const log = logger(import.meta)

type Connection = ServerWebSocket<{ address: string }>

/** address → the live seat (one per address; a second login evicts the first) */
const connections = new Map<string, { ws: Connection; player: Player }>()
const pending = new Set<Connection>()
const handlers = new Map<Connection, AuthenticatedConnection>()
const upgrading = new Map<string, number>()
const upgrading_count = (): number => [...upgrading.values()].reduce((total, count) => total + count, 0)
const decrement_upgrade = (address: string): void => {
  const count = upgrading.get(address) ?? 0
  if (count <= 1) upgrading.delete(address)
  else upgrading.set(address, count - 1)
}
const request_limiter = create_request_limiter()
const indexing_lag = create_indexing_health({
  chain_checkpoint: latest_checkpoint,
  indexed_checkpoint: pubsub.indexed_checkpoint,
})

// ── the cluster half (per-POD, legacy law): the 20s-TTL heartbeat key any pod count sums,
//    and the player_connect beacon that evicts a duplicate login on ANOTHER pod ──
const HEARTBEAT_MS = 5_000
setInterval(() => {
  void pubsub
    .heartbeat(SERVER_ID, connections.size)
    .catch((error: Error) => log.warn({ error: error.message }, 'heartbeat failed'))
}, HEARTBEAT_MS)

pubsub.emitter.on(mesh.player_connect, (payload) => {
  const { address, server_id } = payload as { address: string; server_id: string }
  if (server_id === SERVER_ID) return // same-pod eviction happens in open()
  connections.get(address)?.ws.close(1008, 'ALREADY_CONNECTED')
})
void pubsub.subscribe(mesh.player_connect)

const server = Bun.serve<{ address: string }>({
  port: PORT,
  async fetch(request, bun_server) {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname !== '/') return new Response('not found', { status: 404 })

    const origin = request.headers.get('origin')?.replace(/\/+$/, '')
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response('origin refused', { status: 403 })
    const claimed_address = url.searchParams.get('address')
    if (!claimed_address || !isValidSuiAddress(claimed_address)) return new Response('invalid address', { status: 401 })
    const address = normalizeSuiAddress(claimed_address)
    if (connections.size + pending.size + upgrading_count() >= MAX_PLAYERS && !connections.has(address))
      return new Response('server full', { status: 503 })

    upgrading.set(address, (upgrading.get(address) ?? 0) + 1)
    const upgraded = bun_server.upgrade(request, { data: { address } })
    if (!upgraded) decrement_upgrade(address)
    return upgraded ? undefined : new Response('upgrade failed', { status: 500 })
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    open(ws: Connection) {
      const { address } = ws.data
      decrement_upgrade(address)
      pending.add(ws)
      handlers.set(
        ws,
        create_authenticated_connection({
          address,
          send: (packet) => void ws.send(JSON.stringify(packet)),
          close: (code, reason) => ws.close(code, reason),
          verify: verify_login,
          promote: () => {
            pending.delete(ws)
            if (connections.size >= MAX_PLAYERS && !connections.has(address)) return null
            connections.get(address)?.ws.close(1000, 'REPLACED')
            const player = create_player({
              ws,
              address,
              admin: ADMIN_ADDRESSES.has(address),
              graph,
              pubsub,
              indexing_lag,
              request_limiter,
            })
            connections.set(address, { ws, player })
            void pubsub.publish(mesh.player_connect, { address, server_id: SERVER_ID })
            log.info({ address }, 'player connected')
            return player
          },
        })
      )
    },
    message(ws: Connection, raw) {
      void handlers.get(ws)?.on_message(raw)
    },
    close(ws: Connection) {
      pending.delete(ws)
      const { address } = ws.data
      handlers.get(ws)?.on_close()
      handlers.delete(ws)
      const seat = connections.get(address)
      if (seat?.ws !== ws) return // an evicted elder closing late must not tear down its replacement
      connections.delete(address)
      log.info({ address }, 'player disconnected')
    },
  },
})

log.info({ port: server.port }, 'aresrpg server up — the one realtime door')
