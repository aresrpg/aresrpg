// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { movement_listener_channel } from '../src/protocol.ts'
import { create_public_world } from '../src/public_world.ts'
import type { Pubsub } from '../src/pubsub_bus.ts'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

test('a nearby login burst hydrates each public identity once and directs discovery replies', async () => {
  const count = 100
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  const bus = {
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    close: () => {},
    publish: async (channel: string, payload: unknown) => {
      emitter.emit(channel, payload)
    },
  }
  const pubsub: Pubsub = {
    graph: { ...bus, indexed_checkpoint: async () => 1, sales_history: async () => [] },
    mesh: { ...bus, heartbeat: async () => {}, cluster_online: async () => count },
  }
  let equipment_reads = 0
  const public_world = create_public_world(
    {
      read: async (query) => {
        if (query.includes('RETURN e.slot')) equipment_reads++
        return []
      },
      close: async () => {},
    },
    pubsub.graph
  )
  const clients = Array.from({ length: count }, (_, index) => {
    const id = `0x${(index + 1).toString(16).padStart(64, '0')}`
    const fixture = wire({ character_ids: [id], shared_pubsub: pubsub })
    return { ...fixture, player: create_player({ ...fixture, public_world, address: id, admin: false }) }
  })
  try {
    await flush()
    await flush()
    await flush()
    expect(equipment_reads).toBe(count)
    clients.forEach(({ sent }) => {
      const arrivals = sent.filter((packet) => packet.type === 'packet/player_appeared')
      expect(new Set(arrivals.map((packet) => packet.player.character_id)).size).toBe(count - 1)
      expect(arrivals.length).toBeLessThanOrEqual(2 * (count - 1))
    })
  } finally {
    clients.forEach(({ player }) => player.on_close())
  }
  await flush()
  expect(emitter.eventNames()).toEqual([])
})

test('a stale mesh appearance cannot undo indexed gear or restart hydration', async () => {
  const fixture = wire({ character_ids: ['own'] })
  let hat = 'mokan'
  let reads = 0
  const public_world = create_public_world(
    {
      read: async (query) => {
        if (!query.includes('RETURN e.slot')) return []
        reads++
        return [{ slot: 'hat', item_type: hat }]
      },
      close: async () => {},
    },
    fixture.pubsub.graph
  )
  const player = create_player({ ...fixture, public_world, address: 'owner', admin: false })
  const appearance = {
    kind: 'appear',
    address: 'other',
    player: {
      character_id: 'other',
      world: 'overworld',
      x: 100,
      y: 0,
      z: 100,
      hat: 'stale',
      cloak: null,
      pet: null,
      riding: false,
    },
  }
  try {
    await flush()
    fixture.pubsub.emitter.emit('pos:overworld:0:0', appearance)
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/player_appeared').at(-1)?.player.hat).toBe('mokan')
    hat = 'fud'
    fixture.pubsub.emitter.emit('evt:character:other', {
      type: 'ItemEquipped',
      data: { character: 'other', slot: 'hat' },
    })
    await flush()
    const before = reads
    fixture.pubsub.emitter.emit('pos:overworld:0:0', appearance)
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/player_appeared').at(-1)?.player.hat).toBe('fud')
    expect(reads).toBe(before)
  } finally {
    player.on_close()
  }
})

test('failed appearance hydration closes the session so reconnect can recover without an equipment event', async () => {
  const fixture = wire({ character_ids: ['own'] })
  let unavailable = true
  const public_world = create_public_world(
    {
      read: async (_query, params) => {
        if (params?.character === 'remote' && unavailable) throw new Error('temporary read failure')
        return []
      },
      close: async () => {},
    },
    fixture.pubsub.graph
  )
  const mount = () => create_player({ ...fixture, public_world, address: 'owner', admin: false })
  const appearance = {
    kind: 'appear',
    address: 'remote_owner',
    player: {
      character_id: 'remote',
      world: 'overworld',
      x: 100,
      y: 0,
      z: 100,
      riding: false,
    },
  }
  const first = mount()
  await flush()
  fixture.pubsub.emitter.emit('pos:overworld:0:0', appearance)
  await flush()
  first.on_close()
  expect(fixture.dropped).toContain('SNAPSHOT_FAILED')
  unavailable = false
  const second = mount()
  try {
    await flush()
    fixture.pubsub.emitter.emit('pos:overworld:0:0', appearance)
    await flush()
    expect(
      fixture.sent.some((packet) => packet.type === 'packet/player_appeared' && packet.player.character_id === 'remote')
    ).toBeTrue()
  } finally {
    second.on_close()
  }
})

test('targeted movement respects hydration, retired zones, world replacement and disconnect', async () => {
  const fixture = wire({ character_ids: ['own'] })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const public_world = create_public_world(
    {
      read: async (_query, params) => {
        if (params?.character === 'remote') await pending
        return []
      },
      close: async () => {},
    },
    fixture.pubsub.graph
  )
  const player = create_player({ ...fixture, public_world, address: 'owner', admin: false })
  const zone = 'pos:overworld:0:0'
  const channel = movement_listener_channel(zone, 'remote')
  const appear = {
    kind: 'appear',
    address: 'other',
    player: {
      character_id: 'remote',
      world: 'overworld',
      x: 100,
      y: 0,
      z: 100,
      riding: false,
    },
  }
  const move = { kind: 'move', address: 'other', character_id: 'remote', x: 104, y: 0, z: 100, riding: true }
  try {
    await flush()
    fixture.pubsub.emitter.emit(zone, appear)
    expect(fixture.pubsub.emitter.listenerCount(channel)).toBe(1)
    fixture.pubsub.emitter.emit(zone, move)
    release()
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/player_appeared').at(-1)?.player).toMatchObject({
      x: 104,
      riding: true,
    })
    // Capture an already-dispatched callback: removing a listener alone cannot retire that reference.
    const old_callback = fixture.pubsub.emitter.listeners(channel)[0]!
    fixture.pubsub.emitter.emit(zone, { kind: 'leave', address: 'other', character_id: 'remote' })
    expect(fixture.pubsub.emitter.listenerCount(channel)).toBe(0)
    fixture.pubsub.emitter.emit(zone, appear)
    old_callback(move)
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/player_appeared').at(-1)?.player.x).toBe(100)
    const before = fixture.sent.length
    // Another world and another zone cannot reach this identity's current listener.
    fixture.pubsub.emitter.emit('pos:yakutia:0:0', move)
    fixture.pubsub.emitter.emit('pos:overworld:1:0', move)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fixture.sent.length).toBe(before)
    player.dispatch({
      type: 'action/move',
      character_id: 'own',
      x: 3000,
      y: 0,
      z: 100,
      riding: false,
      at_ms: Date.now(),
      budget_blocks: 0,
    })
    await flush()
    expect(fixture.pubsub.emitter.listenerCount(channel)).toBe(0)
  } finally {
    release()
    player.on_close()
  }
  expect(fixture.pubsub.emitter.eventNames().filter((name) => String(name).startsWith('local:pos:'))).toEqual([])
})
