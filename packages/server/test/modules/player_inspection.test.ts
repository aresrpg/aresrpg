// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { InspectionQuery, ServerPacket } from '@aresrpg/protocol'

import player_inspection from '../../src/modules/player_inspection.ts'
import type { PlayerContext, PlayerState } from '../../src/player.ts'

const address = `0x${'a'.repeat(64)}`
const equipment = (character_id: string): InspectionQuery => ({ kind: 'equipment', address, character_id })
const harness = () => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const reads: ReturnType<typeof Promise.withResolvers<Record<string, unknown>[]>>[] = []
  const packets: ServerPacket[] = []
  let state = { inspection: null } as PlayerState
  player_inspection.observe({
    events,
    signal: controller.signal,
    get_state: () => state,
    send: (packet: ServerPacket) => packets.push(packet),
    graph: {
      read: () => {
        const read = Promise.withResolvers<Record<string, unknown>[]>()
        reads.push(read)
        return read.promise
      },
    },
  } as unknown as PlayerContext)
  const select = (id: number, query: InspectionQuery | null) => {
    const previous = state
    state = player_inspection.reduce(state, { type: 'packet/inspection_request', id, query })
    events.emit('STATE_UPDATED', state, previous)
  }
  return { select, reads, packets, controller }
}

test('rapid selections retain one running read and only the latest pending intent', async () => {
  const h = harness()
  h.select(1, equipment('first'))
  h.select(2, equipment('second'))
  h.select(3, equipment('third'))
  expect(h.reads).toHaveLength(1)
  h.reads[0]!.resolve([])
  await Bun.sleep(0)
  expect(h.packets).toHaveLength(0)
  expect(h.reads).toHaveLength(2)
  h.reads[1]!.resolve([{ slot: null, item: null }])
  await Bun.sleep(0)
  expect(h.packets).toEqual([{ type: 'packet/inspection_result', id: 3, result: { kind: 'equipment', equipment: [] } }])
  h.controller.abort()
})

test('close discards pending work; disconnect suppresses an in-flight failure', async () => {
  const h = harness()
  h.select(1, equipment('first'))
  h.select(2, equipment('second'))
  h.select(3, null)
  h.reads[0]!.resolve([])
  await Bun.sleep(0)
  expect(h.reads).toHaveLength(1)
  expect(h.packets).toHaveLength(0)
  h.select(4, equipment('fourth'))
  h.controller.abort()
  h.reads[1]!.reject(new Error('offline'))
  await Bun.sleep(0)
  expect(h.packets).toHaveLength(0)
})

test('failed reads report the exact request and allow another read', async () => {
  const h = harness()
  h.select(1, equipment('first'))
  h.reads[0]!.reject(new Error('timeout'))
  await Bun.sleep(0)
  expect(h.packets).toEqual([{ type: 'packet/inspection_error', id: 1 }])
  h.select(2, equipment('first'))
  h.reads[1]!.resolve([])
  await Bun.sleep(0)
  expect(h.packets.at(-1)).toMatchObject({ type: 'packet/inspection_result', id: 2 })
  h.controller.abort()
})
