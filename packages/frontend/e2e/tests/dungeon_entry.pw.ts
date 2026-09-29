// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('Sceat refuses entry without the key and opens the ordinary modal once it is available', async ({ page }) => {
  await page.goto('/e2e/fixtures/dungeon_entry.html')
  await page.getByRole('button', { name: 'Talk F' }).click()
  await expect(page.locator('#speech')).toContainText("I can't let you pass if you don't have the")
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Give required key' }).click()
  await page.getByRole('button', { name: 'Talk F' }).focus()
  await page.keyboard.press('KeyF')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-dungeon-entry-card]')).toBeVisible()
  await expect(page.locator('#speech')).toHaveText('')
})
