// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('camera hides the cursor only during held drags and restores it for HUD interaction', async ({ page }) => {
  await page.goto('/e2e/fixtures/camera_drag.html')
  await page.locator('canvas').click({ position: { x: 120, y: 120 } })
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull()
  await page.mouse.move(350, 160)
  await expect(page.locator('body')).toHaveAttribute('data-rotations', '0')
  await page.mouse.down()
  await page.mouse.move(430, 200, { steps: 8 })
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName)).toBe('CANVAS')
  await page.mouse.up()
  expect(Number(await page.locator('body').getAttribute('data-rotations'))).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull()
  const rotations = await page.locator('body').getAttribute('data-rotations')
  await page.getByRole('button', { name: 'Inventory' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-clicked', 'true')
  await expect(page.locator('body')).toHaveAttribute('data-rotations', rotations!)
})
