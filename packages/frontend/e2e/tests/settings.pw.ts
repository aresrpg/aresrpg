// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('world graphics controls persist through a real page reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/demo#world')
  await expect(page.getByText(/(?:webgpu · ready|grid · degraded)/)).toBeVisible({ timeout: 60_000 })
  const panel = page.locator('[data-tutorial-target="fps"]:visible')
  const quality = panel.locator('select')
  for (const tier of ['low', 'medium', 'high']) {
    await quality.selectOption(tier)
    await expect(quality).toHaveValue(tier)
  }
  const flat = panel.locator('button[data-flat-locked]')
  const locked = (await flat.getAttribute('data-flat-locked')) === 'true'
  if (locked) {
    await expect(flat).toBeDisabled()
    await expect(flat).toHaveAttribute('aria-pressed', 'true')
  } else {
    await flat.click()
    await expect(flat).toHaveAttribute('aria-pressed', 'true')
  }
  await page.reload()
  await expect(quality).toHaveValue('high')
  await expect(flat).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
