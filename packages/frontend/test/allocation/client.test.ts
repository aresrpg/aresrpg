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
  expect(await refused).toEqual(new Error('unavailable'))
  connection.receive({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
  expect(connection.sent).toHaveLength(1)
  connection.client.dispose()
})
