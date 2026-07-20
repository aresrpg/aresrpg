// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ⑭ FLUSH VALIDATES THE EVOLVED SEQUENCE (regression: a turn could commit without the spell — a trap placed
// behind a mob then pushed onto it made the cast look invalid when everything was actually valid). The chain commits ONE PTB in D99
// order, each action reading LIVE evolved state — so a drafted cast MUST be judged against the board the chain
// sees WHEN IT FIRES (the committed base folded through the PRIOR casts' displacements/kills), never the
// optimistic end-state where THIS cast's own push already moved its target and made its own valid cast look
// stale. The evolved-sequence DECISION is unit-driven in @aresrpg/fight (predict_cast.test.js →
// evolve_flush_casts, the sim door). This locks the WIRING, exactly like dungeon_board_walk_from.test.js pins an
// un-driveable render binding: flush_commit lives inside a browser-only component (DungeonBoard.jsx imports the
// 3D engine → not headless-importable, no jsdom), so a source-contract is the red at HEAD.

import { describe, expect, test } from 'bun:test'

describe('DungeonBoard flush — each cast validated against the evolved sequence, not the optimistic occupancy', () => {
  test('flush_commit sources per-cast occupancy from evolve_flush_casts (committed base + prior displacements)', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    // the flush evolves the COMMITTED chain state through the drafted casts (the sim door), keyed PER cast…
    expect(body).toMatch(/evolve_flush_casts\(/)
    expect(body).toMatch(/committed:\s*committed_state\(/)
    expect(body).toMatch(/evolved\[cast_i\]/)
    // …and the per-cast evolved occupancy `occ` — NEVER the eye-state `occupied` — feeds strike LEGALITY
    // (target_is_mob / committed_target_alive / occupied_alive), keyed on `target_cell` (LEG 0a: entry.cell unless
    // txs.retarget_cast recomposed it against the target's moved committed cell — see the test below).
    expect(body).toMatch(/const tgt = occ\.get\(target_cell\)/)
    expect(body).toMatch(/occupied_alive: !!occ\.get\(target_cell\)\?\.alive/)
    expect(body).not.toMatch(/target_is_mob:\s*occupied\.get/)
    expect(body).not.toMatch(/occupied_alive:\s*!!occupied\.get/)
  })
})

// LEG 0a — CAST AUTO-RETARGET (a mob shifting one cell silently invalidated a drafted cast).
// The pure decision (follow a moved target to its committed cell when the draft's own footprint still reaches it,
// else drop + toast) is unit-locked in @aresrpg/fight/test/cast_retarget_leg_0a.test.js. This locks the WIRING —
// same un-driveable-component rationale as the describe above (source-contract, no browser/jsdom).
describe('DungeonBoard flush — a drafted cast auto-retargets onto its moved target (txs.retarget_cast wiring)', () => {
  test('flush_commit resolves the target fighter through the EYE-STATE occupancy, calls retarget_cast, and ships the retargeted cell', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)
    // identity resolution: the ONLY sanctioned `occupied.get(entry.cell)` call — the eye-state still remembers the
    // click-time cell once a fresher committed/evolved read has moved the fighter on, which is exactly why it (and
    // not `occ`) is the right source for "who did I click on".
    expect(body).toMatch(/const eye_target = occupied\.get\(entry\.cell\)/)
    expect((body.match(/occupied\.get\(entry\.cell\)/g) ?? []).length).toBe(1)
    // its committed cell (committed_state, my drafts excluded) feeds txs.retarget_cast alongside the SAME
    // cast_range_set_dungeon footprint the legality check itself reaches through — one geometry home, never a
    // re-implementation — and the result REPLACES entry.cell for the rest of the entry (footprint/occupancy
    // checks + the shipped action target), not just the drop decision.
    expect(body).toMatch(/retarget_cast\(\{/)
    expect(body).toMatch(/target_cell:\s*entry\.cell/)
    expect(body).toMatch(/committed_cell:\s*target_committed_cell/)
    expect(body).toMatch(/reaches:\s*\(cell\)\s*=>\s*footprint\.has\(cell\)/)
    expect(body).toMatch(/target_cell = retargeted\.target/)
    expect(body).toMatch(/kind: 2, target: target_cell/)
    expect(body).toMatch(/kind: 1,\s*\n\s*target: target_cell/)
    // an unreachable retarget drops (never silently) and requests the additive toast — never re-using the generic
    // "stale" key, so the player learns WHY (a chase that failed vs. some other flush-time invalidation).
    expect(body).toMatch(/if \(retargeted\.dropped\)/)
    expect(body).toMatch(/dungeons\.cast_target_unreachable/)
  })
})
