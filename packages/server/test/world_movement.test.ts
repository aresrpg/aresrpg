// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

test('a plausible move within the zone publishes a move fact, not a re-track', async () => {
  const { graph, ws, pubsub, published, checkpoint } = wire()
  const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
  await flush()
  player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
  published.length = 0
  player.on_message(
    JSON.stringify({
      type: 'packet/position',
      character_id: '0xabc',
      checkpoint: checkpoint('0xabc'),
      x: 100.3,
      y: 0,
      z: 100.3,
      riding: false,
    })
  )
  expect(published.every(({ payload }) => payload.kind === 'move')).toBe(true)
})
