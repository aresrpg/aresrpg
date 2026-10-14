// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`turn timer cannot move the HUD or its actions at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_hud.html?timer')
    await page.getByRole('button', { name: 'End turn', exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    const layout = () =>
      page
        .locator('.aui-combat-hud, .aui-combat-spells, .aui-combat-controls > .aui-button--primary')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect()
            return { x, y, width, height }
          })
        )
    const baseline = await layout()
    for (const remaining of [60, 44, 9, 0, null]) {
      await page.evaluate((value) => window.dispatchEvent(new CustomEvent('hud-timer', { detail: value })), remaining)
      const progress = page.getByRole('progressbar', { name: 'End turn', exact: true })
      if (remaining === null) await expect(progress).toHaveCount(0)
      else {
        await expect(progress).toHaveAttribute('value', String(remaining))
        await expect(page.locator('.aui-combat-controls .aui-progress')).toHaveCSS('position', 'absolute')
        await page.locator('.aui-combat-controls .aui-progress').focus()
        await expect(page.locator('.aui-combat-controls .aui-progress')).toBeFocused()
      }
      expect(await layout()).toEqual(baseline)
    }
  })
}
