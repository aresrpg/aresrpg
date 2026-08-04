// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_presence_store, visible_players } from '../src/presence.js'

const PEER = `0x${'2'.repeat(64)}`

describe('presence appearance colors', () => {
  test('the decoded wire triple reaches the visible-player projection intact', () => {
    const store = create_presence_store()
    const input = (row) => store.getState().input(row, 1_000)

    input({ type: 'peer_pos', id: PEER, x: 4, y: 9, h: 64 })
    input({ type: 'peer_state', id: PEER, color_1: 0x112233, color_2: 0x445566, color_3: 0x778899 })

    expect(visible_players(store.getState())[0]).toMatchObject({
      color_1: 0x112233,
      color_2: 0x445566,
      color_3: 0x778899,
    })
  })

  test('chain-resolved appearance wins for all three colors, not only color_1', () => {
    const store = create_presence_store()
    const input = (row) => store.getState().input(row, 1_000)

    input({ type: 'peer_pos', id: PEER, x: 4, y: 9 })
    input({ type: 'peer_state', id: PEER, color_1: 1, color_2: 2, color_3: 3 })
    input({ type: 'peer_identity', id: PEER, record: { color_1: 7, color_2: 8, color_3: 9 } })

    expect(visible_players(store.getState())[0]).toMatchObject({ color_1: 7, color_2: 8, color_3: 9 })
  })
})
