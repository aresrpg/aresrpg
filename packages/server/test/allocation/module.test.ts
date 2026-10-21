// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { AllocationRequest, AllocationResult, ServerPacket } from '@aresrpg/protocol'

import player_allocation from '../../src/modules/player_allocation.ts'
import type { PlayerContext } from '../../src/player.ts'

const setup = (request: (owner: string, input: AllocationRequest) => Promise<AllocationResult>) => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const sent: ServerPacket[] = []
  // This observer consumes only these connection-owned dependencies.
  player_allocation.observe({
    address: 'authenticated-owner',
    events,
    signal: controller.signal,
    send: (packet: ServerPacket) => {
      sent.push(packet)
    },
    allocation: { request },
  } as PlayerContext)
  return { events, controller, sent }
}

test('the module uses the admitted identity, never a client-supplied owner', async () => {
  const observed: string[] = []
  const connection = setup(async (owner) => {
    observed.push(owner)
    return { action: 'complete_x' }
  })
  connection.events.emit('packet/allocation_request', {
    id: 1,
    request: { action: 'complete_x', token: 'opaque', owner: 'forged' },
  })
  await Bun.sleep(0)
  expect(observed).toEqual(['authenticated-owner'])
  expect(connection.sent).toEqual([{ type: 'packet/allocation_response', id: 1, result: { action: 'complete_x' } }])
  connection.controller.abort()
})

test('one operation is admitted at a time and disconnected clients receive no late private reply', async () => {
  let finish!: (result: AllocationResult) => void
  const connection = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const packet = { id: 1, request: { action: 'link_x' } }
  connection.events.emit('packet/allocation_request', packet)
  connection.events.emit('packet/allocation_request', { ...packet, id: 2 })
  expect(connection.sent).toEqual([
    { type: 'packet/allocation_response', id: 2, result: { action: 'error', error: 'rate_limited' } },
  ])
  connection.controller.abort()
  finish({ action: 'link_x', url: 'private-ticket' })
  await Bun.sleep(0)
  expect(connection.sent).toHaveLength(1)
})
