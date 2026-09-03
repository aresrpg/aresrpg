// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { solve_tiled_wfc, type WfcTile } from '../../src/cities/tiled_wfc.ts'

const tiles = Object.freeze([
  Object.freeze({ id: 'empty', weight: 4, sockets: [0, 0, 0, 0, 0, 0] as const }),
  Object.freeze({ id: 'west_end', weight: 1, sockets: [0, 1, 0, 0, 0, 0] as const }),
  Object.freeze({ id: 'middle', weight: 1, sockets: [1, 1, 0, 0, 0, 0] as const }),
  Object.freeze({ id: 'east_end', weight: 1, sockets: [1, 0, 0, 0, 0, 0] as const }),
] satisfies readonly WfcTile[])

describe('simple tiled WFC', () => {
  test('propagates pre-collapsed sockets deterministically through three dimensions', () => {
    const model = {
      seed: 42,
      size: [3, 1, 1] as const,
      tiles,
      constraints: [
        { index: 0, allowed: ['west_end'] },
        { index: 2, allowed: ['east_end'] },
      ],
    }

    expect(solve_tiled_wfc(model)).toEqual(['west_end', 'middle', 'east_end'])
    expect(solve_tiled_wfc(model)).toEqual(solve_tiled_wfc(model))
  })

  test('reports contradictory boundary constraints instead of emitting a broken seam', () => {
    expect(
      solve_tiled_wfc({
        seed: 7,
        size: [1, 1, 1],
        tiles,
        constraints: [{ index: 0, allowed: ['middle'] }],
      })
    ).toBeNull()
  })
})
