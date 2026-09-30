// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('victory retains its roster and opens independent loot details with readable demo names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/fight_result.html')
  const report = page.locator('.result--fe')
  await expect(report).toBeVisible()
  await expect(report.locator('.fe-row__nametext')).toHaveText(['Senshi', 'Goblin', 'Goblin', 'Goblin'])
  await expect(report.locator('.aui-window-header')).toContainText('Victory')
  const loot = report.locator('button.fe-tile')
  await expect(loot).toHaveCount(6)
  const first_name = (await loot.nth(0).getAttribute('aria-label'))!
  const second_name = (await loot.nth(1).getAttribute('aria-label'))!
  const report_position = await report.boundingBox()
  await loot.nth(0).click()
  expect(await report.boundingBox()).toEqual(report_position)
  expect(await page.locator('.aui-floating-window').evaluate((node) => !node.closest('.fe-stage'))).toBe(true)
  const first = page.getByRole('dialog', { name: first_name, exact: true })
  await expect(first).toBeVisible()
  const window = first.locator('.aui-window')
  const original = (await window.boundingBox())!
  const handle = (await first.locator('.aui-window-header').boundingBox())!
  await page.mouse.move(handle.x + 120, handle.y + 20)
  await page.mouse.down()
  await page.mouse.move(handle.x + 120 - 350, handle.y + 20 - 140, { steps: 8 })
  await page.mouse.up()
  const moved = (await window.boundingBox())!
  expect(moved.x).toBeCloseTo(original.x - 350, 0)
  expect(moved.y).toBeCloseTo(original.y - 140, 0)
  await page.mouse.move(moved.x + 120, moved.y + 20)
  await page.mouse.down()
  await page.mouse.move(moved.x + 120, moved.y + 20 + 100, { steps: 8 })
  await page.mouse.up()
  expect((await window.boundingBox())!.y).toBeCloseTo(moved.y + 100, 0)
  await loot.nth(1).click()
  const second = page.getByRole('dialog', { name: second_name, exact: true })
  await expect(second).toBeVisible()
  expect(await report.boundingBox()).toEqual(report_position)
  await expect(page.getByRole('dialog', { name: first_name, exact: true })).toBeVisible()
  await second.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(report).toBeVisible()
  await page
    .getByRole('dialog', { name: first_name, exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await report.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(report).toHaveCount(0)
})
