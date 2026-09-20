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

test('level 29 retains E gathering but cannot start Collect All', async ({ page }) => {
  await page.goto('/e2e/fixtures/collect_all.html?level=29')
  await expect(page.locator('#tag')).toContainText('to collect Wheat')
  await expect(page.locator('#tag')).not.toContainText('to collect all')
  await page.keyboard.press('r')
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().gathers)).toBe(0)
  await page.keyboard.press('e')
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().gathers)).toBe(1)
})

test('Collect All retains its timer and Stop control on another page', async ({ page }) => {
  await page.goto('/e2e/fixtures/collect_all.html')
  await expect(page.locator('#tag')).toContainText('to collect all')
  await page.keyboard.press('r')
  await page.evaluate(() => Reflect.get(window, 'collect_all_page')())
  await expect(page.getByText('Collecting all · 0/2')).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().run.scope.type)).toBe('pack')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Stop (Esc)' })).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'collect_all_state')().run)).toBeNull()
})
