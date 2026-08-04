// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import presence_module from '../../src/game/core/modules/presence.js'
import { presence_colors } from '../../src/game/presence_colors.js'

describe('presence color application', () => {
  test('the frontend bridge retains the full palette the avatar materializer consumes', () => {
    const state = { observed_peers: new Map() }
    const row = {
      id: 'peer',
      classe: 'senshi',
      male: true,
      color_1: 0x112233,
      color_2: 0x445566,
      color_3: 0x778899,
      position: { x: 1, y: 64, z: 2 },
    }

    const next = presence_module().reduce(state, { type: 'action/presence_snapshot', payload: [row] })
    const rendered = next.observed_peers.get('peer')

    expect(rendered).toMatchObject({ color_1: row.color_1, color_2: row.color_2, color_3: row.color_3 })
    expect(presence_colors(rendered)).toEqual([row.color_1, row.color_2, row.color_3])
  })
})
