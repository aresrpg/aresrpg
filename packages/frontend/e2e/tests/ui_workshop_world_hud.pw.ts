// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 844, height: 390 }]) {
  test(`Settings uses the shared layout and live native toggles at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.locator('.aui-settings')
    await expect(settings).toBeVisible()
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await settings.getByRole('button', { name: 'Volume', exact: true }).click()
    const music = settings.getByRole('switch', { name: 'Music', exact: true })
    await expect(music).toBeChecked()
    await music.uncheck()
    await expect(music).not.toBeChecked()
    await settings.getByRole('button', { name: 'Quality', exact: true }).click()
    await settings.getByRole('button', { name: 'Volume', exact: true }).click()
    await expect(music).not.toBeChecked()
    await settings.getByRole('button', { name: 'Account', exact: true }).click()
    await expect(settings.locator('[data-suins-settings]')).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Use this name', exact: true })).toBeVisible()
  })
}
