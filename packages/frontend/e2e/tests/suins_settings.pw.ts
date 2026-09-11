// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('Settings selects owned and target-only names, reports refusal, and fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.goto('/e2e/fixtures/suins_settings.html')
  const section = page.locator('[data-suins-settings]')
  const use = section.getByRole('button', { name: 'Use this name' })
  await section.getByRole('combobox', { name: 'Owned names' }).selectOption('mine.sui')
  await use.click()
  await expect(use).toBeDisabled()
  await expect(section.locator('strong')).toHaveText('mine.sui')
  await expect(page.locator('body')).toHaveAttribute('data-name-writes', '1')
  await section.getByRole('textbox', { name: 'Name or subname' }).fill('sceat@sceat')
  await use.click()
  await expect(section.locator('strong')).toHaveText('@sceat')
  await expect(section.locator('strong')).toHaveAttribute('title', 'sceat.sceat.sui')
  await section.getByRole('textbox', { name: 'Name or subname' }).fill('foreign.sui')
  await use.click()
  await expect(section.getByRole('alert')).toContainText('owned by your game wallet')
  await expect(section.locator('strong')).toHaveText('@sceat')
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/suins-settings.png', fullPage: true })
})
