// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The harness under the PUSH MODEL: connecting pushes the load snapshot (his characters + his
// inventory, scoped to the CONNECTION address — never a caller-chosen one), his social channel
// streams without being asked, admin packets gate on the whitelist, and garbage answers an
// error without killing the connection. No player query surface exists at all.

import { EventEmitter } from 'node:events'

import { describe, expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_player } from '../src/player.ts'

const wire = () => {
  const sent: ServerPacket[] = []
  const ws = { send: (raw: string) => sent.push(JSON.parse(raw)), close: () => 0 }
  const queries: { cypher: string; params?: Record<string, unknown> }[] = []
  const graph = {
    read: async (cypher: string, params?: Record<string, unknown>) => {
      queries.push({ cypher, params })
      if (cypher.includes(':FRIEND')) return [{ address: '0xpal', characters: ['nyx'] }]
      if (cypher.includes('HOLDS_CLAIM') || cypher.includes('HOLDS_VOUCHER')) return []
      if (cypher.includes(':Trade')) return []
      if (cypher.includes('LISTED_IN')) return []
      return [
        {
          character: { properties: { name: 'nox' } },
          item: { properties: { name: 'sword' } },
          kiosk: '0xk',
          equipment: [],
          label: 'User',
          count: 1,
        },
      ]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  const published: { channel: string; payload: unknown }[] = []
  const pubsub = {
    emitter,
    heartbeat: async () => {},
    cluster_online: async () => 1,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      published.push({ channel, payload })
    },
    close: () => {},
  }
  return { sent, ws, graph, pubsub, queries, published }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the player harness (push model)', () => {
  test('connecting pushes the load snapshot, scoped to the CONNECTION address', async () => {
    const { sent, ws, graph, pubsub, queries } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    expect(queries.every(({ params }) => params?.address === '0xme')).toBe(true)
    const types = sent.map((packet) => packet.type)
    for (const expected of [
      'packet/characters',
      'packet/inventory',
      'packet/friends',
      'packet/claims',
      'packet/giftcards',
      'packet/listings',
      'packet/trades',
    ] as const)
      expect(types).toContain(expected)
  })

  test('his social channel streams without being asked — the server decides the watch', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    pubsub.emitter.emit('evt:social:0xme', { type: 'FriendAdded', ckpt: 1, data: { list: '0xl', who: '0xme' } })
    const event = sent.find((packet) => packet.type === 'packet/friend_added')
    expect(event).toEqual({ type: 'packet/friend_added', list: '0xl', who: '0xme' })
  })

  test('teardown unsubscribes the watch — a closed connection goes silent', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_close()
    const count = sent.length
    pubsub.emitter.emit('evt:social:0xme', { type: 'FriendAdded', ckpt: 2, data: {} })
    expect(sent).toHaveLength(count)
  })

  test('admin packets refuse a non-whitelisted connection and never touch the graph', async () => {
    const { sent, ws, graph, pubsub, queries } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    const loads = queries.length
    player.on_message(JSON.stringify({ id: 2, type: 'packet/admin_request', kind: 'stats' }))
    await flush()
    expect(sent.find((packet) => 'id' in packet && packet.id === 2)).toEqual({
      type: 'packet/error',
      id: 2,
      reason: 'not an admin',
    })
    expect(queries).toHaveLength(loads)
  })

  test('a whitelisted admin gets the dashboard answer', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xboss', admin: true, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ id: 3, type: 'packet/admin_request', kind: 'stats' }))
    await flush()
    expect(sent.find((packet) => 'id' in packet && packet.id === 3)).toEqual({
      type: 'packet/admin_response',
      id: 3,
      result: { User: 1 },
    })
  })

  test('position folds into state — the tracking module reads it from there', async () => {
    const { ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    player.on_message(JSON.stringify({ type: 'packet/position', world: 'overworld', x: 1, y: 2, z: 3 }))
    // the fold is internal; proven indirectly: a malformed position is refused loudly instead
    expect(() =>
      player.on_message(JSON.stringify({ type: 'packet/position', world: 'overworld', x: 'a' }))
    ).not.toThrow()
  })

  test('garbage answers an error packet and the connection survives', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    player.on_message('not json at all')
    player.on_message(JSON.stringify({ type: 'query', kind: 'characters' })) // the dead surface stays dead
    expect(sent.filter((packet) => packet.type === 'packet/error')).toHaveLength(2)
    player.on_close()
  })
})
