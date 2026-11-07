// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('Shift-click only selects; double-click submits immediately and rejection restores the item', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?pending-equip')
  const pet = page.locator('[data-equipment-slot="pet"]')
  const item = page.locator('.chr-equip__bag').getByRole('button', { name: 'Siluri', exact: true })
  await item.click({ modifiers: ['Shift'] })
  await expect(item).toHaveAttribute('aria-pressed', 'true')
  await expect(pet).not.toHaveClass(/is-filled/)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.equip_requests)).toEqual([])
  await item.dblclick()
  await expect(pet).toHaveAttribute('aria-busy', 'true')
  await expect(pet.locator('.inventory-item-pending')).toBeVisible()
  await expect(item).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.equip_requests.length)).toBe(1)
  await pet.dispatchEvent('dblclick')
  await expect.poll(() => page.evaluate(() => window.equip_requests.length)).toBe(1)
  await page.evaluate(() => window.reject_equip())
  await expect(pet).not.toHaveClass(/is-filled/)
  await expect(item).toBeEnabled()
  await expect(page.getByText('Equipment rejected', { exact: true })).toBeVisible()
  await item.dblclick()
  await expect.poll(() => page.evaluate(() => window.equip_requests.length)).toBe(2)
  await page.evaluate(() => window.resolve_equip())
  await expect(pet).toHaveClass(/is-filled/)
  await expect(pet.locator('.inventory-item-pending')).toBeHidden()
})

test('Shift-click on consumables selects without inspecting or consuming', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.locator('.chr-bagtab').nth(1).click()
  const item = page.getByRole('button', { name: 'Recall Potion', exact: true })
  await item.click({ modifiers: ['Shift'] })
  await expect(item).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.consume_requests)).toEqual([])
})

test('dropping onto equipment starts exactly one pending transaction', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?pending-equip')
  const item = page.locator('.chr-equip__bag').getByRole('button', { name: 'Siluri', exact: true })
  const slot = page.locator('[data-equipment-slot="pet"]')
  const start = (await item.boundingBox())!,
    end = (await slot.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(slot).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => page.evaluate(() => window.equip_requests.length)).toBe(1)
  await page.evaluate(() => window.resolve_equip())
  await expect(slot).toHaveClass(/is-filled/)
  await expect(slot).toBeEnabled()
})
