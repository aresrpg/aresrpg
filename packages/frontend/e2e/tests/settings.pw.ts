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
  const flat = panel.locator('button[data-flat-locked]')
  await expect(flat).toBeEnabled()
  await flat.click()
  await expect(flat).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(quality).toHaveValue('high')
  await expect(flat).toHaveAttribute('aria-pressed', 'true')
  await quality.selectOption('medium')
  await flat.click()
  await page.reload()
  await expect(quality).toHaveValue('medium')
  await expect(flat).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
  expect(workers).toEqual([])
})

test('flat fallback keeps its graphics control locked across a reload', async ({ page }) => {
  await page.goto('/e2e/fixtures/settings.html?fallback')
  const flat = page.locator('button[data-flat-locked]')
  await expect(flat).toBeDisabled()
  await expect(flat).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(flat).toBeDisabled()
  await expect(flat).toHaveAttribute('aria-pressed', 'true')
})
