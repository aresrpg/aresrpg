// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

const open_delete = async (page: Page, id: string) => {
  await page.locator(`[data-character-tab="${id}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete character', exact: true }).click()
}

test('equipment blocks confirmation and cancel never submits', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_delete.html')
  await page.getByRole('button', { name: 'Equip cosmetic' }).click()
  await open_delete(page, '0xchar')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('The 1 SUI creation fee will not be refunded.')
  await expect(dialog).toContainText('Unequip every item, including pets, tools and cosmetics.')
  await expect(dialog.getByRole('button', { name: 'Delete character', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-calls]')).toHaveText('[]')
})

test('deletes the right-clicked tab once and ignores a stale roster', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_delete.html')
  await open_delete(page, 'second')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Ash')
  await expect(dialog).toContainText('Deletion is permanent.')
  await expect(dialog.locator(':scope > div')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/character-delete-confirm.png' })
  await dialog.getByRole('button', { name: 'Delete character', exact: true }).dblclick()
  await expect(page.locator('[data-character-tab="second"]')).toHaveCount(0)
  await expect(page.locator('[data-calls]')).toHaveText('["second"]')
  await page.getByRole('button', { name: 'Stale roster' }).click()
  await expect(page.locator('[data-character-tab="second"]')).toHaveCount(0)
  await expect(page.locator('[data-character-tab="0xchar"]')).toHaveAttribute('aria-pressed', 'true')
})

test('chain refusal keeps the character and shows the failure without retrying', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_delete.html?fail')
  await open_delete(page, '0xchar')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Delete character', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Deletion refused by chain')
  await expect(page.locator('[data-character-tab="0xchar"]')).toHaveCount(1)
  await expect(page.locator('[data-calls]')).toHaveText('["0xchar"]')
})
