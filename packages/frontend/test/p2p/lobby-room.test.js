// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #854: Trystero 0.25.3 reads explicit Nostr relays from relayConfig.

import { afterEach, expect, mock, test } from 'bun:test'

const room_configs = []

const room_double = () => ({
  makeAction: () => ({ send: () => Promise.resolve(), onMessage: null }),
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  leave: () => {},
})

mock.module('trystero', () => ({
  createEvent: () => ({}),
  defaultRelayUrls: [],
  getRelaySockets: () => ({}),
  joinRoom: (config) => {
    room_configs.push(config)
    return room_double()
  },
  pauseRelayReconnection: () => {},
  resumeRelayReconnection: () => {},
  selfId: 'relay-config-test',
  subscribe: () => () => {},
}))

const { join_lobby, leave_lobby, sync_party_room } = await import('../../src/p2p/lobby-room.js')

afterEach(() => {
  leave_lobby()
  sync_party_room(null)
  room_configs.length = 0
})

test('the lobby and party rooms pass explicit Nostr relays through Trystero 0.25.3 relayConfig', () => {
  join_lobby('0xcharacter', { x: 0, y: 0 })
  sync_party_room('0xparty')

  expect(room_configs).toHaveLength(2)
  for (const config of room_configs) {
    expect(config.relayConfig).toEqual({
      urls: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://nostr.mom',
        'wss://relay.snort.social',
      ],
      redundancy: 3,
    })
    expect(config.relayUrls).toBeUndefined()
    expect(config.relayRedundancy).toBeUndefined()
  }
})
