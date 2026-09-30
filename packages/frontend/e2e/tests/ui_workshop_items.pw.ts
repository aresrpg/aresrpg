// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const width of [1440, 844]) {
  test(`item comparison, acquisition, and popup dragging at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 1000 })
    await page.goto('/demo#ui')
    await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search inventory…' })
    await search.fill('Zukin')
    await page.locator('.chr-cell:not(.chr-cell--empty)').first().click()
    await expect(page.locator('[data-equipment-comparison]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Equip', exact: true }).click()
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await search.fill('Golden Lorito Hood')
    await page.locator('.chr-cell:not(.chr-cell--empty)').first().click()
    await expect(page.locator('[data-equipment-comparison]')).toContainText('Replacing Zukin Muru')
    await expect(page.locator('[data-equipment-delta="vitality"]')).toHaveText('−300')
    await expect(page.locator('[data-equipment-delta="strength"]')).toHaveText('−100')
    await expect(page.locator('[data-equipment-delta="critical"]')).toHaveText('+2')
    await expect(page.locator('[data-item-drops]')).toContainText('Golden Lorito')
    await page.locator('.jobs__ingredient').filter({ hasText: 'Sunforged Talon' }).click()
    const popup = page.getByRole('dialog').last()
    await expect(popup.locator('[data-item-recipes]')).toContainText('Golden Lorito Hood')
    const window = popup.locator('.aui-window')
    const before = (await window.boundingBox())!
    const header = (await popup.locator('.aui-window-header').boundingBox())!
    if (width === 844) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, x: header.x + header.width / 2, y: header.y + 20 }],
      })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, x: header.x + header.width / 2 + 70, y: header.y + 80 }],
      })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(header.x + header.width / 2, header.y + 20)
      await page.mouse.down()
      await page.mouse.move(header.x + header.width / 2 + 70, header.y + 80, { steps: 6 })
      await page.mouse.up()
    }
    const after = (await window.boundingBox())!
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.x + after.width).toBeLessThanOrEqual(width + 1)
    expect(after.y + after.height).toBeLessThanOrEqual((width === 844 ? 390 : 1000) + 1)
    await popup.locator('.jobs__ingredient').filter({ hasText: 'Amber' }).filter({ hasNotText: 'Powder' }).click()
    await expect(page.getByRole('dialog').last().locator('[data-item-worlds]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup.locator('[data-item-recipes]')).toBeVisible()
  })
}
