// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('KARES purchases show HD art and review an affordable integer quantity before submitting', async ({ page }) => {
  await page.goto('/e2e/fixtures/mastery_shop.html')
  const art = page.locator('[data-mastery-offer] img').first()
  await expect(art).toHaveAttribute('src', '/item/resource_crate_hd.png')
  await expect.poll(() => art.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(128)
  await page.getByRole('button', { name: 'Buy - 2,000 KARES' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.locator('[data-inputs]')).toHaveText('[]')
  const quantity = dialog.getByRole('spinbutton')
  await quantity.fill('6')
  await expect(dialog.getByRole('button', { name: '—', exact: true })).toBeDisabled()
  await quantity.fill('2.5')
  await expect(dialog.getByRole('button', { name: '—', exact: true })).toBeDisabled()
  await quantity.fill('3')
  await dialog.getByRole('button', { name: 'Buy - 6,000 KARES' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-inputs]')).toHaveText(
    JSON.stringify([{ type: 'mastery/redeem', item_type: 'resource_crate', payment: 'kares', count: 3 }])
  )
})

test('a wallet that can afford one crate buys directly', async ({ page }) => {
  await page.goto('/e2e/fixtures/mastery_shop.html?balance=2000')
  await page.getByRole('button', { name: 'Buy - 2,000 KARES' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-inputs]')).toHaveText(
    JSON.stringify([{ type: 'mastery/redeem', item_type: 'resource_crate', payment: 'kares', count: 1 }])
  )
})

test('staking confirmation is one success toast and never reappears during refresh', async ({ page }) => {
  await page.goto('/e2e/fixtures/mastery_shop.html')
  await page.getByRole('button', { name: 'Confirm stake' }).click()
  const expected = JSON.stringify([{ message: 'Transaction confirmed', type: 'success' }])
  await expect(page.locator('[data-toasts]')).toHaveText(expected)
  await expect(page.locator('[data-finance-panel]')).toBeEmpty()
  await page.getByRole('button', { name: 'Refresh stake' }).click()
  await page.waitForTimeout(50)
  await expect(page.locator('[data-toasts]')).toHaveText(expected)
})
