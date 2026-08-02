// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST: other players must project onto the minimap. presence_markers.js is the pure adapter between
// core/modules/presence.js's `observed_peers` Map and the {x,z,kind,key} marker shape minimap_engine.js's
// draw_marker already dispatches on (mob/resource) — see Minimap.jsx for the wiring.
import { describe, expect, test } from 'bun:test'

import { peer_markers } from './presence_markers.js'

describe('peer_markers — observed_peers → minimap marker rows', () => {
  test('empty presence yields no markers', () => {
    expect(peer_markers(new Map())).toEqual([])
  })

  test('a peer in observed_peers yields a minimap marker projection (kind: peer)', () => {
    const observed_peers = new Map([
      ['peer-1', { id: 'peer-1', position: { x: 10, y: 5, z: -8 }, target_position: { x: 12, y: 5, z: -7 } }],
    ])
    // target_position wins — the peer's REAL broadcast position (remote_players.js's own precedent for a
    // range test), not the frozen spawn-time `position` seed.
    expect(peer_markers(observed_peers)).toEqual([{ x: 12, z: -7, kind: 'peer', key: 'peer-1' }])
  })

  test('falls back to position when target_position is absent (fresh spawn seed)', () => {
    const observed_peers = new Map([['peer-2', { id: 'peer-2', position: { x: 3, z: 4 } }]])
    expect(peer_markers(observed_peers)).toEqual([{ x: 3, z: 4, kind: 'peer', key: 'peer-2' }])
  })

  test('an entry with neither position is skipped — no ghost marker', () => {
    const observed_peers = new Map([['peer-3', { id: 'peer-3' }]])
    expect(peer_markers(observed_peers)).toEqual([])
  })

  test('multiple peers each yield their own marker, keyed by id', () => {
    const observed_peers = new Map([
      ['a', { id: 'a', target_position: { x: 1, z: 1 } }],
      ['b', { id: 'b', target_position: { x: -5, z: 9 } }],
    ])
    expect(peer_markers(observed_peers)).toEqual([
      { x: 1, z: 1, kind: 'peer', key: 'a' },
      { x: -5, z: 9, kind: 'peer', key: 'b' },
    ])
  })
})
