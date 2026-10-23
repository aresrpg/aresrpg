// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('post errors open a visible dialog without discarding edits; users can resubmit more posts', async ({ page }) => {
  await page.goto('/e2e/fixtures/allocation_entries.html')
  const panel = page.locator('.xpanel')
  await panel.locator('select').selectOption('0x1')
  await panel.locator('input[name="0"]').fill('https://x.com/other/status/1')
  await panel.locator('button[type="submit"], button:not([type])').filter({ hasText: 'Save' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('authored by your connected X account')
  await expect(dialog).toBeInViewport()
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(panel.locator('input[name="0"]')).toHaveValue('https://x.com/other/status/1')
  await panel.locator('input[name="0"]').fill('https://x.com/tester/status/1')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Saved posts')).toHaveText('1')
  await panel.getByRole('button', { name: 'Edit or add posts' }).click()
  await panel.locator('input[name="1"]').fill('https://x.com/tester/status/2')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Saved posts')).toHaveText('1,2')
  await panel.getByRole('button', { name: 'Change X account' }).click()
  const replacement = page.getByRole('dialog')
  await expect(replacement).toContainText('your old submission is removed')
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Saved posts')).toHaveText('1,2')
})
