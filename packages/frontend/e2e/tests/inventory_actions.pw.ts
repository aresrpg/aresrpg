// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('Explicit selection crushes the exact reviewed set with one SDK call', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory_actions.html')
  const cells = page.locator('.chr-equip__grid button')
  await cells.nth(0).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await cells.nth(1).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(page.locator('.chr-equip__grid button[aria-pressed=true]')).toHaveCount(2)
  await cells.nth(1).click({ button: 'right' })
  await page.getByRole('menu').getByRole('button', { name: 'Crush (2)', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-crush-item]')).toHaveCount(2)
  await expect(dialog).toContainText('Test Hat 1')
  await expect(dialog).toContainText('Test Hat 2')
  await dialog.getByRole('button', { name: 'Crush (2)', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-crush-calls', JSON.stringify([['gear-1', 'gear-2']]))
  await expect(page.locator('.chr-equip__grid button')).toHaveCount(1)
  await expect(page.locator('[data-crush-progress]')).toContainText('Crushing 2')
})

test('a changed selection disables confirmation without crushing a subset', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory_actions.html')
  const cells = page.locator('.chr-equip__grid button')
  await cells.nth(0).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await cells.nth(1).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await cells.nth(0).click({ button: 'right' })
  await page.getByRole('menu').getByRole('button', { name: 'Crush (2)', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-item-departs')))
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Crush (2)', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('body')).not.toHaveAttribute('data-crush-calls')
})

test('right-clicking an unselected item replaces the batch', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory_actions.html')
  const cells = page.locator('.chr-equip__grid button')
  await cells.nth(0).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await cells.nth(1).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await cells.nth(2).click({ button: 'right' })
  await page.getByRole('menu').getByRole('button', { name: 'Crush (1)', exact: true }).click()
  await expect(page.getByRole('dialog').locator('[data-crush-item]')).toHaveCount(1)
  await expect(page.getByRole('dialog')).toContainText('Test Hat 3')
})
