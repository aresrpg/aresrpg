// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 600, height: 700 },
  { width: 390, height: 700 },
]) {
  test(`Kolizeum toolbar stays inside a compact empty window at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html')
    await page.getByRole('button', { name: 'Kolizeum', exact: true }).click()
    const window = page.locator('.aui-arena-port')
    const create = page.getByRole('button', { name: 'Create a lobby', exact: true })
    await expect(create).toBeVisible()
    const box = (await window.boundingBox())!
    const button = (await create.boundingBox())!
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width - 6)
    expect(button.x).toBeGreaterThanOrEqual(box.x + 6)
    expect(box.height).toBeLessThan(260)
    expect(await page.locator('.kz-tabs').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const table = (await page.locator('.kz-table').boundingBox())!
    expect(table.width).toBeGreaterThan(box.width - 40)
    await page.screenshot({ path: `/tmp/arena-after-${viewport.width}.png` })
    await create.click()
    await expect(page.locator('.aui-arena-create-window')).toBeVisible()
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 600, height: 700 },
]) {
  test(`Kolizeum list and selected teams fit their own sections at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html?arena')
    await page.getByRole('button', { name: 'Kolizeum', exact: true }).click()
    await expect(page.locator('.kz-lobby')).toHaveCount(3)
    await page.locator('.kz-lobby').last().click()
    await expect(page.locator('.kz-selected')).toBeVisible()
    const window_box = (await page.locator('.aui-arena-port').boundingBox())!
    for (const selector of ['.kz-table', '.kz-selected', '.aui-arena-create-trigger']) {
      const element = page.locator(selector)
      const box = (await element.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(window_box.x + window_box.width)
      expect(box.y + box.height).toBeLessThanOrEqual(window_box.y + window_box.height)
      expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    for (const roster of await page.locator('.kz-roster').all()) {
      const fighters = (await roster.locator('.kz-fighters').boundingBox())!
      const action = (await roster.locator('.kz-join-side').boundingBox())!
      expect(fighters.y + fighters.height).toBeLessThanOrEqual(action.y)
    }
    await page.screenshot({ path: `/tmp/arena-selected-${viewport.width}.png` })
  })
}
