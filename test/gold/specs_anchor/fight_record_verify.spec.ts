// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { boot_fixture_world, gold_manifest, type FightFixture, type GoldWallet } from './fight_mouse_helpers'
import { play_recorded_multi_turn_fight } from './fight_record_helpers'

// THE ADAPTIVE FIGHT ROW: a DETERMINISTIC end-to-end fight that ALWAYS joins a world,
// searches the zone, teleports to the nearest fight, waits the travel time, ADAPTS to the mob layout, plays turns
// MOUSE-ONLY, and RECORDS exactly what's rendered (cast→VFX beats, floats, HP repaints, fight timers) to VERIFY it
// against present.js's ~3s/mob pacing law and the receipt-derived HP truth. Runs under the normal AND @lagged
// projects (playwright.anchor.config.ts): green under both = the composition gap closed on localnet.
test.describe('gold localnet — the adaptive fight, recorded and verified', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed @lagged ADAPTIVE FIGHT RECORD · join → search → engage → ≥3 mouse turns → recorded VFX/HP/timers verified', async ({
    page,
  }) => {
    test.setTimeout(480_000)
    const fixture = gold_manifest.fight_fixtures?.multi_turn as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.multi_turn').toBeTruthy()
    const [, , wallet] = gold_manifest.wallets as GoldWallet[]
    expect(wallet, 'gold bootstrap did not publish wallet 2').toBeTruthy()
    await boot_fixture_world(page, wallet, fixture!)
    const result = await play_recorded_multi_turn_fight(page, fixture!)
    // The recording artifact is the human-readable proof of "exactly what's happening".
    expect(result.player_turns, 'the recorded fight must reach ≥3 player turns').toBeGreaterThanOrEqual(3)
    expect(result.recording.trace.length, 'the render trace recorded nothing').toBeGreaterThan(0)
  })
})
