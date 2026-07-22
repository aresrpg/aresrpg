// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

import {
  boot_fixture_world,
  gold_manifest,
  play_fixture_fight,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'

async function experience(page: Page, character_id: string) {
  return page.evaluate(
    (id) =>
      Number(
        (window as any).__ARES_ENGINE?.get_state().sui.characters.find((row: any) => row.id === id)?.experience ?? -1
      ),
    character_id
  )
}

async function plate_text(page: Page) {
  const plate = page.locator('.gw-selfplate')
  await expect(plate).toBeVisible()
  return `${await plate.locator('.gw-selfplate__lvl').innerText()}|${await plate.locator('.gw-selfplate__xp-t').innerText()}`
}

async function character_row_text(page: Page) {
  await page.locator('[data-launcher="characters"]').click()
  const row = page.locator('.chr-row.is-active')
  await expect(row).toBeVisible()
  const text = `${await row.locator('.chr-row__lvl').innerText()}|${await row.locator('.chr-row__xp').innerText()}`
  await page.locator('[data-launcher="characters"]').click()
  return text
}

test.describe('07-15 fixed-class regression · headed fight settlement', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed XP FRESHNESS · a real win advances self nameplate + character-tab XP without navigation', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const fixture = gold_manifest.fight_fixtures?.win as FightFixture | undefined
    const [, , wallet] = gold_manifest.wallets as GoldWallet[]
    expect(fixture, 'gold bootstrap did not publish the weak XP fixture').toBeTruthy()
    expect(wallet, 'gold bootstrap did not publish wallet 2').toBeTruthy()

    const { character_id } = await boot_fixture_world(page, wallet, fixture!)
    const before_experience = await experience(page, character_id)
    expect(before_experience, 'the selected fixture character has no live experience row').toBeGreaterThanOrEqual(0)
    const before_plate = await plate_text(page)
    const before_row = await character_row_text(page)
    let navigations = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1
    })

    await play_fixture_fight(page, fixture!, { expected: 'win' })

    await expect
      .poll(() => experience(page, character_id), {
        timeout: 45_000,
        message: 'settlement receipt did not advance the live roster experience',
      })
      .toBeGreaterThan(before_experience)
    await expect.poll(() => plate_text(page)).not.toBe(before_plate)
    await expect.poll(() => character_row_text(page)).not.toBe(before_row)
    expect(navigations, 'XP surfaces must converge without a page refresh/navigation').toBe(0)
  })
})
