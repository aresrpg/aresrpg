// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world module (synchronizer port): embody mounts the tracked spiral and pushes the world;
// crossing a zone boundary re-centers and publishes presence on the mesh; an impossible move
// drops the connection. Ownership is enforced at the read — a foreign character never mounts.

import { EventEmitter } from 'node:events'

import { describe, expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_player } from '../src/player.ts'

const make_character = ({ pet = false } = {}) => ({
  properties: {
    id: '0xabc',
    pet,
    name: 'nox',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    color_1: 1,
    color_2: 2,
    color_3: 3,
    world: 'overworld',
    checkpoint_world: 'overworld',
    x: 100,
    z: 100,
    spells: '{}',
    spell_points_spent: 0,
  },
})
const character = make_character()

const wire = ({ owns = true, pet = false, friends = [] as string[] } = {}) => {
  const sent: ServerPacket[] = []
  const dropped: string[] = []
  const ws = {
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: (_c?: number, reason?: string) => dropped.push(reason ?? ''),
  }
  const graph = {
    read: async (cypher: string, _params?: Record<string, unknown>) => {
      if (cypher.includes(':Character {id:'))
        return owns
          ? [
              {
                character: make_character(),
                held_kiosk: '0xk',
                kiosk: '0xk',
                fight: null,
                party: null,
                worn: pet ? [{ slot: 'pet', item_type: 'bulbiflor' }] : [],
              },
            ]
          : []
      if (cypher.includes(':FRIEND')) return friends.map((friend) => ({ address: friend, characters: [] }))
      if (cypher.includes('HOLDS_CLAIM') || cypher.includes('HOLDS_VOUCHER') || cypher.includes('CAN_BUY')) return []
      if (cypher.includes('LISTED_IN')) return []
      if (cypher.includes(':Zone')) return [{ zone: { properties: { world: 'overworld', zx: 0, zz: 0, seed: '7' } } }]
      if (cypher.includes(':Fight')) return []
      return [{ character, kiosk: '0xk', equipment: [], item: { properties: {} }, label: 'User', count: 1 }]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  const published: { channel: string; payload: any }[] = []
  const pubsub = {
    emitter,
    heartbeat: async () => {},
    cluster_online: async () => 1,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      published.push({ channel, payload })
      emitter.emit(channel, payload) // loopback so a second connection would see it
    },
    close: () => {},
  }
  return { sent, ws, graph, pubsub, published, dropped }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the world module', () => {
  test('embody mounts the spiral and pushes zones + an appearance on the mesh', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    expect(sent.some((packet) => packet.type === 'packet/zones')).toBe(true)
    expect(published.some(({ payload }) => payload.kind === 'appear')).toBe(true)
  })

  test('nothing folds at packet ARRIVAL — the mount waits for the validation dispatch', async () => {
    const { ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    // synchronously after arrival: the reducer folded nothing, no effect fired yet
    expect(published).toHaveLength(0)
    await flush()
    expect(published.some(({ payload }) => payload.kind === 'appear')).toBe(true)
  })

  test('a foreign character never mounts — ownership is enforced at the read', async () => {
    const { sent, ws, graph, pubsub, published } = wire({ owns: false })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xdead' }))
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/error')).toEqual({
      type: 'packet/error',
      reason: 'not your character',
    })
    expect(published.some(({ payload }) => payload.kind === 'appear')).toBe(false)
  })

  test('an impossible move drops the connection', async () => {
    const { ws, graph, pubsub, dropped } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    // 10,000 blocks in one tick — far past any authored budget
    player.on_message(JSON.stringify({ type: 'packet/position', x: 10100, y: 0, z: 100 }))
    expect(dropped).toEqual(['SPEED'])
  })

  test('the speed ceiling is the AUTHORED one — mounted passes what unmounted drops', async () => {
    // 14 blocks in ~1s: above 11.5 (walk), below 17.25 (mounted)
    const walker = wire()
    const walking = create_player({
      ws: walker.ws,
      address: '0xme',
      admin: false,
      graph: walker.graph,
      pubsub: walker.pubsub,
    })
    await flush()
    walking.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    // 0.7 blocks inside the 50ms clamp window: 14 b/s — above 11.5 (walk), below 17.25 (mounted)
    walking.on_message(JSON.stringify({ type: 'packet/position', x: 100.7, y: 0, z: 100 }))
    expect(walker.dropped).toEqual(['SPEED'])

    const rider = wire({ pet: true })
    const riding = create_player({
      ws: rider.ws,
      address: '0xme',
      admin: false,
      graph: rider.graph,
      pubsub: rider.pubsub,
    })
    await flush()
    riding.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    riding.on_message(JSON.stringify({ type: 'packet/position', x: 100.7, y: 0, z: 100 }))
    expect(rider.dropped).toEqual([])
  })

  test('visibility caps at 100 strangers — friends ALWAYS pass', async () => {
    const { sent, ws, graph, pubsub } = wire({ friends: ['0xbestie'] })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    const appear = (index: number, address: string) =>
      pubsub.emitter.emit('pos:overworld:0:0', {
        kind: 'appear',
        address,
        player: {
          character_id: `0xp${index}`,
          name: `p${index}`,
          classe: 'senshi',
          sex: 'male',
          level: 1,
          color_1: 0,
          color_2: 0,
          color_3: 0,
          pet: false,
          x: 100,
          y: 0,
          z: 100,
        },
      })
    for (let index = 0; index < 120; index++) appear(index, `0xstranger${index}`)
    appear(999, '0xbestie') // the friend arrives past the cap
    const appeared = sent.filter((packet) => packet.type === 'packet/player_appeared')
    expect(appeared).toHaveLength(101) // 100 strangers + the friend
    // an uncapped stranger's move flows; a capped one's is silent
    pubsub.emitter.emit('pos:overworld:0:0', {
      kind: 'move',
      character_id: '0xp5',
      address: '0xstranger5',
      x: 1,
      y: 0,
      z: 1,
    })
    pubsub.emitter.emit('pos:overworld:0:0', {
      kind: 'move',
      character_id: '0xp115',
      address: '0xstranger115',
      x: 1,
      y: 0,
      z: 1,
    })
    const moves = sent.filter((packet) => packet.type === 'packet/player_moved')
    expect(moves.map((move) => (move as { character_id: string }).character_id)).toEqual(['0xp5'])
  })

  test('a plausible move within the zone publishes a move fact, not a re-track', async () => {
    const { graph, ws, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
    await flush()
    published.length = 0
    player.on_message(JSON.stringify({ type: 'packet/position', x: 100.3, y: 0, z: 100.3 }))
    expect(published.every(({ payload }) => payload.kind === 'move')).toBe(true)
  })
})
