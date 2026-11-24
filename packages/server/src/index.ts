// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOOT + THE ONE ADMISSION DOOR: every socket upgrades on `/` with a stage its URL fixes. No
// address is an open socket (public reads, nothing to prove); an address receives a fresh
// challenge and is admitted only after its signature verifies on that exact socket, as a signed
// socket (no gameplay input, no presence) or, with `seat=1`, as the game seat. Only seats enter
// the seat map.

import type { ServerWebSocket } from 'bun'
import type { Claim } from '@aresrpg/protocol'
import { HTTP_DOOR, admit_visitor, create_request_limiter, visitor_of } from '@aresrpg/protocol/request-limiter'

import { create_allocation } from './allocation/runtime.ts'
import { create_public_market } from './public_market.ts'
import { create_public_world } from './public_world.ts'
import {
  PORT,
  ADMIN_ADDRESSES,
  ALLOWED_ORIGINS,
  MAX_PLAYERS,
  MAX_VIEWERS,
  SERVER_ID,
  ALLOCATION_OPTIONS,
} from './env.ts'
import { create_ban_list } from './ban_list.ts'
import { verify_login } from './auth.ts'
import { create_connection, read_claim, type Connection } from './connection.ts'
import { graph } from './graph.ts'
import { create_game_state } from './game_state.ts'
import { create_indexing_health } from './indexing_health.ts'
import { pubsub } from './pubsub.ts'
import { mesh } from './protocol.ts'
import { MAX_BUFFERED_BYTES } from './player_output.ts'
import { create_player, type Player } from './player.ts'
import { create_leaderboards } from './modules/player_leaderboards.ts'
import logger from './logger.ts'
import { latest_checkpoint, sui_client } from './sui.ts'
import { create_admission_slots, hold_upgrade, VIEWS_PER_VISITOR, type UpgradeHold } from './admission.ts'
import { create_suins_resolver } from './suins.ts'
import { HERO_SHARE_PATH, hero_preview } from './share_preview.ts'

const log = logger(import.meta)

type SocketData = Readonly<{ claim: Claim; hold: UpgradeHold }>
type Socket = ServerWebSocket<SocketData>

/** address → the live seat (one per address; a second login evicts the first). Views never enter it. */
const connections = new Map<string, { ws: Socket; player: Player }>()
const public_world = create_public_world(graph, pubsub.graph)
const public_market = create_public_market(graph, pubsub.graph)
const pending = create_admission_slots()
/** live open and signed sockets: MAX_VIEWERS per pod, VIEWS_PER_VISITOR per visitor */
const views = create_admission_slots(MAX_VIEWERS, VIEWS_PER_VISITOR)
const handlers = new Map<Socket, Connection>()
const allocation = create_allocation(ALLOCATION_OPTIONS)
const http_limiter = create_request_limiter(HTTP_DOOR)
/** An address dropped for cheating cools off before the door opens again. */
const bans = create_ban_list()
const indexing_health = create_indexing_health({
  chain_checkpoint: latest_checkpoint,
  indexed_state: pubsub.graph.indexed_state,
})
const game_state = create_game_state({ graph, pubsub: pubsub.graph })
await game_state.start()

// ── the cluster half: 20s-TTL pod snapshots union addresses across rolling replicas,
//    while the player_connect beacon evicts a duplicate login on ANOTHER pod ──
const resolve_name = create_suins_resolver({ client: sui_client })
const HEARTBEAT_MS = 5_000
setInterval(() => {
  void pubsub.mesh
    .heartbeat(SERVER_ID, {
      addresses: [...connections.keys()],
      characters: [...connections.values()].flatMap(({ player }) => player.online_characters()),
      agents: [...connections].flatMap(([address, { player }]) => (player.is_agent() ? [address] : [])),
      sockets: views.size() + connections.size,
    })
    .then(() => pubsub.mesh.cluster_online())
    .then((population) => pubsub.mesh.record_online(population, Date.now()))
    .catch((error: Error) => log.warn({ error: error.message }, 'heartbeat failed'))
}, HEARTBEAT_MS)

pubsub.mesh.emitter.on(mesh.player_connect, (payload) => {
  const { address, server_id } = payload as { address: string; server_id: string }
  if (server_id === SERVER_ID) return // same-pod eviction happens in promote()
  connections.get(address)?.ws.close(1008, 'ALREADY_CONNECTED')
})
void pubsub.mesh.subscribe(mesh.player_connect)

const wires = {
  allocation,
  graph,
  pubsub,
  public_world,
  public_market,
  game_state,
  indexing_health,
  resolve_name,
  /** one sampled leaderboard read per metric for every socket of this pod */
  leaderboards: create_leaderboards({ graph, pubsub, resolve_name }),
}

/** Mount a settled claim. An open or signed socket holds no place, so any number of them live
 *  beside the address's seat; the seat replaces its elder here and, by beacon, on other pods. */
const promote = (ws: Socket): Player | null => {
  const { claim } = ws.data
  if (claim.stage === 'open') return create_player({ ...wires, ws, claim, admin: false })
  const { address } = claim
  const account = { ...wires, ws, claim, admin: ADMIN_ADDRESSES.has(address), penalize: () => bans.ban(address) }
  if (claim.stage === 'signed') return create_player(account)
  if (connections.size >= MAX_PLAYERS && !connections.has(address)) return null
  connections.get(address)?.ws.close(1000, 'REPLACED')
  const player = create_player(account)
  connections.set(address, { ws, player })
  void pubsub.mesh.publish(mesh.player_connect, { address, server_id: SERVER_ID })
  log.info({ address }, 'player connected')
  return player
}

const http_routes = new Map<
  string,
  (request: Request, server: Readonly<import('bun').Server<SocketData>>) => Response | Promise<Response>
>([
  ['/health', () => new Response('ok')],
  ['/api/allocation', (request) => allocation.http(request)],
  [HERO_SHARE_PATH, (request) => hero_preview(request, graph, ALLOCATION_OPTIONS.origin)],
])
const rate_limited = () => new Response('rate limited', { status: 429 })
/** The public door: every request, the socket upgrade included, takes the visitor's own allowance
 * before any route. */
const route_of = (request: Request, pathname: string) =>
  admit_visitor(http_limiter, request) ? http_routes.get(pathname) : rate_limited
const release = ({ release_pending, release_view }: UpgradeHold): void => {
  release_pending()
  release_view()
}

const server = Bun.serve<SocketData>({
  port: PORT,
  maxRequestBodySize: 64 * 1024,
  async fetch(request, bun_server) {
    const url = new URL(request.url)
    const route = route_of(request, url.pathname)
    if (route) return route(request, bun_server)
    if (url.pathname !== '/') return new Response('not found', { status: 404 })

    const origin = request.headers.get('origin')?.replace(/\/+$/, '')
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response('origin refused', { status: 403 })
    const claim = read_claim(url.searchParams)
    if (!claim) return new Response('invalid claim', { status: 400 })
    if (claim.stage !== 'open' && bans.is_banned(claim.address)) return new Response('cooling off', { status: 403 })
    const hold = hold_upgrade(claim.stage, visitor_of(request), { pending, views })
    if (!hold) return new Response('too many connections', { status: 503 })
    try {
      if (bun_server.upgrade(request, { data: { claim, hold } })) return undefined
    } catch (error) {
      release(hold)
      throw error
    }
    release(hold)
    return new Response('upgrade failed', { status: 500 })
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    backpressureLimit: MAX_BUFFERED_BYTES,
    closeOnBackpressureLimit: true,
    open(ws: Socket) {
      handlers.set(
        ws,
        create_connection({
          claim: ws.data.claim,
          send: (packet) => void ws.send(JSON.stringify(packet)),
          close: (code, reason) => ws.close(code, reason),
          verify: verify_login,
          release_pending: ws.data.hold.release_pending,
          promote: () => promote(ws),
        })
      )
    },
    message(ws: Socket, raw) {
      void handlers.get(ws)?.on_message(raw)
    },
    // A close frame is the peer's word. It never bans: the cool-off is recorded where the server drops a player.
    close(ws: Socket) {
      const { claim, hold } = ws.data
      const handler = handlers.get(ws)
      if (handler) handler.on_close()
      else hold.release_pending()
      hold.release_view()
      handlers.delete(ws)
      if (claim.stage !== 'seated' || connections.get(claim.address)?.ws !== ws) return // an evicted elder closing late must not tear down its replacement
      connections.delete(claim.address)
      log.info({ address: claim.address }, 'player disconnected')
    },
  },
})

log.info({ port: server.port }, 'aresrpg server up — the one realtime door')
