// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { LeaderboardObservation, LeaderboardSnapshot, ServerPacket } from '@aresrpg/protocol'

import player_leaderboards from '../../src/modules/player_leaderboards.ts'
import type { PlayerContext, PlayerState } from '../../src/player.ts'

const address = `0x${'01'.repeat(32)}`
const snapshot = (observation: LeaderboardObservation): LeaderboardSnapshot => ({
  observation,
  reset_at_ms: Date.UTC(2026, 9, 1),
  timestamp_ms: Date.UTC(2026, 8, 9),
  checkpoint: 50,
  entries: [{ address, name: null, score: '10', rank: 1, characters: [], character_count: 0, jobs: [] }],
  self: null,
})

const harness = () => {
  const events = new EventEmitter()
  const chain = new EventEmitter()
  const controller = new AbortController()
  const packets: ServerPacket[] = []
  const reads: { observation: LeaderboardObservation; resolve: (value: LeaderboardSnapshot) => void }[] = []
  const subscriptions: string[] = []
  const names = Promise.withResolvers<string | null>()
  let state = { leaderboard_observation: null } as PlayerState
  player_leaderboards.observe({
    address,
    events,
    get_state: () => state,
    signal: controller.signal,
    send: (packet: ServerPacket) => packets.push(packet),
    resolve_name: () => names.promise,
    graph: { read: async () => [] },
    pubsub: {
      graph: {
        emitter: chain,
        subscribe: async (channel: string) => {
          subscriptions.push(channel)
        },
        unsubscribe: async (channel: string) => {
          subscriptions.push(`-${channel}`)
        },
        leaderboard: (observation: LeaderboardObservation) =>
          new Promise<LeaderboardSnapshot>((resolve) => reads.push({ observation, resolve })),
      },
    },
  } as unknown as PlayerContext)
  const observe = (observation: LeaderboardObservation | null): void => {
    const previous = state
    state = player_leaderboards.reduce(state, { type: 'packet/leaderboard_observe', observation })
    events.emit('STATE_UPDATED', state, previous)
  }
  return { packets, reads, names, subscriptions, observe, controller, chain }
}

test('only the selected window responds, enrichment is bounded, and closing releases subscriptions', async () => {
  const h = harness()
  try {
    expect(h.reads).toHaveLength(0)
    const first = { id: 1, metric: 'xp' as const }
    const second = { id: 2, metric: 'kills' as const }
    h.observe(first)
    h.observe(second)
    h.reads[1]!.resolve(snapshot(second))
    await Bun.sleep(300)
    expect(h.packets).toHaveLength(1)
    expect(h.packets[0]).toMatchObject({
      type: 'packet/leaderboard',
      snapshot: { observation: second, entries: [{ name: null }] },
    })
    h.reads[0]!.resolve(snapshot(first))
    await Bun.sleep(0)
    expect(h.packets).toHaveLength(1)
    h.names.resolve('hero.sui')
    const third = { ...second, id: 3 }
    h.observe(third)
    h.reads[2]!.resolve(snapshot(third))
    await Bun.sleep(0)
    expect(h.packets[1]).toMatchObject({
      type: 'packet/leaderboard',
      snapshot: { observation: third, entries: [{ name: 'hero.sui' }] },
    })
    h.observe(null)
    await Bun.sleep(0)
    expect(h.subscriptions).toEqual(['evt:leaderboards', '-evt:leaderboards'])
    expect(h.chain.listenerCount('evt:leaderboards')).toBe(0)
  } finally {
    h.controller.abort()
  }
})
