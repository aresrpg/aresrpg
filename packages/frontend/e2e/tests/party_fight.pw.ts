// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/mobile.tsx'

for (const mobile of [false, true]) {
  test(`party remains visible through fight entry and exit on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 })
    await page.goto(`/e2e/fixtures/mobile.html${mobile ? '' : '?desktop'}`)
    const party = page.locator('.party-frame')
    await expect(party).toBeVisible()
    await expect(party.locator('.party-frame__member')).toHaveCount(6)
    if (mobile) {
      expect((await party.boundingBox())!.width).toBeLessThanOrEqual(150)
      expect(
        await party
          .locator('.party-frame__member')
          .evaluateAll((rows) => new Set(rows.map((row) => row.getBoundingClientRect().left)).size)
      ).toBe(1)
    }
    await expect(page.locator('.world-multiplayer')).toBeVisible()
    await page.evaluate(() => window.mobile_fight(true))
    await expect.poll(() => page.evaluate(() => window.mobile_fight_active())).toBe(true)
    await expect(party).toBeVisible()
    await expect(party).toContainText('Leader')
    await expect(party).toContainText('Companion')
    await expect(page.locator('.world-account .wallet-trigger')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('.world-multiplayer, .gw-minimap')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('party-in-fight.png') })
    await party.locator('.party-frame__member').last().scrollIntoViewIfNeeded()
    await expect(party.locator('.party-frame__member').last()).toBeInViewport()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await page.evaluate(() => window.mobile_fight_active())).toBe(true)
    await page.evaluate(() => window.mobile_fight(false))
    await expect(party).toHaveCount(1)
    await expect(party).toBeVisible()
    await expect(page.locator('.world-multiplayer')).toBeVisible()
  })
}
