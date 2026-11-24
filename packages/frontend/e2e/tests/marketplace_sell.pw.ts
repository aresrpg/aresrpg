// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a seller lists the reviewed item at the exact price typed, once, and it leaves the bag', async ({ page }) => {
  await page.goto('/e2e/fixtures/portfolio.html')
  await page.getByRole('button', { name: /^Bag/ }).click()
  const item = page.locator('[data-selection-id="0xsword_a"]')
  const open_sale = () => page.getByRole('button', { name: 'List for sale', exact: true }).click()
  await item.click()
  await open_sale()
  const dialog = page.getByRole('dialog', { name: 'List for sale', exact: true })
  await expect(dialog).toBeVisible()
  const list = dialog.getByRole('button', { name: 'List for sale', exact: true })
  const price = dialog.getByLabel('Total price for the lot')
  // No price, or a price that is not an amount, lists nothing.
  await expect(list).toBeDisabled()
  await price.fill('-1')
  await expect(list).toBeDisabled()
  // Cancelling closes the review without a signature; the item's window stays open.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('data-listed')
  await open_sale()
  await price.fill('2.5')
  await list.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-listed', '0xsword_a:2500000000:1:')
  await expect(item).toHaveCount(0)
})
