// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { ZONE_RECENTER_MS } from '../../src/modules/player_world.ts'
import { create_player } from '../helpers/player.ts'
import { wire, flush } from '../helpers/world_wire.ts'

const UNMOUNTED = Object.freeze({ riding: false, gliding: false })

// Zone windows follow movement on a clock (audit SERVER-2) and a refused read drops one
// connection, never the process (audit SERVER-3).
test('a refused fight read during a zone crossing drops that connection instead of the process', async () => {
  const { ws, graph, pubsub, dropped } = wire({ character_ids: ['0xabc'] })
  let refused = false
  const overloaded = {
    ...graph,
    read: async (cypher: string, params?: Record<string, unknown>) => {
      if (refused && cypher.includes(':Fight')) throw new Error('Max pending queries exceeded')
      return graph.read(cypher, params)
    },
  }
  const player = create_player({ ws, address: '0xme', admin: false, graph: overloaded, pubsub })
  await flush()
  player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
  await flush()
  refused = true
  player.dispatch({
    type: 'action/move',
    character_id: '0xabc',
    x: 600,
    y: 0,
    z: 100,
    ...UNMOUNTED,
    at_ms: Date.now(),
    budget_blocks: 0,
  })
  await Bun.sleep(ZONE_RECENTER_MS + 50)
  expect(dropped).toContain('SNAPSHOT_FAILED')
})

test('border oscillation costs at most one re-track per tick, never one read per move', async () => {
  const { ws, graph, pubsub } = wire({ character_ids: ['0xabc'] })
  let fight_reads = 0
  const counting = {
    ...graph,
    read: async (cypher: string, params?: Record<string, unknown>) => {
      if (cypher.includes(':Fight')) fight_reads += 1
      return graph.read(cypher, params)
    },
  }
  const player = create_player({ ws, address: '0xme', admin: false, graph: counting, pubsub })
  await flush()
  player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
  await flush()
  fight_reads = 0
  for (let step = 0; step < 40; step += 1)
    player.dispatch({
      type: 'action/move',
      character_id: '0xabc',
      x: step % 2 === 0 ? 512.01 : 511.99,
      y: 0,
      z: 100,
      ...UNMOUNTED,
      at_ms: Date.now(),
      budget_blocks: 0,
    })
  await flush()
  expect(fight_reads).toBe(0)
  await Bun.sleep(ZONE_RECENTER_MS + 50)
  expect(fight_reads).toBeLessThanOrEqual(1)
})
