// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('picker filters and results use compact rows instead of action buttons', async ({ page }) => {
  await page.goto('/e2e/fixtures/interaction.html')
  await page.getByRole('button', { name: 'Open picker', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Items', exact: true })
  const filter = picker.getByRole('button', { name: /^All/ })
  const row = picker.getByRole('button', { name: /^Item 0\b/ })
  await expect(filter).toHaveCSS('box-shadow', 'none')
  expect((await filter.boundingBox())!.height).toBeLessThanOrEqual(30)
  await expect(row).toHaveCSS('box-shadow', 'none')
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40)
  await picker.getByRole('button', { name: /^Hat/ }).click()
  await expect(picker.getByRole('button', { name: /^Item 0\b/ })).toHaveCount(0)
  await picker.getByRole('button', { name: /^Item 1\b/ }).click()
  await expect(page.getByLabel('Selected item')).toHaveText('1')
})

test.describe('touch picker', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } })
  test('compact rows retain full touch targets', async ({ page }) => {
    await page.goto('/e2e/fixtures/interaction.html')
    await page.getByRole('button', { name: 'Open picker', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Items', exact: true })
    for (const row of [picker.getByRole('button', { name: /^All/ }), picker.getByRole('button', { name: /^Item 0\b/ })])
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })
})
