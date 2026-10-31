// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { LEADERBOARD_METRICS } from '@aresrpg/protocol'

import { create_request_limiter } from '../src/request_limiter.ts'

import { create_player } from './helpers/player.ts'
import { wire } from './helpers/world_wire.ts'

const address = `0x${'a'.repeat(64)}`
const requests = [
  { type: 'packet/character_owner_request', id: 1, character_id: address },
  { type: 'packet/allocation_request', id: 2, request: { action: 'status' } },
  { type: 'packet/admin_request', id: 3, kind: 'overview_section', section: 'revenue', days: 1 },
  { type: 'packet/market_floor_request', id: 4, item_type: 'wheat' },
  { type: 'packet/market_observe', observation: { kind: 'characters', request: 5 } },
  { type: 'packet/market_prices_observe', observation: { item_type: 'wheat', id: 6 } },
  { type: 'packet/leaderboard_observe', observation: { metric: LEADERBOARD_METRICS[0], id: 7 } },
  { type: 'packet/inspection_request', id: 8, query: { kind: 'profile', address, after: null } },
  ...['packet/spectate', 'packet/fight_preview', 'packet/fight_nearby', 'packet/fight_resync'].map((type) => ({
    type,
    character_id: '0xabc',
    fight: '0xfight',
  })),
]

test('extra null fields cannot turn any graph-reaching packet into a free cancellation', async () => {
  const wires = wire({ owns: false })
  const limiter = create_request_limiter({ capacity: 1 })
  limiter.take(address)
  let reads = 0
  const player = create_player({
    ...wires,
    address,
    admin: false,
    request_limiter: limiter,
    graph: {
      ...wires.graph,
      read: (...args) => {
        reads++
        return wires.graph.read(...args)
      },
    },
  })
  try {
    await Bun.sleep(0)
    const baseline = reads
    for (const request of requests) {
      for (const field of ['observation', 'fight', 'query']) {
        if (field in request) continue
        wires.sent.length = 0
        player.on_message(JSON.stringify({ ...request, [field]: null }))
        expect(wires.sent.at(-1)).toMatchObject(
          request.type === 'packet/inspection_request'
            ? { type: 'packet/inspection_error', id: 8 }
            : { type: 'packet/error', reason: 'rate limited' }
        )
      }
    }
    await Bun.sleep(0)
    expect(reads).toBe(baseline)
  } finally {
    player.on_close()
  }
})

test('malformed floor queries and invented sale commands never reach graph or transaction effects', async () => {
  const wires = wire({ owns: false })
  let reads = 0
  const player = create_player({
    ...wires,
    address,
    admin: false,
    graph: {
      ...wires.graph,
      read: (...args) => {
        reads++
        return wires.graph.read(...args)
      },
    },
  })
  try {
    await Bun.sleep(0)
    const baseline = reads
    const valid = { type: 'packet/market_floor_request', id: 1, item_type: 'wheat' }
    const malformed = [
      null,
      [],
      {},
      { ...valid, id: -1 },
      { ...valid, id: 1.5 },
      { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, item_type: "wheat' RETURN 1" },
      { ...valid, item_type: ['wheat'] },
      { ...valid, item_type: 'a'.repeat(129) },
      { type: 'packet/market_floor', id: 1, prices: { 1: '1' } },
      { type: 'packet/list_requested', kind: 'character', id: address, price_mist: '1' },
      { type: 'market/list_requested', kind: 'character', id: address, price_mist: '1' },
    ]
    for (const packet of malformed) {
      wires.sent.length = 0
      player.on_message(JSON.stringify(packet))
      expect(wires.sent.at(-1)?.type).toBe('packet/error')
    }
    await Bun.sleep(0)
    expect(reads).toBe(baseline)
  } finally {
    player.on_close()
  }
})
