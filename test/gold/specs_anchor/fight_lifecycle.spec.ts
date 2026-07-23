// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import {
  boot_fixture_world,
  gold_manifest,
  play_fixture_fight,
  play_multi_turn_fight,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'

test.describe('gold localnet — headed physical fight lifecycle', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')
  test.skip(!gold_manifest?.fight_fixtures?.win, 'gold bootstrap did not publish fight_fixtures.win')

  // LANE LAG flagship row (lane_reports/CLI_TEST_AUDIT.md #5): @lagged re-runs this EXACT scenario through
  // playwright.anchor.config.ts's `lagged` project (Vite → proxy_lag.mjs → the same /v1 api, +700-1000ms/req).
  // A multi-turn fight-to-win only completes if every turn hand-off (SIMDRIVE S1: mob wave + TurnStarted land
  // in the SAME commit_turn receipt the client signs) plays from that receipt, never from an /v1 poll a fast
  // fight easily outruns — the accepted floor: "lag may delay reconciliation, never playability"
  // (packages/frontend/src/world-shell/fight_turn_liveness.test.js:3). Green under chromium-headed AND lagged
  // = the composition gap closed; red under lagged only = a receipt-path regression only lag can surface.
  test('@headed @lagged FULL FIGHT TO WIN · mouse-only engage through reward and clean world return', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const fixture = gold_manifest.fight_fixtures?.win as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.win').toBeTruthy()
    const [wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 0').toBeTruthy()
    await boot_fixture_world(page, wallet, fixture!)
    await play_fixture_fight(page, fixture!, { expected: 'win' })
  })

  // DEFINITION OF DONE (FIGHT_REWRITE_DESIGN): the playwright suites must run and prove a real fight —
  // the real Strawman template (base HP 30), HP-budgeted to
  // a 5-turn Ghost Talon win that guarantees ≥3 player turns, driven mouse-only — player turn → mob wave visibly
  // replays (~3s/mob, VFX with actions) → player
  // turn 2 arms whole and PLAYS → repeat → win — under BOTH the normal and @lagged projects. The single-turn
  // win/loss rows above lied by omission: the HP-1 mob never reached the handoff cycle where the live bugs hid.
  test('@headed @lagged MULTI-TURN CYCLE · ≥3 player turns, visible ~3s mob waves, one floor per turn, win', async ({
    page,
  }) => {
    test.setTimeout(420_000)
    const fixture = gold_manifest.fight_fixtures?.multi_turn as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.multi_turn').toBeTruthy()
    const [, wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 1').toBeTruthy()
    // Wallet 1 SLOT 1 — its slot-0 sibling is the market fixture's reserved buyer (kiosk state not join-clean).
    const row = (gold_manifest.characters as any[]).find((c) => c.wallet_index === 1 && c.slot === 1)
    expect(row, 'gold bootstrap did not mint wallet-1 slot-1').toBeTruthy()
    await boot_fixture_world(page, wallet, fixture!, row!.character_id)
    const result = await play_multi_turn_fight(page, fixture!)

    await test.step('RENDERED-LAYER PARITY', async () => {
      const probe = (await page.evaluate(
        () => (window as any).__ARES_FIGHT_PROBE ?? { beats: [], vfx: [], upserts: [] }
      )) as {
        beats: { t: number; kind: string; id: string | null; spell_id: string | null }[]
        vfx: {
          t: number
          caster: string
          spell_id: string | null
          element: string
          delivered: boolean
        }[]
        upserts: { t: number; id: string; x: number; y: number }[]
      }
      const parity = result.rendered_parity

      expect(
        probe.vfx.some((row) => row.caster === parity.me_id && !!row.spell_id && row.delivered),
        'my cast never mounted a delivered spell VFX'
      ).toBe(true)
      expect(
        probe.beats.some((row) => row.kind === 'cast' && /^mob-/.test(row.id ?? '')),
        'no mob cast reached the rendered beat layer'
      ).toBe(true)
      expect(
        probe.beats.some((row) => row.kind === 'move' && /^mob-/.test(row.id ?? '')),
        'no mob move reached the rendered beat layer'
      ).toBe(true)
      expect(
        probe.beats.filter((row) => /^player-\d+$/.test(row.id ?? '')),
        'ghost player-N ids reached the rendered beat layer'
      ).toHaveLength(0)

      expect(parity.opening_move, 'the rollback probe must use a real drafted destination').not.toEqual(
        parity.opening_old_cell
      )
      expect(
        probe.upserts.filter(
          (row) =>
            row.id === parity.me_id &&
            row.x === parity.opening_old_cell.x &&
            row.y === parity.opening_old_cell.y &&
            row.t > parity.commit_clicked_at &&
            row.t <= parity.opening_wave_drained_at
        ),
        'my rig was upserted back onto the old cell while the opening wave drained'
      ).toHaveLength(0)

      expect(
        parity.during_active_texts,
        'the acting mob had no active timeline card during presentation'
      ).not.toHaveLength(0)
      expect(
        parity.during_active_texts.some((text) => text.includes(parity.me_name)),
        'my timeline card was active over a still-playing mob beat'
      ).toBe(false)
      expect(
        parity.drained_active_texts,
        'my active timeline card did not return after the wave drained'
      ).not.toHaveLength(0)
      expect(parity.drained_active_texts.some((text) => text.includes(parity.me_name))).toBe(true)
    })
  })

  test('@headed FULL FIGHT TO LOSS · mouse-only engage through defeat and clean world return', async ({ page }) => {
    test.setTimeout(300_000)
    const fixture = gold_manifest.fight_fixtures?.loss as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.loss').toBeTruthy()
    const [, , , wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 3').toBeTruthy()
    await boot_fixture_world(page, wallet, fixture!)
    await play_fixture_fight(page, fixture!, { expected: 'loss' })
  })
})
