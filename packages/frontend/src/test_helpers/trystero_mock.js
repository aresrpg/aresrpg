// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mock } from 'bun:test'

export const trystero_actions = new Map()
export const trystero_sent = []

export function reset_trystero_mock() {
  trystero_actions.clear()
  trystero_sent.length = 0
}

const joinRoom = () => ({
  makeAction: (name) => {
    const action = {
      send: (payload) => {
        trystero_sent.push({ name, payload })
        return Promise.resolve()
      },
      onMessage: null,
    }
    trystero_actions.set(name, action)
    return action
  },
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  leave: () => {},
})

// Mirror trystero's complete runtime export set. Only joinRoom is exercised by
// these headless suites; the remaining exports stay inert but import-safe.
mock.module('trystero', () => ({
  createEvent: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
  defaultRelayUrls: [],
  getRelaySockets: () => ({}),
  joinRoom,
  pauseRelayReconnection: () => {},
  resumeRelayReconnection: () => {},
  selfId: 'bun-test-peer',
  subscribe: () => () => {},
}))
