// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('unique listings retain every item, its exact tooltip, and its own buy action', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html')
  await page
    .locator('[data-marketplace-item-types]')
    .getByRole('button', { name: /^hat\b/i })
    .click()
  const rows = page.locator('[data-marketplace-listings] [data-marketplace-listing-row]')
  await expect(rows).toHaveCount(3)
  await expect(page.locator('[data-marketplace-lot-market]')).toHaveCount(0)
  await expect(page.locator('[data-marketplace-listings]')).not.toContainText('×1')
  await rows.nth(2).locator('[data-marketplace-item]').hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('tooltip')).not.toContainText('unavailable')
  await rows.nth(0).locator('[data-marketplace-item]').hover()
  await expect(page.getByRole('tooltip')).toContainText('+11')
  await expect(page.getByRole('tooltip')).toContainText('3 - 7 damages Fire')
  await page.mouse.move(0, 0)
  await rows.nth(1).locator('[data-marketplace-item]').focus()
  await expect(page.getByRole('tooltip')).toContainText('+27')
  await expect(page.locator('body')).not.toHaveAttribute('data-read-item')
  await rows.nth(1).getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xitem2')
})

test('stackable listings still show only the cheapest ask for each fixed lot', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable')
  await expect(page.locator('[data-marketplace-cheapest-lot]')).toHaveCount(4)
  const single = page.locator('[data-marketplace-cheapest-lot="1"]')
  await expect(single).toContainText('1.10')
  await single.getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xitem1')
})
