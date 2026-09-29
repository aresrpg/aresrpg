// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('world graphics controls persist through a real page reload', async ({ page }) => {
  const errors: string[] = []
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/settings.html')
  const panel = page.locator('[data-tutorial-target="fps"]:visible')
  const quality = panel.locator('select')
  for (const tier of ['low', 'medium', 'high']) {
    await quality.selectOption(tier)
    await expect(quality).toHaveValue(tier)
  }
  await page.reload()
  await expect(quality).toHaveValue('high')
  await quality.selectOption('medium')
  await page.reload()
  await expect(quality).toHaveValue('medium')
  expect(errors).toEqual([])
  expect(workers).toEqual([])
})
