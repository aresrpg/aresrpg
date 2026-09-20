// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

test('WorldJoined moves subscriptions and delivers the destination scout without reconnecting', async () => {
  const fixture = wire({ character_ids: ['0xabc'] })
  let world = 'nauvis'
  let searched = false
  let anchor_ms = 1
  const graph = {
    ...fixture.graph,
    read: async (query: string, params?: Record<string, unknown>) => {
      if (query.includes(':Zone'))
        return searched
          ? [
              {
                zone: {
                  properties: {
                    world: params?.world,
                    zx: 0,
                    zz: 0,
                    seed: '7',
                    searched_at_ms: 100,
                    mob_taken: '0',
                    res_taken: [],
                  },
                },
              },
            ]
          : []
      const rows = await fixture.graph.read(query, params)
      return rows.map((row) =>
        'character' in row && row.character
          ? {
              ...row,
              character: {
                ...row.character,
                properties: {
                  ...row.character.properties,
                  world,
                  at_ms: anchor_ms,
                  checkpoint_world: world,
                },
              },
            }
          : row
      )
    },
  }
  const player = create_player({ ws: fixture.ws, address: '0xme', admin: false, graph, pubsub: fixture.pubsub })
  try {
    await flush()
    await flush()
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/tracked_zones').at(-1)).toMatchObject({
      world: 'nauvis',
    })
    world = 'yakutia'
    fixture.pubsub.emitter.emit('evt:character:0xabc', {
      type: 'WorldJoined',
      data: { character: '0xabc', world, x: 100, z: 100 },
    })
    await flush()
    await flush()
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/tracked_zones').at(-1)).toMatchObject({
      world: 'yakutia',
    })
    expect(
      fixture.published.some(({ channel, payload }) => channel === 'pos:nauvis:0:0' && payload.kind === 'leave')
    ).toBeTrue()
    searched = true
    anchor_ms = 200
    fixture.pubsub.emitter.emit('evt:character:0xabc', {
      type: 'CharacterCheckpointChanged',
      data: { character: '0xabc' },
    })
    fixture.pubsub.emitter.emit('evt:zone:yakutia:0:0', { type: 'ZoneSearched', data: { world, zone_x: 0, zone_z: 0 } })
    await flush()
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/characters').at(-1)).toMatchObject({
      characters: [{ world: 'yakutia', at_ms: 200 }],
    })
    expect(fixture.sent.filter((packet) => packet.type === 'packet/zones').at(-1)).toMatchObject({
      zones: [{ world: 'yakutia' }],
    })
    expect(fixture.sent.some((packet) => packet.type === 'packet/zone_spawns' && packet.world === 'yakutia')).toBeTrue()
    world = 'nauvis'
    anchor_ms = 300
    fixture.pubsub.emitter.emit('evt:character:0xabc', {
      type: 'WorldJoined',
      data: { character: '0xabc', world, x: 100, z: 100, first_join: false },
    })
    await flush()
    await flush()
    expect(fixture.sent.filter((packet) => packet.type === 'packet/characters').at(-1)).toMatchObject({
      characters: [{ world: 'nauvis', checkpoint_world: 'nauvis', at_ms: 300 }],
    })
    expect(fixture.sent.filter((packet) => packet.type === 'packet/tracked_zones').at(-1)).toMatchObject({
      world: 'nauvis',
    })
  } finally {
    player.on_close()
  }
}, 15_000)

test('travel retires pending source-world subscriptions before their continuations resume', async () => {
  const fixture = wire({ character_ids: ['0xabc'] })
  const pending = Promise.withResolvers<void>()
  let world = 'nauvis'
  fixture.pubsub.mesh.subscribe = async (channel) => {
    if (channel.startsWith('pos:nauvis:')) await pending.promise
  }
  const graph = {
    ...fixture.graph,
    read: async (query: string, params?: Record<string, unknown>) => {
      const rows = await fixture.graph.read(query, params)
      return rows.map((row) =>
        'character' in row && row.character
          ? {
              ...row,
              character: {
                ...row.character,
                properties: { ...row.character.properties, world, checkpoint_world: world },
              },
            }
          : row
      )
    },
  }
  const player = create_player({ ...fixture, graph, address: '0xme', admin: false })
  try {
    await flush()
    world = 'yakutia'
    fixture.pubsub.emitter.emit('evt:character:0xabc', { type: 'WorldJoined', data: { character: '0xabc', world } })
    await flush()
    await flush()
    fixture.published.length = 0
    pending.resolve()
    await flush()
    await flush()
    expect(fixture.pubsub.emitter.eventNames().some((name) => String(name).startsWith('evt:zone:nauvis:'))).toBeFalse()
    expect(
      fixture.published.some(({ payload }) => payload.kind === 'appear' && payload.player.world === 'nauvis')
    ).toBeFalse()
  } finally {
    pending.resolve()
    player.on_close()
  }
})
