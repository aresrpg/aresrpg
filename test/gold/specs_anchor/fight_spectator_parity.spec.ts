// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { expect, test, type BrowserContext } from '@playwright/test'

import {
  boot_roster_lite,
  chain_truth_export,
  watch_fight_by_door,
  type GoldWallet,
} from '../specs_multiplayer/coop_helpers'

import { boot_fixture_world, gold_manifest, play_fixture_fight, type FightFixture } from './fight_mouse_helpers'

test.describe('gold localnet — solo fight spectator export parity', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed SOLO + SPECTATORS · fighter and two WATCH clients export one committed board', async ({
    browser,
    page,
  }) => {
    test.setTimeout(420_000)
    const fixture = gold_manifest.fight_fixtures?.win as FightFixture | undefined
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.win').toBeTruthy()
    const wallets = gold_manifest.wallets as GoldWallet[]
    expect(wallets.length, 'gold bootstrap did not publish three wallets for the spectator row').toBeGreaterThanOrEqual(
      3
    )

    const spectator_contexts: BrowserContext[] = []
    const spectator_page = async (wallet: GoldWallet) => {
      const spectator_context = await browser.newContext()
      spectator_contexts.push(spectator_context)
      const spectator_page = await spectator_context.newPage()
      await boot_roster_lite(spectator_page, wallet)
      return spectator_page
    }

    try {
      await boot_fixture_world(page, wallets[0], fixture!)
      const [spectator_page_1, spectator_page_2] = await Promise.all([
        spectator_page(wallets[1]),
        spectator_page(wallets[2]),
      ])

      await play_fixture_fight(page, fixture!, {
        expected: 'win',
        on_active: async (fight_id) => {
          await Promise.all([
            watch_fight_by_door(spectator_page_1, fight_id, fixture!.world_id),
            watch_fight_by_door(spectator_page_2, fight_id, fixture!.world_id),
          ])
        },
        on_turn_settled: async () => {
          const pages = [page, spectator_page_1, spectator_page_2]
          await expect
            .poll(
              async () => {
                const exports = await Promise.all(pages.map(chain_truth_export))
                const [first, ...rest] = exports.map((board) => JSON.stringify(board))
                return {
                  observers: exports.length,
                  ready: exports.every((board) => board !== null),
                  diverged: rest.filter((board) => board !== first).length,
                }
              },
              { timeout: 60_000, message: 'the fighter and two spectators never converged on one committed board' }
            )
            .toEqual({ observers: 3, ready: true, diverged: 0 })

          const [fighter_export, spectator_1_export, spectator_2_export] = await Promise.all(
            pages.map(chain_truth_export)
          )
          expect(spectator_1_export, 'spectator 1 exported a different committed board').toEqual(fighter_export)
          expect(spectator_2_export, 'spectator 2 exported a different committed board').toEqual(fighter_export)

          const out_dir = new URL('../out/', import.meta.url)
          fs.mkdirSync(out_dir, { recursive: true })
          fs.writeFileSync(new URL('solo_export_fighter.json', out_dir), JSON.stringify(fighter_export, null, 2))
          fs.writeFileSync(
            new URL('solo_export_spectator_1.json', out_dir),
            JSON.stringify(spectator_1_export, null, 2)
          )
          fs.writeFileSync(
            new URL('solo_export_spectator_2.json', out_dir),
            JSON.stringify(spectator_2_export, null, 2)
          )
        },
      })
    } finally {
      for (const spectator_context of spectator_contexts) await spectator_context.close().catch(() => {})
    }
  })
})
