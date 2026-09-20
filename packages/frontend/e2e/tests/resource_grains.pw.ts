// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('all farmer identities render alongside their canonical icons', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1200, height: 990 })
  await page.goto('/e2e/fixtures/resource_grains.html')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('img')).toHaveCount(11)
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  await page.screenshot({ path: 'test-results/grain-identities.png' })
  expect(errors).toEqual([])
})
