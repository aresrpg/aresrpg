// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COURTESY FENCE (#1698) — the fight-turn PRESENTATION overlay is the one sanctioned neighbour of lane 2
// (docs/REALTIME.md). It moved onto the room as a FIFTH action when the client→server transport retired, and
// this suite is the mechanical half of the fence that made that move legal:
//
//   1. A courtesy signal reaches its subscribers and NOTHING else — receiving one dispatches ZERO presence
//      inputs, so the world atom cannot be moved by a fight preview at all. This is the hard assert: the
//      transport seam has no path from a courtesy frame into any fold.
//   2. It rides its OWN action, never `chat` — a courtesy blob can never surface as a chat line.
//   3. Shape-only judgement here: WHO may act and whether a preview is legal is the fight core's single home
//      (`apply_peer_batch`, proven in packages/fight/test/peer_courtesy.test.js). This seam adds no second one.
//   4. Loss-tolerant by construction — publishing with no room, and receiving with no subscriber, are silent
//      no-ops. A dropped courtesy frame costs latency, never correctness.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import '../../src/test_helpers/expedition_sdk_mock.js'
import { deliver, reset_trystero_mock, trystero_actions, trystero_sent } from '../../src/test_helpers/trystero_mock.js'

// Mocks register before the transport binds `@trystero-p2p/*` — the dynamic import is what orders that.
const { presence_store } = await import('../../src/world-shell/presence_adapter.js')
const { join_room, leave_room, publish_room_courtesy, subscribe_room_courtesy } = await import(
  '../../src/p2p/lobby-room.js'
)

const WORLD = `0x${'a'.repeat(64)}`
const ME = `0x${'1'.repeat(64)}`
const DUNGEON = `0x${'d'.repeat(64)}`

const batch = { dungeon_id: DUNGEON, address: `0x${'2'.repeat(64)}`, kind: 'batch', intent_id: 'i1', actions: [{}] }
const placement = { dungeon_id: DUNGEON, address: `0x${'2'.repeat(64)}`, kind: 'placement', target: 24 }

beforeEach(() => {
  leave_room()
  reset_trystero_mock()
})
afterEach(() => leave_room())

describe('the fight-turn courtesy overlay on the room', () => {
  it('delivers a received signal verbatim to every subscriber', () => {
    join_room(WORLD, ME, { x: 1, y: 2 })
    const seen = []
    const off = subscribe_room_courtesy((signal) => seen.push(signal))
    deliver('fstream', batch)
    deliver('fstream', placement)
    off()
    deliver('fstream', batch)
    expect(seen).toEqual([batch, placement])
  })

  // THE HARD ASSERT. The presence atom is a zustand store: every folded input replaces the state object and
  // notifies. Zero notifications across a courtesy delivery proves — mechanically, not by reading — that this
  // action reaches no fold, no reducer and no store. Fight TRUTH stays on chain→indexer→SSE; this paints only.
  it('never reaches a fold: a courtesy frame dispatches zero presence inputs', () => {
    join_room(WORLD, ME, { x: 1, y: 2 })
    subscribe_room_courtesy(() => {})
    let folds = 0
    const unsubscribe = presence_store.subscribe(() => (folds += 1))
    const before = presence_store.getState()

    deliver('fstream', batch)
    deliver('fstream', placement)

    unsubscribe()
    expect(folds).toBe(0)
    expect(presence_store.getState()).toBe(before)
  })

  it('rides its own action — a courtesy signal is never a chat line', () => {
    join_room(WORLD, ME, { x: 1, y: 2 })
    publish_room_courtesy(batch)
    expect(trystero_sent.map((row) => row.name)).toEqual(['fstream'])
    expect(trystero_sent[0].payload).toEqual(batch)
  })

  it('drops malformed frames without touching a subscriber', () => {
    join_room(WORLD, ME, { x: 1, y: 2 })
    const seen = []
    subscribe_room_courtesy((signal) => seen.push(signal))
    for (const bad of [
      null,
      {},
      { address: ME, kind: 'batch' },
      { dungeon_id: DUNGEON, kind: 'batch' },
      { dungeon_id: DUNGEON, address: ME, kind: 'chat' },
    ])
      deliver('fstream', bad)
    expect(seen).toEqual([])
  })

  it('is loss-tolerant: publishing before any room exists is a silent no-op', () => {
    expect(() => publish_room_courtesy(batch)).not.toThrow()
    expect(trystero_sent).toEqual([])
    // …and a signal with no address never goes out at all.
    join_room(WORLD, ME, { x: 1, y: 2 })
    publish_room_courtesy({ dungeon_id: DUNGEON, kind: 'batch' })
    expect(trystero_sent.filter((row) => row.name === 'fstream')).toEqual([])
  })

  it('rebuilds its action with the room, and clears it on leave', () => {
    join_room(WORLD, ME, { x: 1, y: 2 })
    expect(trystero_actions.has('fstream')).toBe(true)
    leave_room()
    publish_room_courtesy(batch)
    expect(trystero_sent.filter((row) => row.name === 'fstream')).toEqual([])
  })
})
