// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { refreshed_world_anchor } from '../src/world_anchor.ts'

const presence = (world: string, x: number, z: number) =>
  ({ character_id: '0xc', world, x, y: 0, z, riding: false, pet: null }) as never

test('same-world rereads preserve validated walking while real travel resets it', () => {
  const move_anchor = { x: 130, z: 100, at_ms: 20, blocks: 4 }
  const existing = { presence: presence('nauvis', 130, 100), checkpoint: 'nauvis:100:100:30', move_anchor } as never
  expect(refreshed_world_anchor(existing, presence('nauvis', 100, 100), 30)).toMatchObject({
    presence: { world: 'nauvis', x: 130, z: 100 },
    move_anchor,
  })
  expect(refreshed_world_anchor(existing, presence('yakutia', 50, 60), 30)).toEqual({
    checkpoint: 'yakutia:50:60:30',
    presence: presence('yakutia', 50, 60),
    move_anchor: { x: 50, z: 60, at_ms: 30, blocks: 0 },
  })
})

test('recall resets a same-world walking anchor instead of preserving the old position', () => {
  const existing = {
    presence: presence('nauvis', 53_196, 50_000),
    checkpoint: 'nauvis:53196:50000:1',
    move_anchor: { x: 53_196, z: 50_000, at_ms: 10, blocks: 4 },
  } as never
  expect(refreshed_world_anchor(existing, presence('nauvis', 50_000, 50_000), 20)).toMatchObject({
    presence: { x: 50_000, z: 50_000 },
    move_anchor: { x: 50_000, z: 50_000, at_ms: 20, blocks: 0 },
  })
})

test('the roster advances the movement anchor before an equipment reread completes', async () => {
  const { default: player_world } = await import('../src/modules/player_world.ts')
  const existing = {
    presence: presence('nauvis', 53_196, 50_000),
    checkpoint: 'nauvis:53196:50000:1',
    move_anchor: { x: 53_196, z: 50_000, at_ms: 10, blocks: 4 },
  }
  const state = { characters: { '0xc': existing } } as never
  const row = { id: '0xc', world: 'nauvis', checkpoint_world: 'nauvis', x: 50_000, z: 50_000, at_ms: 20 }
  const next = player_world.reduce(state, { type: 'action/character_roster', characters: [row] } as never)
  expect(next.characters['0xc']).toMatchObject({
    checkpoint: 'nauvis:50000:50000:20',
    presence: { x: 50_000 },
    move_anchor: { x: 50_000, at_ms: 20 },
  })
  const moved = {
    ...next.characters['0xc']!,
    move_anchor: { x: 50_001, z: 50_000, at_ms: 30, blocks: 2 },
    presence: { ...next.characters['0xc']!.presence, x: 50_001 },
  }
  const reread = player_world.reduce({ ...next, characters: { '0xc': moved } }, {
    type: 'action/character_roster',
    characters: [row],
  } as never)
  expect(reread.characters['0xc']).toBe(moved)
})

test('late pre-recall movement is ignored; new-checkpoint walking works and overspeed still drops', async () => {
  const { EventEmitter } = await import('node:events')
  const { default: player_world } = await import('../src/modules/player_world.ts')
  const events = new EventEmitter()
  const abort = new AbortController()
  const dropped: string[] = []
  const dispatched: unknown[] = []
  const checkpoint = 'nauvis:50000:50000:20'
  player_world.observe({
    events,
    signal: abort.signal,
    graph: {},
    pubsub: { graph: {}, mesh: {} },
    address: '0xowner',
    send: () => {},
    dispatch: (action: unknown) => dispatched.push(action),
    drop: (reason: string) => dropped.push(reason),
    get_state: () => ({
      characters: {
        '0xc': {
          checkpoint,
          presence: presence('nauvis', 50_000, 50_000),
          move_anchor: { x: 50_000, z: 50_000, at_ms: Date.now(), blocks: 4 },
        },
      },
    }),
  } as never)
  try {
    const packet = {
      type: 'packet/position',
      character_id: '0xc',
      checkpoint: 'nauvis:53196:50000:1',
      x: 53_196,
      y: 0,
      z: 50_000,
      riding: false,
    }
    events.emit('packet/position', packet)
    expect(dropped).toEqual([])
    expect(dispatched).toEqual([])
    events.emit('packet/position', { ...packet, checkpoint, x: 50_001 })
    expect(dispatched).toHaveLength(1)
    expect(dropped).toEqual([])
    events.emit('packet/position', { ...packet, checkpoint })
    expect(dropped).toEqual(['SPEED'])
  } finally {
    abort.abort()
  }
})
