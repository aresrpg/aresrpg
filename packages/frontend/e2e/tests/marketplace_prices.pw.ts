// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const mode of ['mixed-history', 'tiny']) {
  test(`daily candlesticks render and expose OHLC for ${mode}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/e2e/fixtures/marketplace.html?stackable&${mode}`)
    const history = page.locator('[data-marketplace-price-history]')
    const plot = history.locator('[data-tradingview-prices]')
    await expect(plot.locator('canvas').first()).toBeVisible()
    const bounds = await plot.boundingBox()
    await plot.hover({ position: { x: bounds!.width * 0.7, y: bounds!.height * 0.5 } })
    const inspection = history.locator('[data-price-inspection]')
    await expect(inspection).toContainText('Open ')
    await expect(inspection).toContainText('High ')
    await expect(inspection).toContainText('Low ')
    await expect(inspection).toContainText('Close ')
    if (mode === 'tiny') await expect(inspection).toContainText('0.000000000001')
    else await expect(history).toContainText('Older days contain averages only and appear blank.')
    await page.screenshot({ path: `test-results/marketplace-candles-${mode}.png` })
    await history.getByRole('button', { name: '7D', exact: true }).click()
    await expect(plot.locator('canvas').first()).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('average-only history leaves the chart blank while retaining capitalization', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable&legacy')
  const history = page.locator('[data-marketplace-price-history]')
  await expect(history.getByRole('status')).toContainText('Older days contain averages only and appear blank.')
  await expect(history.locator('[data-tradingview-prices]')).toHaveCount(0)
  await expect(page.locator('[data-marketplace-capitalization]')).toContainText('10.90')
})
