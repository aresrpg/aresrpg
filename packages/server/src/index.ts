// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOOT + THE LEGACY ADMISSION DOOR: transport upgrades with an address, receives a fresh
// challenge, and becomes a player only after its signature verifies on that exact socket.

import type { ServerWebSocket } from 'bun'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

import { PORT, ADMIN_ADDRESSES, ALLOWED_ORIGINS, MAX_PLAYERS, SERVER_ID } from './env.ts'
import { BANNABLE_REASONS, create_ban_list } from './ban_list.ts'
import { verify_login } from './auth.ts'
import { create_authenticated_connection, type AuthenticatedConnection } from './connection.ts'
import { graph } from './graph.ts'
import { create_game_state } from './game_state.ts'
import { create_indexing_health } from './indexing_health.ts'
import { pubsub } from './pubsub.ts'
import { mesh } from './protocol.ts'
import { create_player, type Player } from './player.ts'
import logger from './logger.ts'
import { create_request_limiter } from './request_limiter.ts'
import { latest_checkpoint, sui_client } from './sui.ts'
import { create_pending_admission } from './admission.ts'
import { create_suins_resolver } from './suins.ts'

const log = logger(import.meta)

type ConnectionData = { address: string; release_pending: () => void }
type Connection = ServerWebSocket<ConnectionData>

/** address → the live seat (one per address; a second login evicts the first) */
const connections = new Map<string, { ws: Connection; player: Player }>()
const pending = create_pending_admission()
const handlers = new Map<Connection, AuthenticatedConnection>()
const request_limiter = create_request_limiter()
/** dropped-for-cheating addresses cool off before the door opens again (owner 2026-08-19) */
const bans = create_ban_list()
const indexing_health = create_indexing_health({
  chain_checkpoint: latest_checkpoint,
  indexed_state: pubsub.graph.indexed_state!,
})
const game_state = create_game_state({ graph, pubsub: pubsub.graph })
await game_state.start()

// ── the cluster half: 20s-TTL pod snapshots union addresses across rolling replicas,
//    while the player_connect beacon evicts a duplicate login on ANOTHER pod ──
const resolve_name = create_suins_resolver({ client: sui_client })
const HEARTBEAT_MS = 5_000
setInterval(() => {
  void pubsub.mesh
    .heartbeat(SERVER_ID, [...connections.keys()])
    .then(() => pubsub.mesh.cluster_online())
    .then((online) => pubsub.mesh.record_online?.(online, Date.now()))
    .catch((error: Error) => log.warn({ error: error.message }, 'heartbeat failed'))
}, HEARTBEAT_MS)

pubsub.mesh.emitter.on(mesh.player_connect, (payload) => {
  const { address, server_id } = payload as { address: string; server_id: string }
  if (server_id === SERVER_ID) return // same-pod eviction happens in open()
  connections.get(address)?.ws.close(1008, 'ALREADY_CONNECTED')
})
void pubsub.mesh.subscribe(mesh.player_connect)

const server = Bun.serve<ConnectionData>({
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
    if (bans.is_banned(address)) return new Response('cooling off', { status: 403 })
    const release_pending = pending.reserve()
    if (!release_pending) return new Response('authentication full', { status: 503 })
    try {
      const upgraded = bun_server.upgrade(request, { data: { address, release_pending } })
      if (!upgraded) release_pending()
      return upgraded ? undefined : new Response('upgrade failed', { status: 500 })
    } catch (error) {
      release_pending()
      throw error
    }
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    open(ws: Connection) {
      const { address } = ws.data
      handlers.set(
        ws,
        create_authenticated_connection({
          address,
          send: (packet) => void ws.send(JSON.stringify(packet)),
          close: (code, reason) => ws.close(code, reason),
          verify: verify_login,
          release_pending: ws.data.release_pending,
          promote: () => {
            if (connections.size >= MAX_PLAYERS && !connections.has(address)) return null
            connections.get(address)?.ws.close(1000, 'REPLACED')
            const player = create_player({
              ws,
              address,
              admin: ADMIN_ADDRESSES.has(address),
              graph,
              pubsub,
              game_state,
              indexing_health,
              request_limiter,
              resolve_name,
            })
            connections.set(address, { ws, player })
            void pubsub.mesh.publish(mesh.player_connect, { address, server_id: SERVER_ID })
            log.info({ address }, 'player connected')
            return player
          },
        })
      )
    },
    message(ws: Connection, raw) {
      void handlers.get(ws)?.on_message(raw)
    },
    close(ws: Connection, code: number, reason: string) {
      if (code === 1008 && BANNABLE_REASONS.has(reason)) bans.ban(ws.data.address)
      const { address } = ws.data
      const handler = handlers.get(ws)
      if (handler) handler.on_close()
      else ws.data.release_pending()
      handlers.delete(ws)
      const seat = connections.get(address)
      if (seat?.ws !== ws) return // an evicted elder closing late must not tear down its replacement
      connections.delete(address)
      log.info({ address }, 'player disconnected')
    },
  },
})

log.info({ port: server.port }, 'aresrpg server up — the one realtime door')
