// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local browser diagnostic: real player reducers, mesh discovery and websocket output; indexed facts are fixtures.
import { writeFileSync } from 'node:fs'

import type { ServerWebSocket } from 'bun'

import type { Player } from '../src/player.ts'

import { create_player } from './helpers/player.ts'
import { wire } from './helpers/world_wire.ts'

export const start_glide_relay = () => {
  const shared = wire({ pet: true })
  const actors = new Map<ServerWebSocket<{ id: string }>, Player>()
  let captured = false
  const anchor_ms = 1791720000000
  const server = Bun.serve<{ id: string }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => {
      const id = new URL(request.url).searchParams.get('id')
      if ((id === '0xabc' || id === '0xdef') && server.upgrade(request, { data: { id } })) return
      return new Response('Glide diagnostic websocket', { status: 400 })
    },
    websocket: {
      open: (socket) => {
        const harness = wire({ pet: true, character_ids: [socket.data.id], shared_pubsub: shared.pubsub })
        const { read } = harness.graph
        const x = socket.data.id === '0xabc' ? 50_000 : 50_004
        harness.graph.read = async (query, params) => {
          if (query.includes('RETURN e.slot AS slot')) return [{ slot: 'pet', item_type: 'beru' }] as never
          const rows = await read(query, params)
          return rows.map((row) => {
            const character = ('character' in row ? row.character : undefined) as
              { properties: Record<string, unknown> } | undefined
            if (!character) return row
            return {
              ...row,
              character: {
                properties: {
                  ...character.properties,
                  world: 'nauvis',
                  checkpoint_world: 'nauvis',
                  x,
                  z: 50_000,
                  at_ms: anchor_ms,
                },
              },
              worn: [{ slot: 'pet', item_type: 'beru' }],
            }
          }) as never
        }
        const player = create_player({ ...harness, ws: socket, address: `owner-${socket.data.id}`, admin: false })
        actors.set(socket, player)
      },
      message: (socket, data) => {
        const raw = data.toString()
        const packet = JSON.parse(raw) as { type?: string; gliding?: boolean }
        if (!captured && packet.type === 'packet/position' && packet.gliding) {
          writeFileSync('test-results/gliding-position.json', raw)
          captured = true
        }
        actors.get(socket)?.on_message(raw)
      },
      close: (socket) => {
        actors.get(socket)?.on_close()
        actors.delete(socket)
      },
    },
  })
  console.log(`GLIDE_RELAY_PORT=${server.port}`)
  process.on('SIGTERM', () => {
    actors.forEach((player) => player.on_close())
    server.stop(true)
    process.exit(0)
  })
}

if (import.meta.main) start_glide_relay()
