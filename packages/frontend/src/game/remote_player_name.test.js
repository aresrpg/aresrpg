// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { peer_display_name } from './remote_player_name.js'

const ADDRESS = '0x8f1b34c9789a4c62593d10e2f6a7b8c9'

describe('peer_display_name', () => {
  test('the resolved character name wins over an address-like peer label', () => {
    expect(
      peer_display_name({
        resolved_name: 'Ares',
        peer_name: ADDRESS,
        address: ADDRESS,
      })
    ).toBe('Ares')
  })

  test('the peer label remains the unresolved fallback', () => {
    expect(peer_display_name({ resolved_name: null, peer_name: 'Wayfarer', address: ADDRESS })).toBe('Wayfarer')
  })

  test('the address is shortened only when no player name exists', () => {
    expect(peer_display_name({ resolved_name: '', peer_name: null, address: ADDRESS })).toBe(ADDRESS.slice(0, 6))
  })
})
