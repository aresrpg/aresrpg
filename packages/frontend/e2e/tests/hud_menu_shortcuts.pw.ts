// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`menu shortcut hints belong to launchers, and J toggles Jobs at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html')
    const shortcuts = page.locator('.aui-hud-shortcut-row')
    const jobs = shortcuts.getByRole('button', { name: 'Jobs', exact: true })
    await expect(jobs.locator('kbd')).toHaveText('J')
    await expect(jobs).toHaveAttribute('aria-keyshortcuts', 'J')
    await expect(shortcuts.getByRole('button', { name: 'Equipment', exact: true }).locator('kbd')).toHaveText('E')
    await expect(shortcuts.getByRole('button', { name: 'World map', exact: true }).locator('kbd')).toHaveText('M')

    await shortcuts.getByRole('button', { name: 'Spells', exact: true }).click()
    const spells = page.locator('[data-character-panel="spells"]')
    await expect(spells).toBeVisible()
    await expect(spells.locator('.aui-window-header kbd')).toHaveCount(0)
    await page.keyboard.press('j')
    await expect(page.locator('[data-character-panel="jobs"]')).toHaveCount(0)
    await expect(spells).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(spells).toHaveCount(0)

    await page.keyboard.press('j')
    const panel = page.locator('[data-character-panel="jobs"]')
    await expect(panel.locator('.jobs')).toBeVisible()
    await expect(panel.locator('.aui-window-header kbd')).toHaveCount(0)
    await page.keyboard.press('j')
    await expect(panel).toHaveCount(0)

    await page.keyboard.press('e')
    const inventory = page.locator('[data-character-panel="equipment"]')
    await expect(inventory).toBeVisible()
    await expect(inventory.locator('.aui-window-header kbd')).toHaveCount(0)
    await page.keyboard.press('e')
    await expect(inventory).toHaveCount(0)
    await shortcuts.screenshot({ path: test.info().outputPath('slate-menu.png') })
  })
}
