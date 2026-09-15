// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const [locale, settings] of [
  ['zh', '设置'],
  ['ru', 'Настройки'],
  ['vi', 'Cài đặt'],
  ['ko', '설정'],
]) {
  test(`${locale} loads its translated settings and shared world chat`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    )
    await page.goto(`/e2e/fixtures/responsive_preview.html?page=settings&locale=${locale}`)
    await expect(page.locator('[data-app-sidebar]')).toContainText(settings!)
    await expect(page.locator('html')).toHaveAttribute('lang', locale!)
    await page.goto(`/e2e/fixtures/responsive_preview.html?page=world&locale=${locale}`)
    await expect(page.locator('.chat__resize')).toBeVisible()
    await expect(page.locator('.chat__resize')).not.toHaveAttribute('aria-label', 'Resize chat')
    expect(errors).toEqual([])
  })
}
