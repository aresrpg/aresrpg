// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 932, height: 430 },
]) {
  test(`revenue shows three aligned summaries at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/demo#ui')
    await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Admin', exact: true }).click()
    const revenue = page.locator('[data-kpi-group="revenue"]')
    const cards = revenue.locator('article')
    await expect(cards).toHaveCount(3)
    await expect(cards.last()).toContainText('Total revenue')
    await expect(cards.last()).toContainText('452.13 SUI')
    await expect(cards.last()).toContainText('All time')
    expect(
      await cards.evaluateAll(
        (nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size
      )
    ).toBe(1)
    expect(await revenue.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await revenue.screenshot({ path: test.info().outputPath('revenue.png') })
  })
}
