// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('Blast cards show honest stages and bounded progress without wallet or sale actions', async ({ page }) => {
  await page.goto('/e2e/fixtures/blast_sale.html')
  await expect(page.getByRole('link')).toHaveCount(4)
  await expect(page.locator('[data-card="0"]')).toContainText('Token sale soon on Blast')
  await expect(page.locator('[data-card="0"]').getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-card="1"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
  await expect(page.locator('[data-card="2"]')).toContainText('Sale funded')
  await expect(page.locator('[data-card="2"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expect(page.locator('[data-card="3"]')).toContainText('Sale status unavailable')
  await expect(page.locator('[data-card="3"]').getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  for (const image of await page.locator('img').all())
    expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(page.locator('body')).not.toContainText(/oversubscribed|minimum reached/i)
  await page.screenshot({ path: 'test-results/blast-sale-cards.png', fullPage: true })
})
