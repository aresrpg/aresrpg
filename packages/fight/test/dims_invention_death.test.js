// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RIDER B(b) — the two dims-INVENTIONS die (D771: "we never need fallback of proper systems"; hold on
// not-found, never invent dims). A dims-less record used to fabricate a phantom full GRID_W×GRID_H (20×19)
// frame at two seams; both now HOLD at 0 (an unrepresentable board) instead.
//
//   1. board_state.js:151-152 — `Number(fight.width) || GRID_W`: the core view builder invented dims for a
//      torn read. The snapshot door already gates fight_geometry_complete, so a real fight always has dims;
//      a dims-less one now yields grid_width/grid_height 0.
//   2. project.js:138-139 — `Number(view.grid_width) || GRID_W`: arena walkability invented a full walkable
//      window for a dims-less view (the OPEN roam plane hits this by design). It now yields ZERO walkable cells.

import { describe, expect, test } from 'bun:test'

import { board_state_from_fight } from '../src/board_state.js'
import { empty_core_state } from '../src/core.js'
import * as project from '../src/project.js'

/** A decoded-Fight-shaped object MISSING its BoardGeom (width/height) — the torn / dims-less shape. */
const dimless_fight = () => ({
  id: '0xtorn',
  status: 5,
  participants: [{ owner: '0xme', character: '0xchar', team: 0, hp: 30, max_hp: 30, cell: 0 }],
  mobs: [],
  obstacles: [],
  holes: [],
  // deliberately NO width / height
})

describe('RIDER B(b) — dims inventions die (hold-on-not-found, never a phantom board)', () => {
  test('board_state_from_fight holds a dims-less fight at 0×0 — never a phantom GRID_W×GRID_H', () => {
    const view = board_state_from_fight({ fight: dimless_fight(), version: 1 })
    // Was `|| GRID_W` / `|| GRID_H` → a fabricated 20 / 19. D771: 0, an unrepresentable board that holds.
    expect(view.grid_width).toBe(0)
    expect(view.grid_height).toBe(0)
    expect(view.width).toBe(0)
  })

  test('project arena invents NO walkable cells for a dims-less (OPEN roam) view', () => {
    // A dims-less view fed straight to the exported projector (the OPEN roam plane's own shape: no BoardGeom).
    const state = {
      view: { id: '0xopen', escrow: [], mobs: [], turn_queue: [], obstacles: [], holes: [], status: 0 },
      entries: {},
      // A projection input carries a core exactly as a real store atom does — committed truth has ONE source
      // (#1027) and no coreless arm to fall back to.
      core: empty_core_state(null),
      wave: [],
      my_key: null,
      applied_version: 0,
      turn_deadline_ms: null,
    }
    const projected = project.engine_view(state, { roster: [] })
    // Was `|| GRID_W` → a full 20×19 WALKABLE phantom arena. D771: zero walkable cells (no invented arena).
    expect(projected.arena.cells.some((c) => c === 0)).toBe(false)
  })
})
