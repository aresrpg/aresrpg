// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('item drop card follows unsaved mob drafts and selected items without edit controls', async ({ page }) => {
  await page.goto('/e2e/fixtures/item_drop_sources.html')
  const card = page.locator('[data-item-drop-sources]')
  await expect(card.getByRole('row')).toHaveCount(3)
  await expect(card.getByRole('row').filter({ hasText: 'Nook' })).toContainText('12.34%')
  await expect(card.getByRole('row').filter({ hasText: 'Nook' })).toContainText('1–3')
  await expect(card.getByRole('row').filter({ hasText: 'Tinker' })).toContainText('100.00%')
  await expect(card.locator('input, select, button')).toHaveCount(0)
  await page.getByRole('button', { name: 'Change draft rate', exact: true }).click()
  await expect(card.getByRole('row').filter({ hasText: 'Nook' })).toContainText('75.00%')
  await page.screenshot({ path: 'test-results/item-drop-sources.png' })
  await page.getByRole('button', { name: 'Wheat', exact: true }).click()
  await expect(card).toHaveText('No mob drops this item.')
  await page.getByRole('button', { name: 'Water', exact: true }).click()
  await expect(card).toContainText('75.00%')
})

test('item drop card provides localized labels in all six locales', async ({ page }) => {
  for (const [locale, title] of [
    ['en', 'Mob drops'],
    ['fr', 'Butin des monstres'],
    ['de', 'Monsterbeute'],
    ['es', 'Botín de monstruos'],
    ['ja', 'モンスターのドロップ'],
    ['uk', 'Здобич монстрів'],
  ]) {
    await page.goto(`/e2e/fixtures/item_drop_sources.html?locale=${locale}`)
    await expect(page.getByText(title!, { exact: true })).toBeVisible()
    await expect(page.locator('[data-item-drop-sources]')).toContainText('12.34%')
  }
})
