// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZERO-DIVERGENCE TWIN — "which cells of the rect are VOID" (D231) is ONE derivation
// (`@aresrpg/fight/board_state voids_from_shape_mask`). It used to be written twice: the world fight board's
// `build_args_from_dungeon` walked the rect against `dungeon.shape_mask`, and the simulator's `board.ts`
// walked it again against its own decoded mask. Two loops over one convention means a mask change can land on
// one board and not the other — a player would see a different SHAPE in the simulator than in the game.
//
// This pins the property that matters: for the same width/height/mask, both boards paint the same voids.

import { describe, expect, it } from 'bun:test'
import { decode_shape_mask, voids_from_shape_mask } from '@aresrpg/fight/board_state'
import { encode } from '@aresrpg/fight/los'
import { generate } from '@aresrpg/sim/board_gen'

import { build_args_from_dungeon } from '../world-shell/voxel_fight_folds.js'

import { board_of } from './board'

/** The canonical INSIDE-cell set for a plus-shaped 3×3 room (the corners are the voids). */
const plus_mask = new Set([encode(1, 0), encode(0, 1), encode(1, 1), encode(2, 1), encode(1, 2)])

describe('voids twin — one shape-mask complement for both boards', () => {
  it('the world board folds exactly the shared derivation', () => {
    const dungeon = { id: 'twin', room_index: 0, grid_width: 3, grid_height: 3, shape_mask: plus_mask }
    const args = build_args_from_dungeon(dungeon)
    expect(args.voids).toEqual(voids_from_shape_mask(args.grid_w, args.grid_h, plus_mask))
  })

  it('the simulator board folds exactly the shared derivation over the CHAIN generator output', () => {
    // Re-derive the mask INDEPENDENTLY from the chain generator (not from the board's own voids — that would
    // be circular) and prove the derived board painted the shared complement of it.
    let saw_voids = false
    for (const nonce of [0, 1, 2, 7, 13]) {
      const board = board_of(0xc0ffee, nonce)
      const { shape_mask } = generate(board.board_seed, 0)
      const expected = voids_from_shape_mask(board.width, board.height, decode_shape_mask(shape_mask))
      expect(board.voids).toEqual(expected)
      // the world board, handed the SAME dims + mask, paints byte-identical voids
      const args = build_args_from_dungeon({
        id: `sim_${nonce}`,
        room_index: 0,
        grid_width: board.width,
        grid_height: board.height,
        shape_mask: decode_shape_mask(shape_mask),
      })
      if (expected.length > 0) {
        saw_voids = true
        expect(args.voids).toEqual(expected)
      }
    }
    // the assertion above is only meaningful if at least one generated board actually HAS voids
    expect(saw_voids).toBe(true)
  })

  it('an unpublished (empty) mask yields NO voids on either board — the full rect renders', () => {
    expect(voids_from_shape_mask(4, 4, new Set())).toEqual([])
    const args = build_args_from_dungeon({ id: 'legacy', room_index: 0, grid_width: 4, grid_height: 4 })
    expect(args.voids).toBeUndefined()
  })

  it('the complement is row-major and covers exactly the off-cells', () => {
    expect(voids_from_shape_mask(3, 3, plus_mask)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ])
  })
})
