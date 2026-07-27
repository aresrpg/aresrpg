// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #300/#398 — movement and casting share ONE ordered draft anchor. The FIX evolves the committed caster cell through
// every staged move/cast via the deterministic sim twin (evolve_caster_cell); a TELEPORT/SWAP, ordinary successful
// move, or denied tackle therefore leaves the exact cell the next action reads. The pure
// DECISION is unit-driven in @aresrpg/fight (predict_cast.test.js → evolve_caster_cell, incl. the 3-vs-1 cost
// delta). This locks the WIRING: the draft math lives inside a browser-only component (DungeonBoard.jsx imports the
// 3D engine → not headless-importable, no jsdom), so a source-contract is the red at HEAD — same rationale as
// dungeon_board_flush_evolved.test.js.

import { describe, expect, test } from 'bun:test'

describe('DungeonBoard — the next-action anchor evolves through the ordered draft (#300/#398)', () => {
  test('reach, walk, and cast validation read draft_caster_cell from the full action sequence', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    // the anchor is committed truth evolved through the full staged sequence via the sim-twin door.
    expect(src).toMatch(/evolve_caster_cell[^}]*\}\s*from\s*'@aresrpg\/fight\/predict_cast'/)
    expect(src).toMatch(/const draft_caster_cell = useMemo\(/)
    expect(src).toMatch(/evolve_caster_cell\(\{/)
    expect(src).toMatch(/actions:\s*evolution_actions_of\(/)
    // Every next-action consumer reads that cell. Remaining MP is the already-folded ordered pool, so no flattened
    // moves-only path can charge across an intervening teleport or denied tackle.
    expect(src).toMatch(/bfsReachable\(draft_caster_cell, my_mp_eff, blocked\)/)
    expect(src).toMatch(/move_plan_dungeon\(\s*\{ cell: decode\(draft_caster_cell\) \}/)
    expect(src).toMatch(/const caster_cell = draft_caster_cell/)
    expect(src).not.toMatch(/draft_move_cost\(/)
    // the memo re-runs whenever the canonical stage grows.
    expect(src).toMatch(/fight\?\.draft_count/)
    // the pre-fix stale reads are gone: no next-action path anchors on raw committed/display state.
    expect(src).not.toMatch(/const start = me\.committed\?\.cell \?\? me\.cell/)
    expect(src).not.toMatch(/const chain_cell = me\.committed\?\.cell \?\? me\.cell/)
  })
})

describe('DungeonBoard — an M2b-claimed silent MP grant is spendable exactly once (#332)', () => {
  test('the click budget reads the presented ordered-prefix pool, never a second grant rule', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    // Ordered drafts + budget_claims converge: the presented pool already folds every claimed grant exactly
    // once, so the click budget reads it directly. The once-only behavior itself is asserted in the fight
    // package's grant/vanish suites; this contract locks the board to the ONE pool.
    expect(src).toMatch(/const my_mp_eff = Math\.max\(0, me\?\.mp \?\? my_mp\)/)
    expect(src).not.toMatch(/movement_grant\(/)
    expect(src).not.toMatch(/drafted_mp_grant - my_claimed_mp/)
    expect(src).not.toMatch(/cast_path\.reduce\([^\n]*mp_grant/)
  })
})
