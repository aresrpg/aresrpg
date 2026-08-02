// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROOM FOLD PROOF — drive the exact typed inputs lobby-room.js emits through the app's one presence door and
// assert both renderer read homes agree: observed_peers feeds remote_players' rig/chip loop, while
// presence_character feeds each chip's click/menu identity.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import '../../../test_helpers/expedition_sdk_mock.js'
import {
  presence_character,
  presence_input,
  presence_store,
} from '../../../world-shell/presence_adapter.js'
import presence from './presence.js'

const PEER = `0x${'2'.repeat(64)}`

const reset = () => presence_input({ type: 'reset' })
beforeEach(reset)
afterEach(reset)

function mount_presence_projection() {
  let state = { observed_peers: new Map(), sui: { characters: [] } }
  const module = presence()
  const context = {
    get_state: () => state,
    dispatch: (type, payload) => {
      state = module.reduce(state, { type, payload })
    },
  }
  module.observe(context)
  return () => state
}

test('room peer_pos, peer_state, and peer_leave fold through to the chip read homes', () => {
  const projected_state = mount_presence_projection()

  // Exact lobby-room.js position input shape.
  presence_input({ type: 'peer_pos', id: PEER, x: 12, y: -7, h: 64, yw: 1.5 })

  expect(presence_store.getState().peers.get(PEER)).toMatchObject({
    id: PEER,
    cell: { x: 12, y: -7 },
    position: { x: 12, y: 64, z: -7 },
    target_yaw: 1.5,
  })
  expect(projected_state().observed_peers.get(PEER)).toMatchObject({
    id: PEER,
    position: { x: 12, y: 64, z: -7 },
    target_position: { x: 12, y: 64, z: -7 },
    target_yaw: 1.5,
  })
  expect(presence_character(PEER)).toMatchObject({
    id: PEER,
    position: { x: 12, y: 64, z: -7 },
    target_yaw: 1.5,
  })

  // Exact lobby-room.js state input shape: `{ type: 'peer_state', ...row }`.
  presence_input({
    type: 'peer_state',
    id: PEER,
    address: `0x${'a'.repeat(64)}`,
    color_1: 3,
    color_2: 4,
    color_3: 5,
    party_id: null,
    dungeon_id: null,
    classe: 'yajin',
    male: false,
    name: 'Room Peer',
    mounted: true,
    mount_glb: 'horse.glb',
    veteran: true,
  })

  expect(presence_character(PEER)).toMatchObject({
    id: PEER,
    address: `0x${'a'.repeat(64)}`,
    color_1: 3,
    classe: 'yajin',
    male: false,
    name: 'Room Peer',
    mounted: true,
    mount_glb: 'horse.glb',
    veteran: true,
  })
  expect(projected_state().observed_peers.get(PEER)).toMatchObject({
    id: PEER,
    name: 'Room Peer',
    classe: 'yajin',
    male: false,
  })

  // Exact lobby-room.js leave input shape.
  presence_input({ type: 'peer_leave', id: PEER })

  expect(presence_store.getState().peers.has(PEER)).toBe(false)
  expect(projected_state().observed_peers.has(PEER)).toBe(false)
  expect(presence_character(PEER)).toBe(null)
})
