// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const device_ms of [1_000, 9_000_000_000_000]) {
  test(`opponent timeout follows chain samples with device clock ${device_ms}`, async ({ page }) => {
    await page.addInitScript((time) => {
      Date.now = () => time
    }, device_ms)
    await page.goto('/e2e/fixtures/fight_clock.html')
    await expect(page.locator('.fight-hud__bar')).toBeVisible()
    await expect(page.locator('.fight-hud__crank')).toHaveCount(0)
    await page.evaluate(() => window.sample_fight_clock(120_000))
    await expect(page.locator('.fight-hud__crank')).toBeVisible()
    // A tab suspension invalidates interpolation. A new sample is required to authorize crank.
    await page.evaluate(() => window.sample_fight_clock(130_000, 16_000))
    await expect(page.locator('.fight-hud__crank')).toHaveCount(0)
    await page.evaluate(() => window.sample_fight_clock(131_000))
    await expect(page.locator('.fight-hud__crank')).toBeVisible()
  })
}
