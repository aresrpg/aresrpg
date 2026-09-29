// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const sex of ['male', 'female']) {
  test(`Senshi ${sex} portrait loads in the turn introduction and timeline`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/mobile_fight.html?intro&sex=${sex}`)
    const intro = page.locator('.fight-hud__turn-card-portrait img')
    const timeline = page.locator('.fight-hud__portrait img')
    await expect(intro).toHaveCount(1)
    await expect(timeline).toHaveCount(2)
    const images = page.locator('.fight-hud__turn-card-portrait img, .fight-hud__portrait img')
    await expect
      .poll(() =>
        images.evaluateAll((nodes) =>
          nodes.every((node) => {
            const image = node as HTMLImageElement
            return image.complete && image.naturalWidth === 512
          })
        )
      )
      .toBe(true)
    await expect(intro).toHaveAttribute('src', new RegExp(`senshi_${sex}.*\\.png`))
    expect(await timeline.first().getAttribute('src')).toBe(await intro.getAttribute('src'))
    await page.screenshot({ path: `test-results/fight-portrait-${sex}.png` })
  })
}
