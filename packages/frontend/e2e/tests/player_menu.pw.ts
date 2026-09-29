// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('chat player menu stays reachable at the bottom-right edge and after resizing', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto('/e2e/fixtures/player_menu.html')
  await page.getByRole('button', { name: 'lgctaffa', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  for (const viewport of [
    { width: 640, height: 360 },
    { width: 320, height: 120 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(async () => {
      const box = (await menu.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(8)
      expect(box.y).toBeGreaterThanOrEqual(8)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8)
    }).toPass()
  }
  await menu.getByRole('menuitem', { name: 'Send a message', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('textbox')).toBeVisible()
})
