// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import player_tournament from '../../src/modules/player_tournament.ts'
import { channels } from '../../src/protocol.ts'
import type { PlayerContext } from '../../src/player.ts'

const harness = (subscription_fails = false) => {
  const chain = new EventEmitter()
  const controller = new AbortController()
  const packets: ServerPacket[] = []
  const reads: ReturnType<typeof Promise.withResolvers<never[]>>[] = []
  player_tournament.observe({
    address: 'owner',
    signal: controller.signal,
    send: (packet: ServerPacket) => packets.push(packet),
    graph: {
      read: () => {
        const next = Promise.withResolvers<never[]>()
        reads.push(next)
        return next.promise
      },
    },
    pubsub: {
      graph: {
        emitter: chain,
        subscribe: async () => {
          if (subscription_fails) throw new Error('subscribe failed')
        },
        unsubscribe: async () => {},
      },
    },
  } as unknown as PlayerContext)
  return { chain, controller, packets, reads }
}

test('failed feed reads report unavailable and a later successful empty read is delivered', async () => {
  const h = harness()
  try {
    await Bun.sleep(0)
    h.reads[0].reject(new Error('graph offline'))
    await Bun.sleep(0)
    expect(h.packets).toEqual([{ type: 'packet/tournaments_error', reason: 'unavailable' }])
    h.chain.emit(channels.tournament)
    await Bun.sleep(0)
    h.reads[1].resolve([])
    await Bun.sleep(0)
    expect(h.packets[1]).toEqual({ type: 'packet/tournaments', tournaments: [] })
  } finally {
    h.controller.abort()
  }
})

test('a slow old failure cannot replace a newer successful feed', async () => {
  const h = harness()
  try {
    await Bun.sleep(0)
    h.chain.emit(channels.tournament)
    await Bun.sleep(0)
    expect(h.reads).toHaveLength(1)
    h.reads[0].reject(new Error('stale failure'))
    await Bun.sleep(0)
    h.reads[1].resolve([])
    await Bun.sleep(0)
    expect(h.packets).toEqual([{ type: 'packet/tournaments', tournaments: [] }])
  } finally {
    h.controller.abort()
  }
})

test('disposal suppresses outstanding delivery and subscription failure reports unavailable', async () => {
  const h = harness()
  await Bun.sleep(0)
  h.controller.abort()
  h.reads[0].resolve([])
  await Bun.sleep(0)
  expect(h.packets).toEqual([])
  const failed = harness(true)
  try {
    await Bun.sleep(0)
    expect(failed.packets).toEqual([{ type: 'packet/tournaments_error', reason: 'unavailable' }])
    expect(failed.reads).toHaveLength(0)
  } finally {
    failed.controller.abort()
  }
})

// Audit RT-1: one PTB of cheap donations emits hundreds of tournament events. Each connection
// coalesces them into one active read plus one rerun, never one graph read per event.
test('a burst of tournament events costs each connection at most one rerun', async () => {
  const connections = Array.from({ length: 20 }, () => harness())
  const pending = () => connections.flatMap(({ reads }) => reads)
  try {
    await Bun.sleep(0)
    for (const read of pending()) read.resolve([])
    await Bun.sleep(0)
    const baseline = pending().length
    for (let index = 0; index < 101; index += 1) for (const { chain } of connections) chain.emit(channels.tournament)
    for (let round = 0; round < 3; round += 1) {
      await Bun.sleep(0)
      for (const read of pending().slice(baseline)) read.resolve([])
    }
    await Bun.sleep(0)
    expect(pending().length - baseline).toBeLessThanOrEqual(2 * connections.length)
  } finally {
    for (const { controller } of connections) controller.abort()
  }
})
