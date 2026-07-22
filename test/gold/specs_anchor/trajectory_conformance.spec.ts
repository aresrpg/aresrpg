// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRAJECTORY CONFORMANCE — the "right place during movements" lock, measured on a REAL driven fight: every
// glb position must be logged and verified as being in the right place during movements. The engine
// position-trace tap (packages/engine/src/tactical/pos_trace.js) records every tactical rig's world position
// at ~15Hz into window.__ARES_POS_TRACE; this spec drives the proven multi-turn fight (mouse-only, a structural
// multi-cell opening move + per-turn moves), pulls the trace, and runs the pure trajectory evaluator
// (trajectory_eval.ts) — the executable twin of the four checks. It asserts the SNAP-THEN-RUN fix (620f8f6f)
// holds end-to-end: no rig ever discontinuously jumps mid-walk (the "teleported me on the target cell then
// rolled me back then made me run on it" signature the outcome-only suite let pass).
//
// DIAGNOSTIC-FIRST (ratchet-up law): this row is NOT in require_driven_fight_green's marker set (its title
// carries no "MULTI-TURN"/"ADAPTIVE FIGHT RECORD" substring), so it never gates a deploy until it has been
// proven green on a real localnet rig — the lead flips it into the gate later, exactly as PACING CONFORMANCE
// and AOE ZONE (its measurement siblings) stage in.
//
// Geometry-only mode: the evaluator is called with moves=[] — in a no-teleport chip-mob fixture, ANY jump
// > 1.5 cells between consecutive ~15Hz samples is a snap, so the discontinuity scan alone locks the class
// without coupling to per-move beats. If a future fixture mob legitimately teleports, pass its window as a
// { kind:'teleport' } MoveBeat to excuse its one lawful jump.
import { expect, test } from '@playwright/test'

import {
  boot_fixture_world,
  gold_manifest,
  play_multi_turn_fight,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'
import { DEFAULT_CELL_SIZE, evaluate_trajectory, type PosSample } from './trajectory_eval'

test.describe('TRAJECTORY CONFORMANCE over a driven fight', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed TRAJECTORY CONFORMANCE · glb positions stay on-path (no snap-then-run) throughout a driven fight', async ({
    page,
  }) => {
    test.setTimeout(480_000)
    const fixture = gold_manifest.fight_fixtures?.multi_turn as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.multi_turn').toBeTruthy()
    const [, , wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 2').toBeTruthy()

    // Enable the pos-trace tap BEFORE app boot — the tap's documented bench idiom (addInitScript sets the
    // global at document-start on every navigation, including boot_fixture_world's internal goto).
    await page.addInitScript(() => {
      ;(globalThis as any).__ARES_POS_TRACE_ON = 1
    })

    await boot_fixture_world(page, wallet, fixture!)
    await play_multi_turn_fight(page, fixture!)

    const rows = (await page.evaluate(() => (window as any).__ARES_POS_TRACE ?? null)) as
      { t: number; id: string; x: number; y: number; z: number; cell: any }[] | null

    // COVERAGE GATE (SKIP ≠ PASS): the tap must have installed AND recorded real motion — an empty/absent
    // trace proves nothing and must never bless the discontinuity assertion below as vacuously green.
    expect(rows, 'window.__ARES_POS_TRACE absent — the pos-trace tap never installed (flag/mount)').toBeTruthy()
    const trace: PosSample[] = rows!.map((r) => ({ t: r.t, id: r.id, x: r.x, y: r.y, z: r.z }))
    expect(trace.length, 'the pos-trace tap recorded no samples during the driven fight').toBeGreaterThan(0)

    const span_cells = (id: string) => {
      const xs = trace.filter((s) => s.id === id)
      const [xmin, xmax] = [Math.min(...xs.map((s) => s.x)), Math.max(...xs.map((s) => s.x))]
      const [zmin, zmax] = [Math.min(...xs.map((s) => s.z)), Math.max(...xs.map((s) => s.z))]
      return Math.hypot(xmax - xmin, zmax - zmin) / DEFAULT_CELL_SIZE
    }
    const movers = [...new Set(trace.map((s) => s.id))]
    const max_span = Math.max(0, ...movers.map(span_cells))
    expect(
      max_span,
      'no rig moved ≥1.5 cells — the driven fight produced no multi-cell trajectory to judge'
    ).toBeGreaterThanOrEqual(1.5)

    const verdict = evaluate_trajectory(trace, [], { cell_size: DEFAULT_CELL_SIZE })
    await test.info().attach('trajectory_verdict.json', {
      body: JSON.stringify({ trace_rows: trace.length, max_span, ...verdict }, null, 2),
      contentType: 'application/json',
    })

    // THE LOCK — no rig discontinuously jumps (> 1.5 cells between consecutive ~15Hz samples) anywhere in the
    // fight. In this no-teleport fixture every such jump is a snap-then-run tell; the fix (620f8f6f) makes the
    // array empty.
    expect(
      verdict.discontinuity_violations,
      'a rig jumped discontinuously mid-move — snap-then-run regressed (see trajectory_verdict.json)'
    ).toEqual([])
  })
})
