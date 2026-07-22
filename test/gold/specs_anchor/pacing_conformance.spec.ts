// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPEC §7b PACING CONFORMANCE — the beat grammar + envelope table measured on a REAL driven multi-turn fight.
// The fight is driven by the proven play_multi_turn_fight helper (mouse-only, ≥3 player turns, visible mob
// waves, win); this spec only RECORDS the rendered layer (__ARES_FIGHT_PROBE — what the renderer actually DID)
// and passes the merged trace to the pure §7b evaluator (pacing_envelopes.ts, the SPEC table's executable twin).
//
// THE MEASUREMENT LAW: this spec MEASURES the product against SPEC §7b — it never adjusts the product (or the
// envelopes) to pass. It may legitimately RED on the current build: every red row is the BOOT24e tuning
// worklist (expected first reds: E2 — floating numbers landing at least 1s late;
// teleport-then-walk — the client visibly teleporting to the target cell, rolling back, then re-running
// on it. The once-expected E5 red — the old 700ms death beat under the D floor — was retuned to the
// reference 1500ms hold by the 07-18 canon-tuning pass). Retunes land in pacing_envelopes.ts + SPEC §7b
// (a retune) or in the product — never here.
//
// Probe cap honesty: __ARES_FIGHT_PROBE keeps the last 200 rows per lane; the probe is reset post-boot so a
// driven fight fits, and a truncated trace simply evaluates the surviving suffix (the evaluator is total).
import { expect, test } from '@playwright/test'

import {
  boot_fixture_world,
  gold_manifest,
  play_multi_turn_fight,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'
import { evaluate_trace, type BeatTraceRow } from './pacing_envelopes'

type ProbeRows = {
  beats: { t: number; kind: string; id: string | null }[]
  vfx: { t: number; caster: string }[]
  upserts: { t: number; id: string }[]
}

test.describe('SPEC §7b — pacing conformance over a driven multi-turn fight', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed PACING CONFORMANCE · envelopes hold, grammar order holds, no dead air, no teleport-then-walk', async ({
    page,
  }) => {
    test.setTimeout(480_000)
    const fixture = gold_manifest.fight_fixtures?.multi_turn as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.multi_turn').toBeTruthy()
    const [, , wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 2').toBeTruthy()
    await boot_fixture_world(page, wallet, fixture!)

    // Reset the probe IN PLACE (the adapter holds the object reference) so the trace is this fight's alone.
    await page.evaluate(() => {
      const probe = (window as any).__ARES_FIGHT_PROBE
      if (probe) for (const lane of ['beats', 'vfx', 'upserts']) probe[lane].length = 0
    })

    await play_multi_turn_fight(page, fixture!)

    const probe = (await page.evaluate(
      () => (window as any).__ARES_FIGHT_PROBE ?? { beats: [], vfx: [], upserts: [] }
    )) as ProbeRows
    const trace: BeatTraceRow[] = [
      ...probe.beats.map((row) => ({ t: row.t, lane: 'beat' as const, kind: row.kind, id: row.id })),
      ...probe.vfx.map((row) => ({ t: row.t, lane: 'vfx' as const, kind: 'vfx', id: row.caster })),
      ...probe.upserts.map((row) => ({ t: row.t, lane: 'upsert' as const, kind: 'upsert', id: row.id })),
    ]
    const verdict = evaluate_trace(trace)
    await test.info().attach('pacing_verdict.json', {
      body: JSON.stringify({ trace_rows: trace.length, ...verdict }, null, 2),
      contentType: 'application/json',
    })

    // COVERAGE GATE — a conformance run that measured nothing proves nothing (SKIP ≠ PASS law).
    for (const key of ['E1', 'E2', 'E10'])
      expect(
        verdict.measures.filter((row) => row.key === key).length,
        `envelope ${key} was never measured — the driven fight produced no ${key} beat-pair`
      ).toBeGreaterThanOrEqual(1)

    // ENVELOPES — every measured beat-pair interval inside its SPEC §7b row (±50ms frame jitter).
    // E2 is the gated complaint: the floater lands inside its envelope, never ≥1s after the vfx.
    expect(
      verdict.envelope_violations,
      'beat-pair intervals escaped their §7b envelope rows (see pacing_verdict.json)'
    ).toEqual([])

    // GRAMMAR — no beat before its predecessor presents (the required order: attack → vfx → hit → floater → death).
    expect(verdict.order_violations, 'the §7b beat grammar order was inverted').toEqual([])

    // DEAD AIR — no silent gap swallows a whole mob slot inside a non-local turn (E12).
    expect(verdict.dead_air_violations, 'dead air inside a mob turn exceeded the E12 cap').toEqual([])

    // TELEPORT — no teleport-then-walk: a rig upsert strictly inside a walk (move → arrival) is the
    // "teleported me on the target cell then rolled me back and then made me run on it" signature.
    expect(verdict.teleport_violations, 'a rig was teleport-upserted inside its own walk').toEqual([])
  })
})
