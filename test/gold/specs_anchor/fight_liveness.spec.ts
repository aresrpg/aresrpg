// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import {
  boot_fixture_world,
  gold_manifest,
  play_fixture_fight,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'

test.describe('gold localnet — fight teardown liveness', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed FIGHT TEARDOWN · settlement releases the fight and restores the live world', async ({ page }) => {
    test.setTimeout(300_000)
    const fixture = gold_manifest.fight_fixtures?.win as FightFixture | undefined
    // Reuse the wallet-0 physical-win lane: wallets 1/2/3 retain their Yajin, XP-freshness, and loss fixtures.
    const [wallet] = gold_manifest.wallets as GoldWallet[]
    expect(fixture, 'gold bootstrap did not publish the deterministic teardown fixture').toBeTruthy()
    expect(wallet, 'gold bootstrap did not publish wallet 0').toBeTruthy()

    await boot_fixture_world(page, wallet, fixture!)
    const { spawn_id } = await play_fixture_fight(page, fixture!, { expected: 'win' })
    expect(spawn_id, 'the teardown proof must consume a real world spawn').toBeTruthy()

    const returned = await page.evaluate(async () => {
      const { use_world_binding } = await import('/src/world-shell/session_gate.js')
      // mirror kill 07-17: fight truth reads the core's view door (null after teardown); fight_mode is
      // still engine state (the fight edge flips it on the fight's null edge).
      const { fight_view } = await import('/@id/@aresrpg/fight')
      const state = (window as any).__ARES_ENGINE?.get_state()
      return {
        fight: fight_view() ?? null,
        fight_mode: !!state?.fight_mode,
        world_id: use_world_binding.getState().world ?? null,
        board: (window as any).__voxel_board?._descriptor?.() ?? null,
      }
    })
    expect(returned).toEqual({
      fight: null,
      fight_mode: false,
      world_id: fixture!.world_id,
      board: null,
    })
    await expect(page.locator('.hud-fightctl')).toHaveCount(0)
    await expect(page.locator('.gw-selfplate')).toBeVisible()
  })
})
