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
