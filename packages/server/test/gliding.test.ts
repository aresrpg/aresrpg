// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { flush, wire } from './helpers/world_wire.ts'

test.each([
  { pet: false, riding: true, expected: false },
  { pet: true, riding: false, expected: false },
  { pet: true, riding: true, expected: true },
])('gliding requires an equipped pet and an active ride: %j', async ({ pet, riding, expected }) => {
  const harness = wire({ pet, character_ids: ['0xabc'] })
  const player = create_player({ ...harness, address: '0xme', admin: false })
  try {
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    harness.published.length = 0
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: harness.checkpoint('0xabc'),
        x: 100,
        y: 12,
        z: 100,
        riding,
        gliding: true,
      })
    )
    expect(harness.published.find(({ payload }) => payload.kind === 'move')?.payload).toMatchObject({
      gliding: expected,
    })
    expect(harness.dropped).toEqual([])
    if (expected) {
      harness.published.length = 0
      player.dispatch({ type: 'action/equip', character_id: '0xabc', slot: 'pet', item_type: null })
      expect(harness.published.find(({ payload }) => payload.kind === 'move')?.payload).toMatchObject({
        riding: false,
        gliding: false,
      })
    }
  } finally {
    player.on_close()
  }
})

test('a stationary glide toggle is published and old-checkpoint gliding cannot revive it', async () => {
  const harness = wire({ pet: true, character_ids: ['0xabc'] })
  const player = create_player({ ...harness, address: '0xme', admin: false })
  try {
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    const position = {
      type: 'packet/position',
      character_id: '0xabc',
      checkpoint: harness.checkpoint('0xabc'),
      x: 100,
      y: 12,
      z: 100,
      riding: true,
      gliding: false,
    }
    player.on_message(JSON.stringify(position))
    harness.published.length = 0
    player.on_message(JSON.stringify({ ...position, gliding: true }))
    expect(harness.published.find(({ payload }) => payload.kind === 'move')?.payload.gliding).toBe(true)
    harness.published.length = 0
    player.on_message(JSON.stringify({ ...position, checkpoint: 'old:100:100:0', gliding: true }))
    expect(harness.published).toHaveLength(0)
    player.on_message(JSON.stringify(position))
    expect(harness.published.find(({ payload }) => payload.kind === 'move')?.payload.gliding).toBe(false)
  } finally {
    player.on_close()
  }
})

test('mounting while standing still publishes — and a petless riding claim is clamped', async () => {
  // owner 2026-08-21: mount/dismount rides the position stream, so a toggle with ZERO
  // displacement must still reach the zone (the old "refit, not a move" gate ate it).
  const rider = wire({ pet: true })
  const mounted = create_player({
    ws: rider.ws,
    address: '0xme',
    admin: false,
    graph: rider.graph,
    pubsub: rider.pubsub,
  })
  await flush()
  mounted.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
  const before = rider.published.length
  mounted.on_message(
    JSON.stringify({
      type: 'packet/position',
      character_id: '0xabc',
      checkpoint: rider.checkpoint('0xabc'),
      x: 100,
      y: 0,
      z: 100,
      riding: true,
      gliding: false,
    })
  )
  const toggle = rider.published.slice(before).filter(({ payload }) => payload.kind === 'move')
  expect(toggle).toHaveLength(1)
  expect(toggle[0]!.payload.riding).toBe(true)

  // no pet equipped: the claim is a lie and the server clamps it to false
  const walker = wire()
  const walking = create_player({
    ws: walker.ws,
    address: '0xme',
    admin: false,
    graph: walker.graph,
    pubsub: walker.pubsub,
  })
  await flush()
  walking.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
  walking.on_message(
    JSON.stringify({
      type: 'packet/position',
      character_id: '0xabc',
      checkpoint: walker.checkpoint('0xabc'),
      x: 101,
      y: 0,
      z: 100,
      riding: true,
      gliding: false,
    })
  )
  const claimed = walker.published.filter(({ payload }) => payload.kind === 'move')
  expect(claimed).toHaveLength(1)
  expect(claimed[0]!.payload.riding).toBe(false)
})
