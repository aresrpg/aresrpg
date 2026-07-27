// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  is_periodic_room_announcement,
  suppress_periodic_room_announcements,
  trystero_room_topic,
} from '../../src/p2p/relay-signaling.js'

const nostr_event = (topic, payload) =>
  JSON.stringify(['EVENT', { tags: [['x', topic]], content: JSON.stringify(payload) }])

test('only the periodic root-room note is suppressed after a direct peer connects', async () => {
  const root_topic = await trystero_room_topic('aresrpg-world-lobby-testnet', 'world')
  expect(root_topic).toBe('642n4z6cz5ej5a3v6z1d6m556i472fi5ju0') // pinned Trystero 0.25.3 sha1 dialect
  const peer_topic = 'peer-specific-topic'
  const sent = []
  const socket = { send: (data) => sent.push(data) }
  const original_send = socket.send
  const restore = suppress_periodic_room_announcements({ relay: socket }, root_topic)

  socket.send(nostr_event(root_topic, { peerId: 'me' }))
  socket.send(nostr_event(root_topic, { peerId: 'me', offer: 'encrypted-offer' }))
  socket.send(nostr_event(peer_topic, { peerId: 'me' }))
  socket.send(JSON.stringify(['REQ', 'subscription', { '#x': [root_topic] }]))

  expect(sent).toHaveLength(3)
  expect(sent.some((data) => is_periodic_room_announcement(data, root_topic))).toBe(false)
  expect(sent.map(JSON.parse).map(([type]) => type)).toEqual(['EVENT', 'EVENT', 'REQ'])

  restore()
  expect(socket.send).toBe(original_send)
  socket.send(nostr_event(root_topic, { peerId: 'me' }))
  expect(sent).toHaveLength(4)
})
