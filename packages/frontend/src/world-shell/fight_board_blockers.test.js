// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'
import { encode } from '@aresrpg/fight/los'

import { presentation_blocked_cells } from './fight_board_blockers.js'

const cell = (x, y) => ({ x, y })

const dungeon = {
  id: '0xboard',
  room_index: 0,
  grid_width: 4,
  grid_height: 4,
  shape_mask: new Set([
    encode(0, 0),
    encode(1, 0),
    encode(2, 0),
    encode(3, 0),
    encode(0, 1),
    encode(1, 1),
    encode(2, 1),
    encode(3, 1),
    encode(0, 2),
    encode(1, 2),
    encode(2, 2),
    encode(3, 2),
    encode(0, 3),
    encode(1, 3),
    encode(2, 3),
    encode(3, 3),
  ]),
  obstacles: [encode(3, 3)],
  holes: [encode(0, 3)],
  escrow: [{ character: 'hero', alive: true, cell: encode(0, 0) }],
  mobs: [{ alive: true, cell: encode(1, 1) }],
}

describe('presentation_blocked_cells', () => {
  it('drops a snapshot-stale corpse cell on the death board mutation', () => {
    const before = new Map([
      ['hero', { id: 'hero', cell: cell(0, 0), dead: false }],
      ['mob-0', { id: 'mob-0', cell: cell(1, 1), dead: false }],
    ])
    const after = new Map(before)
    after.set('mob-0', { id: 'mob-0', cell: cell(1, 1), dead: true })

    expect(presentation_blocked_cells(dungeon, before, 'hero').has(encode(1, 1))).toBe(true)
    expect(presentation_blocked_cells(dungeon, after, 'hero').has(encode(1, 1))).toBe(false)
    expect(dungeon.mobs[0].alive).toBe(true)
  })

  it('moves the blocker immediately when a presentation fighter is displaced', () => {
    const fighters = new Map([
      ['hero', { id: 'hero', cell: cell(0, 0), dead: false }],
      ['mob-0', { id: 'mob-0', cell: cell(2, 1), dead: false }],
    ])
    const blocked = presentation_blocked_cells(dungeon, fighters, 'hero')

    expect(blocked.has(encode(1, 1))).toBe(false)
    expect(blocked.has(encode(2, 1))).toBe(true)
  })

  // #2025 — INVERTED from the old "keeps a predicted corpse blocked" pin, which made the defect law: MY kill is
  // predicted before it is acked, so committed liveness lags a whole receipt behind the eye and behind the
  // paint's own blocked set. Dead in EITHER projection frees the cell (driven end-to-end in
  // test/world-shell/corpse_cell_release.test.js).
  it('frees a predicted corpse cell while committed liveness still says it is alive', () => {
    const fighters = new Map([
      ['hero', { id: 'hero', cell: cell(0, 0), dead: false, committed_dead: false }],
      ['mob-0', { id: 'mob-0', cell: cell(1, 1), dead: true, committed_dead: false }],
    ])

    expect(presentation_blocked_cells(dungeon, fighters, 'hero').has(encode(1, 1))).toBe(false)
  })

  it('frees a chain-acked corpse cell whose death beat is still holding it visible', () => {
    const fighters = new Map([
      ['hero', { id: 'hero', cell: cell(0, 0), dead: false, committed_dead: false }],
      ['mob-0', { id: 'mob-0', cell: cell(1, 1), dead: false, committed_dead: true }],
    ])

    expect(presentation_blocked_cells(dungeon, fighters, 'hero').has(encode(1, 1))).toBe(false)
  })

  it('keeps static walls, excludes the mover, and honors a guaranteed optimistic vacancy', () => {
    const fighters = new Map([
      ['hero', { id: 'hero', cell: cell(1, 0), dead: false }],
      ['mob-0', { id: 'mob-0', cell: cell(2, 1), dead: false }],
    ])
    const blocked = presentation_blocked_cells(dungeon, fighters, 'hero', new Set([encode(2, 1)]))

    expect(blocked.has(encode(1, 0))).toBe(false)
    expect(blocked.has(encode(2, 1))).toBe(false)
    expect(blocked.has(encode(3, 3))).toBe(true)
    expect(blocked.has(encode(0, 3))).toBe(true)
    expect(blocked.has(encode(4, 0))).toBe(true)
  })
})
