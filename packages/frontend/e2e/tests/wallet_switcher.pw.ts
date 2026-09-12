// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('wallet selector retains provider accounts and blocks switching during a transfer', async ({ page }) => {
  await page.goto('/e2e/fixtures/wallet_switcher.html')
  const control = page.locator('[data-wallet-connect]')
  await control.click()
  await page.getByRole('button', { name: 'First wallet', exact: true }).click()
  const accounts = page.locator('[data-wallet-accounts] select')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(accounts.locator('optgroup')).toHaveCount(1)
  await accounts.selectOption('First wallet:0x1111111111111111')
  await expect(page.locator('[data-active-wallet]')).toHaveText('First wallet:0x1111111111111111')
  await accounts.selectOption('connect')
  await page.getByRole('button', { name: 'Second wallet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(accounts.locator('optgroup')).toHaveCount(2)
  await expect(page.locator('[data-active-wallet]')).toHaveText('First wallet:0x1111111111111111')
  await accounts.selectOption('Second wallet:0x2222222222222222')
  await expect(page.locator('[data-active-wallet]')).toHaveText('Second wallet:0x2222222222222222')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await accounts.selectOption('First wallet:0x2222222222222222')
  await expect(page.locator('[data-active-wallet]')).toHaveText('First wallet:0x2222222222222222')
  await page.screenshot({ path: test.info().outputPath('wallet-dropdown.png') })
  await page.getByRole('button', { name: 'Toggle pending transfer' }).click()
  await expect(accounts).toBeDisabled()
})
