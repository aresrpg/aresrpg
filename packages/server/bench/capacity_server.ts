// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Opt-in local workload: real production player modules, graph reads and Redis buses.
// Authentication and checkpoint ingestion are deliberately outside this measurement.
import { monitorEventLoopDelay } from 'node:perf_hooks'

import { FalkorDB } from 'falkordb'
import { Redis } from 'ioredis'

import { create_player, type Player } from '../src/player.ts'
import { create_graph_bus, create_mesh_bus } from '../src/pubsub_bus.ts'
import { create_public_world } from '../src/public_world.ts'
import { create_public_market } from '../src/public_market.ts'
import { MAX_BUFFERED_BYTES } from '../src/player_output.ts'
import type { Graph, GraphRow } from '../src/graph.ts'

const [url, name, raw_port] = process.argv.slice(2)
if (!url?.startsWith('redis://127.0.0.1:') || !name?.startsWith('capacity_'))
  throw new Error('Local scratch database required')
const db = await FalkorDB.connect({ url })
const store = db.selectGraph(name)
const queries = new Map<string, { count: number; ms: number; max_ms: number }>()
const graph: Graph = {
  read: async (query, params) => {
    const started = performance.now()
    const key = query.replace(/\s+/g, ' ').trim()
    const result = await store.roQuery(query, { params })
    const ms = performance.now() - started
    const prior = queries.get(key) ?? { count: 0, ms: 0, max_ms: 0 }
    queries.set(key, { count: prior.count + 1, ms: prior.ms + ms, max_ms: Math.max(prior.max_ms, ms) })
    return (result.data ?? []) as GraphRow[]
  },
  close: () => db.close(),
}
const pubsub = {
  graph: create_graph_bus({
    subscriber: new Redis(url),
    publisher: new Redis(url),
    item_graph: graph,
    on_lost: () => process.exit(2),
  }),
  mesh: create_mesh_bus({ subscriber: new Redis(url), publisher: new Redis(url) }),
}
const public_world = create_public_world(graph, pubsub.graph)
const public_market = create_public_market(graph, pubsub.graph)
const players = new Map<unknown, Player>()
const metrics = { frames: 0, bytes: 0, incoming: 0, peak_buffer: 0, closed: {} as Record<string, number> }
const delay = monitorEventLoopDelay({ resolution: 10 })
delay.enable()
const started = performance.now()
const cpu = process.cpuUsage()
const server = Bun.serve<{ address: string }>({
  hostname: '127.0.0.1',
  port: Number(raw_port),
  fetch(request, server) {
    const request_url = new URL(request.url)
    if (request_url.pathname === '/stats')
      return Response.json({
        ...metrics,
        connections: players.size,
        elapsed_ms: performance.now() - started,
        cpu: process.cpuUsage(cpu),
        memory: process.memoryUsage(),
        loop_p95_ms: delay.percentile(95) / 1e6,
        loop_max_ms: delay.max / 1e6,
        queries: Object.fromEntries(queries),
      })
    const address = request_url.searchParams.get('address')
    if (!address || !/^0x[0-9a-f]{64}$/.test(address)) return new Response('invalid local identity', { status: 400 })
    return server.upgrade(request, { data: { address } }) ? undefined : new Response('failed', { status: 400 })
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    backpressureLimit: MAX_BUFFERED_BYTES,
    closeOnBackpressureLimit: true,
    open(ws) {
      players.set(
        ws,
        create_player({
          address: ws.data.address,
          admin: false,
          graph,
          pubsub,
          public_world,
          public_market,
          ws: {
            send: (raw) => {
              metrics.frames++
              metrics.bytes += Buffer.byteLength(raw)
              return ws.send(raw)
            },
            close: (code, reason) => ws.close(code, reason),
            getBufferedAmount: () => {
              const bytes = ws.getBufferedAmount()
              metrics.peak_buffer = Math.max(metrics.peak_buffer, bytes)
              return bytes
            },
          },
          game_state: { get: () => false, listen: () => () => {}, start: async () => {} },
          indexing_health: async () => ({
            lag: 0,
            epoch: '1',
            chain_timestamp_ms: Date.now(),
            chain_observed_at_ms: performance.now(),
          }),
        })
      )
    },
    message(ws, raw) {
      metrics.incoming++
      players.get(ws)?.on_message(raw)
    },
    close(ws, code, reason) {
      metrics.closed[`${code}:${reason}`] = (metrics.closed[`${code}:${reason}`] ?? 0) + 1
      players.get(ws)?.on_close()
      players.delete(ws)
    },
  },
})
console.log(JSON.stringify({ ready: server.port }))
const heartbeat = setInterval(
  () =>
    void pubsub.mesh.heartbeat(
      `${name}_${raw_port}`,
      [...players.keys()].map((socket) => (socket as { data: { address: string } }).data.address)
    ),
  5000
)
process.on('SIGTERM', () => {
  clearInterval(heartbeat)
  players.forEach((player) => player.on_close())
  server.stop(true)
  pubsub.graph.close()
  pubsub.mesh.close()
  void db.close().finally(() => process.exit(0))
})
