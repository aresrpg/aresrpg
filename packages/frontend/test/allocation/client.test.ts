// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ClientPacket } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import type { connect_server } from '../../src/server_link.ts'
import { create_allocation_client } from '../../src/allocation/client.ts'

const setup = () => {
  let receive!: Parameters<typeof connect_server>[0]['dispatch']
  let disposed = false
  const sent: ClientPacket[] = []
  const session = { address: '0x1' } as AuthSession
  const client = create_allocation_client(session, (options) => {
    expect(options.session).toBe(session)
    receive = options.dispatch
    return {
      send: (packet) => {
        sent.push(packet)
        return true
      },
      dispose: () => {
        disposed = true
      },
    }
  })
  return { client, sent, receive: (input: Parameters<typeof receive>[0]) => receive(input), disposed: () => disposed }
}

test('private campaign traffic waits for normal admission and correlates replies', async () => {
  const connection = setup()
  const result = connection.client.request({ action: 'link_x' })
  expect(connection.sent).toHaveLength(0)
  connection.receive({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
  await Promise.resolve()
  expect(connection.sent[0]).toMatchObject({ type: 'packet/allocation_request', request: { action: 'link_x' } })
  const [packet] = connection.sent
  if (packet.type !== 'packet/allocation_request') throw new Error('missing request')
  connection.receive({
    type: 'server/packet',
    packet: {
      type: 'packet/allocation_response',
      id: packet.id,
      result: { action: 'link_x', url: 'https://example.test/link' },
    },
  })
  expect(await result).toEqual({ action: 'link_x', url: 'https://example.test/link' })
  connection.client.dispose()
  expect(connection.disposed()).toBe(true)
})

test('disconnect rejects pending private operations without replaying writes', async () => {
  const connection = setup()
  connection.receive({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
  const result = connection.client.request({ action: 'submit', address: '0x1', urls: ['https://x.com/test/status/1'] })
  const refused = result.then(
    () => null,
    (error: unknown) => error
  )
  connection.receive({ type: 'link/failed', error: 'lost' })
  expect(await refused).toEqual(new Error('connection_failed'))
  connection.receive({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
  expect(connection.sent).toHaveLength(1)
  connection.client.dispose()
})

test('a connection replaced by another tab fails immediately instead of waiting on a dead socket', async () => {
  const connection = setup()
  connection.receive({ type: 'link/replaced' })
  const result = connection.client.request({ action: 'status' }).catch((error: Error) => error.message)
  expect(await Promise.race([result, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 25))])).toBe(
    'connection_replaced'
  )
  connection.client.dispose()
})

test('only an explicit reconnect starts a fresh admission; failed writes are never replayed', async () => {
  const connection = setup()
  connection.receive({ type: 'link/replaced' })
  connection.client.reconnect()
  connection.receive({ type: 'link/connecting' })
  const pending = connection.client.request({ action: 'status' })
  expect(connection.sent).toHaveLength(0)
  connection.receive({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
  await Promise.resolve()
  const [request] = connection.sent
  if (request.type !== 'packet/allocation_request') throw new Error('missing request')
  connection.receive({
    type: 'server/packet',
    packet: { type: 'packet/allocation_response', id: request.id, result: { action: 'error', error: 'closed' } },
  })
  await expect(pending).rejects.toThrow('closed')
  expect(connection.sent).toHaveLength(1)
  connection.client.dispose()
})
