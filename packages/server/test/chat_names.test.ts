// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { CHAT_MIN_INTERVAL_MS } from '@aresrpg/protocol'

import { chat_name } from '../src/suins.ts'

import { create_player } from './helpers/player.ts'
import { embody, flush, wire } from './helpers/stream_wire.ts'

test('chat captures admitted destinations and publishes in order across channels despite out-of-order name reads', async () => {
  const { ws, graph, pubsub, published } = wire()
  const first = Promise.withResolvers<string | null>()
  const second = Promise.withResolvers<string | null>()
  let reads = 0
  const player = create_player({
    ws,
    address: '0xme',
    admin: false,
    graph,
    pubsub,
    resolve_name: () => (++reads === 1 ? first.promise : second.promise),
  })
  const now = Date.now()
  const clock = spyOn(Date, 'now').mockReturnValue(now)
  try {
    await flush()
    await embody(player)
    player.on_message(
      JSON.stringify({ type: 'packet/chat', character_id: '0xabc', parts: [{ kind: 'text', text: 'world' }] })
    )
    // Flood refusal happens before enrichment, even while the first accepted line waits.
    player.on_message(
      JSON.stringify({ type: 'packet/chat', character_id: '0xabc', parts: [{ kind: 'text', text: 'flood' }] })
    )
    expect(reads).toBe(1)
    clock.mockReturnValue(now + CHAT_MIN_INTERVAL_MS)
    player.on_message(
      JSON.stringify({
        type: 'packet/chat_whisper',
        character_id: '0xabc',
        to: '0xpal',
        parts: [{ kind: 'text', text: 'private' }],
      })
    )
    second.resolve('aresrpg.child.sceat.sui')
    await flush()
    expect(published.filter(({ channel }) => channel.startsWith('chat:'))).toHaveLength(0)
    first.resolve('aresrpg.child.sceat.sui')
    await flush()
    const chat = published.filter(({ channel }) => channel.startsWith('chat:'))
    expect(chat.map(({ channel }) => channel)).toEqual(['chat:world:overworld', 'chat:user:0xpal'])
    expect(chat.map(({ payload }) => payload)).toMatchObject([
      { name: 'aresrpg.child.sceat.sui', character: 'nox', character_id: '0xabc' },
      { name: 'aresrpg.child.sceat.sui', character: 'nox', character_id: '0xabc' },
    ])
  } finally {
    clock.mockRestore()
    player.on_close()
  }
})

test('disposal suppresses a name-enriched publication already awaiting the resolver', async () => {
  const { ws, graph, pubsub, published } = wire()
  const name = Promise.withResolvers<string | null>()
  const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub, resolve_name: () => name.promise })
  await flush()
  await embody(player)
  player.on_message(
    JSON.stringify({ type: 'packet/chat', character_id: '0xabc', parts: [{ kind: 'text', text: 'late' }] })
  )
  player.on_close()
  name.resolve('aresrpg.sceat.sui')
  await flush()
  expect(published.filter(({ channel }) => channel.startsWith('chat:'))).toHaveLength(0)
})

test('a stalled or failed name read cannot hold chat beyond the presentation deadline', async () => {
  expect(await chat_name(() => new Promise(() => {}), 'owner')).toBeNull()
  expect(
    await chat_name(async () => {
      throw new Error('offline')
    }, 'owner')
  ).toBeNull()
})
