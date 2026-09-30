// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('fight loot opens the received rolls, including distinct copies of the same equipment', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  const first = page.locator('[data-owned-item-id="new-sword-a"]')
  const second = page.locator('[data-owned-item-id="new-sword-b"]')
  await expect(first).toBeVisible()
  await expect(first).toContainText('+2')
  await expect(first).toContainText('+4')
  await expect(second).toContainText('+5')
  await expect(second).toContainText('+1')
  await expect(page.locator('[data-owned-item-id="old-sword"]')).toHaveCount(0)
  await expect(first).not.toContainText('+1 to 5')
})

test('loot details wait for the exact inventory rows without substituting an older copy', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&pending')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  await expect(page.locator('[data-owned-item-id]')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-loot-arrived')))
  await expect(page.locator('[data-owned-item-id="new-sword-a"]')).toBeVisible()
  await expect(page.locator('[data-owned-item-id="new-sword-b"]')).toHaveCount(1)
})
