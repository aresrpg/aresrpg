// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import { channels } from '../src/protocol.ts'

import { create_player } from './helpers/player.ts'
import { wire } from './helpers/world_wire.ts'

// Real loopback WebSockets and production player modules; graph and Redis are isolated fixtures.
test('title equipment reaches observers, late joiners and reconnects over separate sockets', async () => {
  const owner = wire({ character_ids: ['hero'] })
  const equipment = { title: null as string | null }
  const gear = () => [
    { slot: 'cosmetic_hat', item_type: 'solomonk' },
    { slot: 'cosmetic_cloak', item_type: 'cape_fuwa__black' },
    ...(equipment.title ? [{ slot: 'title', item_type: equipment.title }] : []),
  ]
  const players = new Map<string, ReturnType<typeof create_player>>()
  const server = Bun.serve<{ id: string }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, runtime) => {
      const id = new URL(request.url).pathname.slice(1)
      return runtime.upgrade(request, { data: { id } }) ? undefined : new Response('Upgrade required', { status: 400 })
    },
    websocket: {
      open: (socket) => {
        const { id } = socket.data
        const fixture = id === 'hero' ? owner : wire({ character_ids: [id], shared_pubsub: owner.pubsub })
        const { read } = fixture.graph
        const graph = {
          ...fixture.graph,
          read: async (query: string, params?: Record<string, unknown>) => {
            if (query.includes('(t:Tournament)')) return []
            if (query.includes('RETURN e.slot')) return (params?.character === 'hero' ? gear() : []) as never
            const rows = await read(query, params)
            return query.includes(':Character {id:') && params?.character_id === 'hero'
              ? (rows.map((row) => ({ ...row, worn: gear() })) as never)
              : rows
          },
        }
        players.set(id, create_player({ ...fixture, graph, ws: socket, address: `owner_${id}`, admin: false }))
      },
      message: (socket, raw) => players.get(socket.data.id)!.on_message(raw),
      close: (socket) => {
        players.get(socket.data.id)?.on_close()
        players.delete(socket.data.id)
      },
    },
  })
  const sockets: WebSocket[] = []
  const connect = (id: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/${id}`)
    sockets.push(socket)
    const packets: ServerPacket[] = []
    socket.addEventListener('message', ({ data }) => packets.push(JSON.parse(String(data))))
    return packets
  }
  const wait_for = async (packets: ServerPacket[], predicate: (packet: ServerPacket) => boolean) => {
    const deadline = Date.now() + 3000
    while (!packets.some(predicate) && Date.now() < deadline) await Bun.sleep(5)
    expect(packets.some(predicate)).toBe(true)
    return packets.filter(predicate).at(-1)!
  }
  const appeared = (packet: ServerPacket) =>
    packet.type === 'packet/player_appeared' && packet.player.character_id === 'hero'
  const title_is = (title: string | null) => (packet: ServerPacket) =>
    packet.type === 'packet/player_equipment' &&
    packet.character_id === 'hero' &&
    packet.slot === 'title' &&
    packet.item_type === title
  const change = (title: string | null) => {
    equipment.title = title
    owner.pubsub.graph.emitter.emit(channels.character('hero'), {
      type: title ? 'ItemEquipped' : 'ItemUnequipped',
      data: { character: 'hero', slot: 'title' },
    })
  }
  try {
    connect('hero')
    const observer = connect('observer')
    expect(await wait_for(observer, appeared)).toMatchObject({ player: { title: null } })
    change('title_veteran')
    await wait_for(observer, title_is('title_veteran'))
    const equipped_packets = structuredClone(observer)
    const late = connect('late')
    expect(await wait_for(late, appeared)).toMatchObject({
      player: {
        title: 'title_veteran',
        cosmetic_hat: 'solomonk',
        cosmetic_cloak: 'cape_fuwa__black',
      },
    })
    sockets[1]!.close()
    const closed = new Promise<void>((resolve) =>
      sockets[1]!.addEventListener('close', () => resolve(), { once: true })
    )
    await closed
    const reconnected = connect('observer')
    expect(await wait_for(reconnected, appeared)).toMatchObject({ player: { title: 'title_veteran' } })
    const late_packets = structuredClone(late)
    const reconnect_packets = structuredClone(reconnected)
    change(null)
    await Promise.all([late, reconnected].map((packets) => wait_for(packets, title_is(null))))
    if (process.env.TITLE_SOCKET_CAPTURE)
      await writeFile(
        process.env.TITLE_SOCKET_CAPTURE,
        JSON.stringify({
          equipped: equipped_packets,
          late: late_packets,
          reconnected: reconnect_packets,
          unequipped: reconnected,
        })
      )
  } finally {
    sockets.forEach((socket) => socket.close())
    players.forEach((player) => player.on_close())
    players.clear()
    await server.stop(true)
  }
})
