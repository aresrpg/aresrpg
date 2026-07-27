// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mock } from 'bun:test'

export const trystero_actions = new Map()
export const trystero_sent = []
export const trystero_rooms = []
export const trystero_relay_sent = []
export const trystero_relay_socket = {
  readyState: 1,
  url: 'wss://relay.test',
  send: (data) => trystero_relay_sent.push(data),
}

export function reset_trystero_mock() {
  trystero_actions.clear()
  trystero_sent.length = 0
  trystero_rooms.length = 0
  trystero_relay_sent.length = 0
}

const joinRoom = () => {
  const peers = {}
  const room = {
    makeAction: (name) => {
      const action = {
        send: (payload, options) => {
          trystero_sent.push({ name, payload, options })
          return Promise.resolve()
        },
        onMessage: null,
      }
      trystero_actions.set(name, action)
      return action
    },
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    getPeers: () => peers,
    connectPeer: (peer_id) => {
      peers[peer_id] = {}
      room.onPeerJoin?.(peer_id)
    },
    disconnectPeer: (peer_id) => {
      delete peers[peer_id]
      room.onPeerLeave?.(peer_id)
    },
    leave: () => {},
  }
  trystero_rooms.push(room)
  return room
}

// Mirror trystero's complete runtime export set. Only joinRoom is exercised by
// these headless suites; the remaining exports stay inert but import-safe.
mock.module('trystero', () => ({
  createEvent: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
  defaultRelayUrls: [],
  getRelaySockets: () => ({ test: trystero_relay_socket }),
  joinRoom,
  pauseRelayReconnection: () => {},
  resumeRelayReconnection: () => {},
  selfId: 'bun-test-peer',
  subscribe: () => () => {},
}))
