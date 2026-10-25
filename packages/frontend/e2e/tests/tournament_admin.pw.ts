// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const [width, height] of [
  [1440, 900],
  [667, 375],
]) {
  test(`admin tournament dialog opens from the wallet header at ${width}px and retains its draft`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    await page.goto('/e2e/fixtures/tournament.html?admin')
    const controls = page.locator('.aui-admin-controls')
    const trigger = controls.getByRole('button', { name: 'Create tournament', exact: true })
    await expect(controls.locator('[data-wallet-menu]')).toHaveCount(1)
    const wallet = await controls.locator('[data-wallet-menu]').boundingBox()
    const button = await trigger.boundingBox()
    expect(button!.x).toBeGreaterThanOrEqual(wallet!.x + wallet!.width)
    const before = await page.locator('.aui-live-page-content').boundingBox()
    await trigger.click()
    const editor = page.getByRole('dialog', { name: 'Create tournament', exact: true })
    await expect(editor).toBeVisible()
    expect(await page.locator('.aui-live-page-content').boundingBox()).toEqual(before)
    await expect(page.locator('[data-wallet-menu]')).toHaveCount(1)
    await editor.getByLabel('Name', { exact: true }).fill('Retained draft')
    await page.screenshot({ path: info.outputPath(`tournament-dialog-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Retained draft')
  })
}
