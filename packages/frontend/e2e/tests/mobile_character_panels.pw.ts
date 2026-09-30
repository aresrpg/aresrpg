// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 932, height: 430 } })

test('mobile inventory inspection fits its contents within the window', async ({ page }) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).tap()
  const inventory = page.locator('[data-character-panel="equipment"]')
  await inventory.getByRole('searchbox', { name: 'Search inventory…' }).fill('Zukin')
  await inventory.locator('.chr-cell:not(.chr-cell--empty)').first().tap()
  const card = inventory.locator('.chr-equip__detail')
  await expect(card).toBeVisible()
  const bounds = (await card.boundingBox())!
  const window = (await inventory.locator('.game-character-body').boundingBox())!
  expect(bounds.width).toBeLessThan(window.width * 0.85)
  expect(bounds.x).toBeGreaterThanOrEqual(window.x)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(window.x + window.width)
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(card.getByRole('button', { name: 'Equip', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('item-card.png') })
})

for (const viewport of [
  { width: 667, height: 375 },
  { width: 932, height: 430 },
]) {
  test(`stats scroll while the confirmation footer stays visible at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/demo#ui')
    await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Stats', exact: true }).tap()
    const sheet = page.locator('.aui-character-sheet')
    const footer = sheet.locator('.aui-character-points')
    await expect(footer).toBeVisible()
    const before = (await footer.boundingBox())!
    expect(before.y + before.height).toBeLessThanOrEqual(viewport.height)
    const list = sheet.locator('.aui-attribute-list')
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    expect((await footer.boundingBox())!.y).toBeCloseTo(before.y, 1)
    await expect(footer.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport()
    expect(await sheet.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('stats-panel.png') })
  })
}
