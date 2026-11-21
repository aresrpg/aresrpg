// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const [width, height] of [
  [1280, 800],
  [390, 844],
] as const)
  test(`the sale header stays at the top while the home page scrolls, in whole SUI, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/e2e/fixtures/blast_sale_bar.html')
    const bar = page.locator('.blast-sale-bar')
    await expect(bar).toContainText('1,918 / 60,000 SUI')
    await expect(bar).toHaveAttribute('href', '/allocation')
    await page.locator('.landing').evaluate((node) => node.scrollTo(0, 900))
    expect((await bar.boundingBox())!.y).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: test.info().outputPath(`sale-bar-${width}.png`) })
  })
