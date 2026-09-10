// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('selecting inventory consumables shows their authored effect and changes it with the selection', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.getByRole('button', { name: /Consumables/ }).click()
  await page.getByTitle('Scroll of Oblivion', { exact: true }).click()
  await expect(page.locator('[data-consumable-effect]')).toContainText('Reset spell points')
  await page.getByTitle('Scroll of Rebirth', { exact: true }).click()
  await expect(page.locator('[data-consumable-effect]')).toContainText('Reset stat points')
  await page.getByTitle('Croissant', { exact: true }).click()
  await expect(page.locator('[data-consumable-effect]')).toContainText('10')
  await expect(page.locator('[data-consumable-effect]')).not.toContainText('Reset')
  await page.locator('[data-consumable-effect]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/inventory-consumable-details.png' })
})

test('inventory consumable effects use the current locale in all six languages', async ({ page }) => {
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    await page.goto(`/e2e/fixtures/inventory.html?locale=${locale}`)
    await page.locator('.chr-bagtab').nth(1).click()
    await page.getByTitle('Scroll of Oblivion', { exact: true }).click()
    const effect = page.locator('[data-consumable-effect]')
    await expect(effect).toBeVisible()
    await expect(effect).not.toContainText('consumable_reset_spells')
  }
})

test('owned pets show their current scaled bonuses and feeding power', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.getByTitle('Siluri', { exact: true }).click()
  await expect(page.locator('[data-item-stats]')).toContainText('+40')
  await expect(page.locator('[data-item-stats]')).not.toContainText('+80')
  await expect(page.getByRole('progressbar', { name: 'Power' })).toHaveAttribute('aria-valuenow', '30')
  await expect(page.getByRole('progressbar', { name: 'Power' })).toHaveAttribute('aria-valuemax', '60')
})

test('cosmetic slots have the same footprint as the regular equipment slots', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html')
  const rig = await page.locator('[data-equipment-slot="hat"]').boundingBox()
  const cosmetic = await page.locator('[data-equipment-slot="cosmetic_hat"]').boundingBox()
  expect(cosmetic!.width).toBeLessThanOrEqual(rig!.width + 2)
  expect(cosmetic!.width).toBeGreaterThanOrEqual(rig!.width * 0.8)
})

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
  await expect(page.locator('.chr-equip__bag').getByTitle('Siluri', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(pet).toHaveClass(/is-filled/)
})

for (const [name, item_type] of [
  ['Recall Potion', 'recall_potion'],
  ['Potion of Thebes', 'potion_of_thebes'],
] as const) {
  test(`${name} cannot be used during a dungeon run`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.getByRole('button', { name: 'Enter dungeon', exact: true }).click()
    await page.locator('.chr-bagtab').nth(1).click()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toHaveCount(0)
    await page.getByTitle(name, { exact: true }).dblclick()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
    await page.getByRole('button', { name: 'Leave dungeon', exact: true }).click()
    await page.getByTitle(name, { exact: true }).dblclick()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([item_type])
  })
}

for (const name of ['Recall Potion', 'Potion of Thebes']) {
  test(`${name} rechecks dungeon entry before submission`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.locator('.chr-bagtab').nth(1).click()
    await page.getByRole('button', { name: 'Dungeon on next use', exact: true }).click()
    await page.getByTitle(name, { exact: true }).dblclick()
    await expect(page.getByText('Finish or abandon the dungeon before teleporting.', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
  })
}

for (const [name, item_type] of [
  ['Croissant', 'croissant'],
  ['Scroll of Oblivion', 'scroll_of_oblivion'],
  ['Scroll of Rebirth', 'scroll_of_rebirth'],
] as const) {
  test(`${name} can be consumed between dungeon rooms`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html')
    await page.getByRole('button', { name: 'Enter dungeon', exact: true }).click()
    await page.locator('.chr-bagtab').nth(1).click()
    await page.getByTitle(name, { exact: true }).dblclick()
    if (item_type === 'croissant') await page.getByRole('button', { name: 'Consume 1', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([item_type])
  })
}
