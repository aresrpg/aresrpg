// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #300 — WALKING AFTER A TELEPORT CHARGED MP FROM THE PRE-TELEPORT CELL. The movement draft anchored its cost on
// `me.committed.cell` (the committed fold — my drafted teleport EXCLUDED), so after a senshi teleport a 1-cell walk
// measured 3 MP from the pre-teleport origin: the reach shrank and the MP read wrong. The FIX evolves the committed
// caster cell through the drafted casts (cast_first) via the deterministic sim twin (evolve_caster_cell) — a
// TELEPORT/SWAP among them relocates the anchor to the landing cell the chain charges the next move from. The pure
// DECISION is unit-driven in @aresrpg/fight (predict_cast.test.js → evolve_caster_cell, incl. the 3-vs-1 cost
// delta). This locks the WIRING: the draft math lives inside a browser-only component (DungeonBoard.jsx imports the
// 3D engine → not headless-importable, no jsdom), so a source-contract is the red at HEAD — same rationale as
// dungeon_board_flush_evolved.test.js.

import { describe, expect, test } from 'bun:test'

describe('DungeonBoard — the movement-draft cost anchor evolves through drafted casts (#300)', () => {
  test('reachable + optimistic-walk read move_anchor_cell (evolve_caster_cell), never the raw committed cell', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    // the anchor is the committed cell EVOLVED through the drafted casts (cast_first) via the sim-twin door…
    expect(src).toMatch(/evolve_caster_cell[^}]*\}\s*from\s*'@aresrpg\/fight\/predict_cast'/)
    expect(src).toMatch(/const move_anchor_cell = useMemo\(/)
    expect(src).toMatch(/if \(!cast_first \|\| !cast_path\.length[\s\S]{0,80}?\) return committed_cell/)
    expect(src).toMatch(/evolve_caster_cell\(\{/)
    // …and BOTH movement-cost homes read THAT anchor — never a raw `me.committed.cell` recomputed for the move cost.
    expect(src).toMatch(/draft_move_cost\(move_path, move_anchor_cell,/)
    expect(src).toMatch(/const chain_cell = move_anchor_cell/)
    // the reachable memo re-runs when the anchor shifts (a drafted teleport moves it).
    expect(src).toMatch(/move_path, move_anchor_cell, optimistic_vacated/)
    // the pre-fix stale reads are gone: no move-cost path anchors on the raw committed/presented cell any more.
    expect(src).not.toMatch(/const start = me\.committed\?\.cell \?\? me\.cell/)
    expect(src).not.toMatch(/const chain_cell = me\.committed\?\.cell \?\? me\.cell/)
  })
})

describe('DungeonBoard — an M2b-claimed silent MP grant is spendable exactly once (#332)', () => {
  test('the click budget adds only the core-correlated pending intent remainder', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    expect(src).toMatch(/const my_pending_mp = me\?\.committed\?\.pending_mp \?\? 0/)
    expect(src).toMatch(/const my_mp_eff = my_mp \+ movement_grant\(cast_first, my_pending_mp\)/)
    expect(src).not.toMatch(/drafted_mp_grant - my_claimed_mp/)
    expect(src).not.toMatch(/cast_path\.reduce\([^\n]*mp_grant/)
  })
})
