// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('equipped items inspect on single click and only stage removal on double click', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?equipped')
  const pet = page.locator('[data-equipment-slot="pet"]')
  await expect(pet.locator('img')).toHaveAttribute('src', '/item/siluri_hd.png')
  await expect
    .poll(() => pet.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThanOrEqual(256)
  await pet.click()
  await expect(page.locator('[data-item-detail-name]')).toHaveText('Siluri')
  await expect(pet).toHaveClass(/is-filled/)
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
  await page.locator('[data-equipment-slot="hat"]').dblclick()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
  await pet.dblclick()
  await expect(pet).not.toHaveClass(/is-filled/)
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await expect(page.locator('.chr-equip__bag').getByRole('button', { name: 'Siluri', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(pet).toHaveClass(/is-filled/)
})

for (const [name, item_type] of [['Recall Potion', 'recall_potion']] as const) {
  test(`${name} cannot be used during a dungeon run`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.getByRole('button', { name: 'Enter dungeon', exact: true }).click()
    await page.locator('.chr-bagtab').nth(1).click()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name, exact: true }).dblclick()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
    await page.getByRole('button', { name: 'Leave dungeon', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).dblclick()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([item_type])
  })
}

for (const name of ['Recall Potion']) {
  test(`${name} rechecks dungeon entry before submission`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.locator('.chr-bagtab').nth(1).click()
    await page.getByRole('button', { name: 'Dungeon on next use', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).dblclick()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
  })
}

for (const [name, item_type] of [['Croissant', 'croissant']] as const) {
  test(`${name} can be consumed between dungeon rooms`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.getByRole('button', { name: 'Enter dungeon', exact: true }).click()
    await page.locator('.chr-bagtab').nth(1).click()
    await page.getByRole('button', { name, exact: true }).dblclick()
    if (item_type === 'croissant') await page.getByRole('button', { name: 'Consume 1', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([item_type])
  })
}
