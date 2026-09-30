// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('jobs use a resource grid and independently retained movable recipe windows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await page.locator('.jobs__list-row').filter({ hasText: 'Herbalist' }).click()
  await expect(page.locator('.jobs__gather-rows')).toBeVisible()
  const columns = await page
    .locator('.jobs__gather-rows')
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(columns).toBeGreaterThanOrEqual(2)
  await page.locator('.jobs__recipe').filter({ hasText: 'Wither Concentrate' }).click()
  const parent = page.getByRole('dialog', { name: 'Wither Concentrate', exact: true })
  await expect(parent).toBeVisible()
  expect(await page.locator('.jobs__item-detail').count()).toBe(0)
  const window = parent.locator('.aui-inspection--item')
  const header = parent.locator('.aui-window-header')
  const h = (await header.boundingBox())!
  await page.mouse.move(h.x + 100, h.y + 15)
  await page.mouse.down()
  await page.mouse.move(h.x + 160, h.y - 30, { steps: 6 })
  await page.mouse.up()
  const moved = (await window.boundingBox())!
  await parent.locator('.jobs__ingredient').first().click()
  await expect(page.locator('.aui-floating-window:popover-open')).toHaveCount(2)
  await header.click({ position: { x: 100, y: 15 } })
  expect(Math.abs((await window.boundingBox())!.x - moved.x)).toBeLessThan(1)
  expect(Math.abs((await window.boundingBox())!.y - moved.y)).toBeLessThan(1)
  await parent.locator('.aui-window-header').getByRole('button').click()
  await expect(page.locator('.aui-floating-window:popover-open')).toHaveCount(1)
  await page.mouse.click(5, 5)
  await expect(page.locator('.aui-floating-window:popover-open')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Jobs', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/jobs-independent-windows.png' })
})

test('pet encyclopedia windows retain readable intrinsic width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="encyclopedia"]').click()
  await page.getByRole('searchbox').fill('Mosho')
  await page.locator('.aui-collection-tile').filter({ hasText: 'Mosho' }).click()
  const popup = page.getByRole('dialog', { name: 'Mosho', exact: true })
  await expect(popup).toBeVisible()
  const card = (await popup.locator('.aui-inspection--item').boundingBox())!
  expect(card.width).toBeGreaterThanOrEqual(450)
  const name = (await popup.locator('[data-item-detail-name]').boundingBox())!
  expect(name.height).toBeLessThan(35)
  await page.screenshot({ path: '/tmp/pet-inspector-readable.png' })
})

test('encyclopedia tiles contain metadata and its staking section scrolls independently', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="encyclopedia"]').click()
  await page.getByRole('searchbox').fill('Cloak')
  const tiles = page.locator('.aui-collection-tile')
  await expect(tiles.first()).toBeVisible()
  for (const tile of await tiles.all()) {
    const card = (await tile.boundingBox())!,
      meta = (await tile.locator('.aui-collection-copy small').boundingBox())!
    expect(meta.y + meta.height).toBeLessThanOrEqual(card.y + card.height)
  }
  const tabs = page.locator('.enc-page > .aui-segments')
  const { y } = (await tabs.boundingBox())!
  await tabs.getByRole('button', { name: 'Staking', exact: true }).click()
  const content = page.locator('[data-encyclopedia-tab="kares"]')
  await content.hover()
  await page.mouse.wheel(0, 800)
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(100)
  expect((await tabs.boundingBox())!.y).toBe(y)
  await tabs.getByRole('button', { name: 'Gameplay', exact: true }).click()
  const row = page.locator('.aui-navigation-row:visible').first()
  await expect(row).toBeVisible()
  expect(await row.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none')
  expect(await row.evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe('0px')
  await page.screenshot({ path: '/tmp/encyclopedia-flat-navigation.png' })
})
