// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('level 30 exposes R, starts a combined timer once, and Escape cancels the run', async ({ page }) => {
  await page.goto('/e2e/fixtures/collect_all.html')
  await expect(page.locator('#tag')).toContainText('to collect all')
  await page.getByRole('textbox', { name: 'Chat' }).focus()
  await page.keyboard.press('r')
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().gathers)).toBe(0)
  await page.getByRole('textbox', { name: 'Chat' }).blur()
  await page.keyboard.press('r')
  await expect(page.getByText('Collecting all · 0/2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop (Esc)' })).toBeVisible()
  await page.keyboard.press('r')
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().gathers)).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Stop (Esc)' })).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().run)).toBeNull()
})
