// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1218 — THE FIGHT-START ROW every drive sheet now carries. The sim's replay gate owns this law offline
// (start_cells_distinct.test.js); this is the same law asserted against a LIVE surface's own read, because a
// fight whose mobs are stacked on the chain is legal-looking to every layer that just renders `m.cell`.
//
// Read off the COMMITTED fold (`cell_committed` / `alive_committed`), never the presented values — at the
// opening beat the eye is still landing bodies, and asserting on that would be asserting on an animation clock.
// Corpses are exempt by construction: mid-fight corpse stacking is legal (#1214), and at placement there are
// no corpses anyway.

import { describe, expect, test } from 'bun:test'

import { assert_start_cells_distinct, summarise } from '../../src/bot/index.js'

const fighter = (id, team, cell, over = {}) => ({
  id,
  team,
  name: id,
  cell,
  cell_committed: cell,
  hp: 100,
  hp_committed: 100,
  hp_max: 100,
  dead: false,
  alive_committed: true,
  is_player: team === 0,
  ...over,
})

const read = fighters => ({ ok: true, my_id: '0xme', fighters })

describe('assert_start_cells_distinct', () => {
  test('two mobs on ONE cell is a FAIL row naming the cell and both fighters', () => {
    const rows = assert_start_cells_distinct(
      read([
        fighter('0xme', 0, { x: 5, y: 5 }),
        fighter('m0', 1, { x: 9, y: 9 }),
        fighter('m1', 1, { x: 9, y: 9 }),
      ]),
    )
    expect(summarise(rows).verdict).toBe('FAIL')
    expect(rows[0].actual).toContain('9,9')
    expect(rows[0].actual).toContain('m0')
    expect(rows[0].actual).toContain('m1')
  })

  test('a legally-placed roster passes, and the row says how many cells it checked', () => {
    const rows = assert_start_cells_distinct(
      read([
        fighter('0xme', 0, { x: 5, y: 5 }),
        fighter('m0', 1, { x: 9, y: 9 }),
        fighter('m1', 1, { x: 9, y: 10 }),
      ]),
    )
    expect(summarise(rows)).toMatchObject({ failed: 0, checks: 1 })
    expect(rows[0].actual).toContain('3')
  })

  test('a corpse sharing a cell is legal — the law is about LIVING fighters (#1214)', () => {
    const rows = assert_start_cells_distinct(
      read([
        fighter('0xme', 0, { x: 5, y: 5 }),
        fighter('m0', 1, { x: 9, y: 9 }),
        fighter('m1', 1, { x: 9, y: 9 }, {
          hp_committed: 0,
          alive_committed: false,
          dead: true,
        }),
      ]),
    )
    expect(summarise(rows).failed).toBe(0)
  })

  test('an unreadable fight FAILS the row rather than passing on nothing', () => {
    // A rig that reports PASS because it could not look is exactly the disease this oracle exists to cure.
    expect(
      summarise(assert_start_cells_distinct({ ok: false, error: 'no read' }))
        .verdict,
    ).toBe('FAIL')
  })
})
