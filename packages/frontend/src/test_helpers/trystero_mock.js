// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mock } from 'bun:test'

export const trystero_actions = new Map()
export const trystero_sent = []
export const trystero_rooms = []
/** The signaling socket the link-health watchdog samples. `readyState` is writable so a suite can kill the
 *  relay and prove the presence link reports it (1 = OPEN, 3 = CLOSED — the WebSocket constants). */
export const trystero_relay_socket = { readyState: 1, url: 'ws://relay.test' }

export function reset_trystero_mock() {
  trystero_actions.clear()
  trystero_sent.length = 0
  trystero_rooms.length = 0
  trystero_room_configs.length = 0
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

/** Every joinRoom config the transport asked for — the relay-pointing suites assert on it. */
export const trystero_room_configs = []

// Mirror the MQTT strategy's runtime export set (`@trystero-p2p/mqtt`) plus the two relay-lifecycle
// functions the transport imports from the shared core. Only joinRoom is exercised by these headless
// suites; the rest stay inert but import-safe.
mock.module('@trystero-p2p/mqtt', () => ({
  defaultRelayUrls: [],
  getRelaySockets: () => ({ test: trystero_relay_socket }),
  joinRoom: (config, room_id) => {
    trystero_room_configs.push(config)
    return joinRoom(config, room_id)
  },
  selfId: 'bun-test-peer',
}))

mock.module('@trystero-p2p/core', () => ({
  pauseRelayReconnection: () => {},
  resumeRelayReconnection: () => {},
  selfId: 'bun-test-peer',
}))
