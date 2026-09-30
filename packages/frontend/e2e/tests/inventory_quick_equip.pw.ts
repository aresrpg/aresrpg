// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('Shift-click stages equipment without opening details and Cancel restores it', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html')
  const pet = page.locator('[data-equipment-slot="pet"]')
  const item = page.locator('.chr-equip__bag').getByRole('button', { name: 'Siluri', exact: true })
  await item.click({ modifiers: ['Shift'] })
  await expect(pet).toHaveClass(/is-filled/)
  await expect(item).toHaveCount(0)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(pet).not.toHaveClass(/is-filled/)
  await item.click()
  await expect(page.locator('.chr-equip__detail')).toBeVisible()
  await expect(pet).not.toHaveClass(/is-filled/)
})

test('Shift-click on consumables still inspects without consuming', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.locator('.chr-bagtab').nth(1).click()
  await page.getByRole('button', { name: 'Recall Potion', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.chr-equip__detail')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
})
