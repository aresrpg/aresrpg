// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

const open = async (page: Page, name: string) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name, exact: true }).click()
}

test('item windows deduplicate, preserve earlier inspections and never accumulate dimming', async ({ page }) => {
  await open(page, 'Equipment')
  await page.getByRole('searchbox', { name: 'Search inventory…' }).fill('Golden Lorito Hood')
  await page.locator('.chr-cell:not(.chr-cell--empty)').first().click()
  await page.locator('.jobs__ingredient').filter({ hasText: 'Sunforged Talon' }).click()
  const talon = page.getByRole('dialog', { name: 'Sunforged Talon', exact: true })
  await talon.getByRole('button', { name: /Golden Lorito Hood/ }).click()
  const hood = page.locator('.aui-floating-window[aria-label="Golden Lorito Hood"]')
  await expect(hood).toBeVisible()
  await hood.locator('.jobs__ingredient').filter({ hasText: 'Sunforged Talon' }).click()
  await expect(talon).toHaveCount(1)
  await talon.getByRole('button', { name: /Golden Lorito Hood/ }).click()
  await hood.locator('.jobs__ingredient').filter({ hasText: 'Gilded Lorito Plume' }).click()
  await expect(page.getByRole('dialog', { name: 'Gilded Lorito Plume', exact: true })).toHaveCount(1)
  for (const window of await page.locator('.aui-floating-window:popover-open').all())
    expect(await window.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: '/tmp/handoff-stacked-windows.png' })
})

test('inventory mob sources open the complete shared mob detail', async ({ page }) => {
  await open(page, 'Equipment')
  await page.getByRole('searchbox', { name: 'Search inventory…' }).fill('Golden Lorito Hood')
  await page.locator('.chr-cell:not(.chr-cell--empty)').first().click()
  await expect(page.locator('[data-item-drops]')).toContainText('~1%')
  await page.locator('[data-item-drops] button').click()
  const detail = page.locator('[data-mob-catalogue]')
  await expect(detail).toBeVisible()
  await expect(detail.locator('[data-mob-found-in]')).toHaveCount(1)
  await expect(detail.locator('[data-mob-loot-progress]').first()).toBeAttached()
  await expect(detail.locator('[data-mob-spell-tabs]')).toHaveCount(1)
  await page.screenshot({ path: '/tmp/handoff-shared-mob.png' })
})

test('inventory resource filters support mouse dragging without selecting on drag', async ({ page }) => {
  await open(page, 'Equipment')
  await page.locator('.chr-equip__bagtabs').getByRole('button', { name: 'Resources', exact: true }).click()
  const rail = page.locator('.inventory-resource-filters')
  const box = (await rail.boundingBox())!
  const selected = await rail.locator('[aria-pressed="true"]').innerText()
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 15, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20)
  await expect(rail.locator('[aria-pressed="true"]')).toHaveText(selected)
})

test('mobile encyclopedia preserves list space and vertical scrolling', async ({ page }) => {
  await open(page, 'Encyclopedia')
  const tabs = page.locator('.enc-page > .aui-segments')
  await tabs.getByRole('button', { name: 'Jobs', exact: true }).click()
  const search = page.getByRole('searchbox')
  expect((await search.boundingBox())!.width).toBeGreaterThan(150)
  await search.fill('Miner')
  await expect(page.locator('.aui-collection-tile')).toHaveCount(1)
  await tabs.getByRole('button', { name: 'Mobs', exact: true }).click()
  const list = page.locator('.enc-browser__list > div').last()
  expect((await list.boundingBox())!.height).toBeGreaterThan(190)
  await list.hover()
  await page.mouse.wheel(0, 500)
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100)
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await tabs.getByRole('button', { name: 'Worlds', exact: true }).click()
  await expect(page.locator('[data-world-mob]').first()).toBeInViewport()
  await expect(page.locator('[data-world-resource]').first()).toBeInViewport()
})

test('mobile recipe details place crafting beside the item', async ({ page }) => {
  await open(page, 'Encyclopedia')
  await page.getByRole('searchbox').fill('Quartzbound Pickaxe')
  await page.locator('.aui-collection-tile').click()
  const popup = page.getByRole('dialog').last()
  const header = (await popup.locator('.item-detail-header').boundingBox())!
  const craft = (await popup.locator('.jobs__craft').boundingBox())!
  expect(craft.x).toBeGreaterThanOrEqual(header.x + header.width)
  expect(Math.abs(craft.y - header.y)).toBeLessThan(20)
})

test('spell upgrades use the isolated character while combat previews stay compact', async ({ page }) => {
  await open(page, 'Spells')
  const points = page.locator('.sb__top .aui-value-badge strong')
  await expect(page.locator('.sb__upgrade')).toBeEnabled()
  const before = Number(await points.innerText())
  await page.locator('.sb__upgrade').click()
  await expect(points).toHaveText(String(before - 1))
  await page.keyboard.press('Escape')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Combat', exact: true }).click()
  await page.locator('.aui-combat-spells .fight-hud__spell').nth(1).hover()
  await expect(page.locator('[data-fight-spell-effects]')).toBeVisible()
  await expect(page.locator('.aui-inspection--spell')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/handoff-spell-detail.png' })
})

test('larger mobile recipes keep crafting controls visible while ingredients scroll independently', async ({
  page,
}) => {
  await open(page, 'Encyclopedia')
  await page.getByRole('searchbox').fill('Golden Lorito Hood')
  await page.locator('.aui-collection-tile').click()
  const popup = page.getByRole('dialog').last()
  const window = (await popup.locator('.aui-window').boundingBox())!
  const craft = popup.locator('.jobs__craft')
  const action = (await craft.locator('.jobs__craft-btn').boundingBox())!
  expect(action.y + action.height).toBeLessThanOrEqual(window.y + window.height)
  await expect(popup.locator('.item-detail-art')).toHaveAttribute('src', /_hd\.png$/)
  await page.screenshot({ path: '/tmp/handoff-large-recipe.png' })
})
