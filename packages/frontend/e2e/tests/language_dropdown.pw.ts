// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const height of [360, 900]) {
  test(`language dropdown overlays the sidebar without expanding it at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height })
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    )
    await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
    const card = page.locator('[data-language-card]')
    const trigger = card.locator('.language-trigger')
    const dropdown = page.locator('.language-dropdown')
    await trigger.scrollIntoViewIfNeeded()
    const before = (await card.boundingBox())!
    await trigger.click()
    await expect(dropdown).toBeVisible()
    expect((await card.boundingBox())!.height).toBe(before.height)
    const box = (await dropdown.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    await expect(dropdown.getByRole('button')).toHaveCount(10)
    await page.keyboard.press('Escape')
    await expect(dropdown).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dropdown.getByRole('button', { name: '한국어' }).click()
    await expect(dropdown).not.toBeVisible()
    await expect(trigger).toContainText('한국어')
    await trigger.click()
    await page.mouse.click(900, 20)
    await expect(dropdown).not.toBeVisible()
  })
}
