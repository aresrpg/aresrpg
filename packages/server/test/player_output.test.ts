// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { PlayerPosition, ServerPacket } from '@aresrpg/protocol'

import { create_player_output, MAX_BUFFERED_BYTES } from '../src/player_output.ts'

const fixture = () => {
  const controller = new AbortController()
  const sent: ServerPacket[] = []
  const closed: unknown[] = []
  const timers = new Set<() => void>()
  const state = { buffered: 0, now: 0, dropped: false, queued: false }
  const output = create_player_output(
    {
      send: (raw) => {
        if (state.dropped) return 0
        sent.push(JSON.parse(raw))
        return state.queued ? -1 : raw.length
      },
      close: (code, reason) => {
        closed.push([code, reason])
      },
      getBufferedAmount: () => state.buffered,
    },
    controller.signal,
    (run) => {
      timers.add(run)
      return () => {
        timers.delete(run)
      }
    },
    () => state.now
  )
  const tick = () => {
    const pending = [...timers]
    timers.clear()
    pending.forEach((run) => run())
  }
  return { output, sent, closed, controller, timers, tick, state }
}
const position = (id = 'character', x = 1): PlayerPosition => ({
  character_id: id,
  world: 'nauvis',
  x,
  y: 0,
  z: 0,
  riding: false,
})

test('positions coalesce by identity while reliable packets retain their order', () => {
  const { output, sent, tick, timers, controller } = fixture()
  output.send({ type: 'packet/player_appeared', player: { ...position() } } as never)
  for (let index = 0; index < 100; index++) output.position(position('character', index))
  output.position({ ...position('other'), riding: true })
  output.send({ type: 'packet/pong', id: 42 })
  expect(timers.size).toBe(1)
  expect(sent.map(({ type }) => type)).toEqual(['packet/player_appeared', 'packet/pong'])
  tick()
  expect(sent.at(-1)).toEqual({
    type: 'packet/players_moved',
    positions: [position('character', 99), { ...position('other'), riding: true }],
  })
  expect(timers.size).toBe(0)
  controller.abort()
})

test('departure, reappearance and close invalidate unsent positions', () => {
  const { output, sent, tick, controller, timers } = fixture()
  output.position(position())
  output.send({ type: 'packet/player_left', character_id: 'character' })
  tick()
  expect(sent).toHaveLength(1)
  output.position(position())
  output.send({ type: 'packet/player_appeared', player: { ...position(), world: 'yakutia' } } as never)
  tick()
  expect(sent).toHaveLength(2)
  output.position({ ...position(), world: 'yakutia' })
  controller.abort()
  tick()
  expect(sent).toHaveLength(2)
  expect(timers.size).toBe(0)
})

test('slow sockets retain only latest positions and resume without losing a mount toggle', () => {
  const { output, sent, tick, state, controller } = fixture()
  state.buffered = 100_000
  output.position(position())
  tick()
  output.position({ ...position('character', 4), riding: true })
  tick()
  expect(sent).toEqual([])
  state.buffered = 0
  tick()
  expect(sent).toEqual([{ type: 'packet/players_moved', positions: [{ ...position('character', 4), riding: true }] }])
  controller.abort()
})

test('a stalled, overflowing or dropped reliable stream closes instead of silently losing facts', () => {
  const stalled = fixture()
  stalled.state.buffered = 100_000
  stalled.output.position(position())
  stalled.tick()
  stalled.state.now = 5_000
  stalled.tick()
  expect(stalled.closed).toEqual([[1013, 'SLOW_CONSUMER']])
  const overflow = fixture()
  overflow.state.buffered = MAX_BUFFERED_BYTES
  overflow.output.send({ type: 'packet/pong', id: 1 })
  expect(overflow.closed).toEqual([[1013, 'SLOW_CONSUMER']])
  const dropped = fixture()
  dropped.state.dropped = true
  dropped.output.send({ type: 'packet/pong', id: 1 })
  expect(dropped.closed).toEqual([[1013, 'SLOW_CONSUMER']])
})

test('large crowds drain bounded batches and retain newer samples between ticks', () => {
  const { output, sent, tick, timers, controller } = fixture()
  for (let index = 0; index < 600; index++) output.position(position(String(index)))
  tick()
  expect(sent[0]).toMatchObject({ type: 'packet/players_moved' })
  expect(sent.filter((packet) => packet.type === 'packet/players_moved')[0]!.positions).toHaveLength(256)
  output.position(position('599', 99))
  output.position(position('0', 42))
  tick()
  tick()
  const batches = sent.filter((packet) => packet.type === 'packet/players_moved')
  expect(batches.map(({ positions }) => positions.length)).toEqual([256, 256, 89])
  expect(batches[2]!.positions.at(-2)).toEqual(position('599', 99))
  expect(batches[2]!.positions.at(-1)).toEqual(position('0', 42))
  expect(timers.size).toBe(0)
  controller.abort()
})

test('native queued sends are accepted once and never retried', () => {
  const { output, sent, closed, state, tick, controller } = fixture()
  state.queued = true
  output.send({ type: 'packet/pong', id: 1 })
  output.position(position())
  tick()
  tick()
  expect(sent).toHaveLength(2)
  expect(closed).toEqual([])
  controller.abort()
})
