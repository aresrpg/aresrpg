// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('world fullscreen toggle follows browser state and keeps account controls available', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  const toggle = page.locator('[data-fullscreen-toggle]')
  await toggle.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
  await expect(toggle).toHaveAccessibleName('Exit fullscreen')
  await expect(page.locator('[data-wallet-trigger]')).toBeInViewport()
  await toggle.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(toggle).toHaveAccessibleName('Enter fullscreen')
  await toggle.click()
  await page.evaluate(() => document.exitFullscreen())
  await expect(toggle).toHaveAccessibleName('Enter fullscreen')
})

test('fullscreen rejection remains visible without changing the toggle state', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = async () => {
      throw new Error('Permission denied')
    }
  })
  const toggle = page.locator('[data-fullscreen-toggle]')
  await toggle.click()
  await expect(page.getByText('Could not change fullscreen mode.', { exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
})

test('unsupported fullscreen leaves no unusable fullscreen button', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }))
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await expect(page.locator('[data-wallet-trigger]')).toBeVisible()
  await expect(page.locator('[data-fullscreen-toggle]')).toHaveCount(0)
})
