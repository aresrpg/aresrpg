// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })

test('portrait blocks touch controls without replacing the player canvas', async ({ page }) => {
  await page.goto('/e2e/fixtures/mobile.html')
  await expect(page.locator('.mobile-joystick')).toBeVisible()
  const canvas = await page.locator('[data-world-frame] > canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.mobile-rotate')).toBeVisible()
  expect(
    await page.locator('.mobile-joystick').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return Boolean(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.mobile-rotate')
      )
    })
  ).toBe(true)
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
})
