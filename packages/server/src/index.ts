// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOOT + THE UPGRADE DOOR (legacy index.js pattern): one Bun server, one route class — the
// zkLogin-verified websocket upgrade. The login proof rides the query string
// (?address&bytes&signature&uuid, one-step door); anything unverified is dropped before a
// single byte of game traffic. One connection per address: a newcomer evicts the elder.

import type { ServerWebSocket } from 'bun'

import { PORT, ADMIN_ADDRESSES, MAX_PLAYERS, SERVER_ID } from './env.ts'
import { verify_login } from './auth.ts'
import { graph } from './graph.ts'
import { pubsub } from './pubsub.ts'
import { mesh } from './protocol.ts'
import { create_player, type Player } from './player.ts'
import logger from './logger.ts'

const log = logger(import.meta)

type Connection = ServerWebSocket<{ address: string }>

/** address → the live seat (one per address; a second login evicts the first) */
const connections = new Map<string, { ws: Connection; player: Player }>()

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

    const address = url.searchParams.get('address')?.toLowerCase()
    const bytes = url.searchParams.get('bytes')
    const signature = url.searchParams.get('signature')
    const uuid = url.searchParams.get('uuid')
    if (!address || !bytes || !signature || !uuid) return new Response('missing login proof', { status: 401 })

    const verified = await verify_login({ bytes, signature, address, uuid })
    if (!verified) return new Response('refused', { status: 401 })
    if (connections.size >= MAX_PLAYERS && !connections.has(address))
      return new Response('server full', { status: 503 })

    const upgraded = bun_server.upgrade(request, { data: { address } })
    return upgraded ? undefined : new Response('upgrade failed', { status: 500 })
  },
  websocket: {
    open(ws: Connection) {
      const { address } = ws.data
      connections.get(address)?.ws.close(1000, 'REPLACED')
      const player = create_player({ ws, address, admin: ADMIN_ADDRESSES.has(address), graph, pubsub })
      connections.set(address, { ws, player })
      void pubsub.publish(mesh.player_connect, { address, server_id: SERVER_ID })
      log.info({ address }, 'player connected')
    },
    message(ws: Connection, raw) {
      connections.get(ws.data.address)?.player.on_message(raw)
    },
    close(ws: Connection) {
      const { address } = ws.data
      const seat = connections.get(address)
      if (seat?.ws !== ws) return // an evicted elder closing late must not tear down its replacement
      connections.delete(address)
      seat.player.on_close()
      log.info({ address }, 'player disconnected')
    },
  },
})

log.info({ port: server.port }, 'aresrpg server up — the one realtime door')
