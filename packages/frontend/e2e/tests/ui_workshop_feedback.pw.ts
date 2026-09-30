// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('tutorial tips are compact, non-blocking, and follow character modals', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?tutorial')
  const tip = page.locator('.tutorial-tip')
  await expect(tip).toContainText('1 / 3')
  expect((await tip.boundingBox())!.width).toBeLessThanOrEqual(320)
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  await tip.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(tip).toContainText('Your HUD')
  await tip.getByRole('button', { name: 'Skip tutorial' }).click()
  await expect(tip).toHaveCount(0)
  await page.getByRole('button', { name: 'Equipment', exact: true }).click()
  await expect(tip).toContainText('choose Equip')
  await expect.poll(() => tip.evaluate((node) => !!node.closest('dialog'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await expect(page.locator('[data-character-panel="equipment"]')).toBeVisible()
})
