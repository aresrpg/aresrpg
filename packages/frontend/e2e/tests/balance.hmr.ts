// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a live-reloaded route shares the sidebar balance owner and all later updates', async ({ page }) => {
  await page.goto('/e2e/fixtures/balance_hmr.html')
  await page.getByRole('button', { name: 'Publish balance', exact: true }).click()
  await expect(page.getByLabel('Sidebar balance')).toHaveText('100000000000')
  await expect(page.getByLabel('Staking balance')).toHaveText('100000000000')
  await page.getByRole('button', { name: 'Reload store module', exact: true }).click()
  await expect(page.getByLabel('Store generation')).toHaveText('1')
  await expect(page.getByLabel('Sidebar balance')).toHaveText('100000000000')
  await expect(page.getByLabel('Staking balance')).toHaveText('100000000000')
  await page.getByRole('button', { name: 'Update balance', exact: true }).click()
  await expect(page.getByLabel('Sidebar balance')).toHaveText('150000000000')
  await expect(page.getByLabel('Staking balance')).toHaveText('150000000000')
})
