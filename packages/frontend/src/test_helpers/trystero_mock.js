// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The p2p transport's test double. bun's module registry is process-global, so this is the ONE home for the
// trystero surface every headless p2p suite runs against — a second factory would silently replace this one.
import { mock } from 'bun:test'

export const trystero_actions = new Map()
export const trystero_sent = []
export const trystero_rooms = []
/** Every joinRoom config + room id the transport asked for — the relay-pointing suites assert on these. */
export const trystero_room_configs = []
/** The signaling socket the link-health watchdog samples. `readyState` is writable so a suite can kill the
 *  relay and prove the presence link reports it (1 = OPEN, 3 = CLOSED — the WebSocket constants). */
export const trystero_relay_socket = { readyState: 1, url: 'ws://relay.test/mqtt' }
export const trystero_relay_calls = { pause: 0, resume: 0 }

export function reset_trystero_mock() {
  trystero_actions.clear()
  trystero_sent.length = 0
  trystero_rooms.length = 0
  trystero_room_configs.length = 0
  trystero_relay_socket.readyState = 1
  trystero_relay_calls.pause = 0
  trystero_relay_calls.resume = 0
}

/** Deliver one message to a live action handler exactly as a peer would. */
export const deliver = (name, payload, peer_id = 'peer-socket-1') =>
  trystero_actions.get(name)?.onMessage?.(payload, { peerId: peer_id })

const make_room = () => {
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
    leave: () => Promise.resolve(),
  }
  trystero_rooms.push(room)
  return room
}

// Mirror the MQTT strategy's runtime export set (`@trystero-p2p/mqtt`) plus the two relay-lifecycle functions
// the transport imports from the shared core.
mock.module('@trystero-p2p/mqtt', () => ({
  defaultRelayUrls: [],
  getRelaySockets: () => ({ 'ws://relay.test/mqtt': trystero_relay_socket }),
  joinRoom: (config, room_id) => {
    trystero_room_configs.push({ config, room_id })
    return make_room()
  },
  selfId: 'bun-test-peer',
}))

mock.module('@trystero-p2p/core', () => ({
  pauseRelayReconnection: () => {
    trystero_relay_calls.pause += 1
  },
  resumeRelayReconnection: () => {
    trystero_relay_calls.resume += 1
  },
  selfId: 'bun-test-peer',
}))
