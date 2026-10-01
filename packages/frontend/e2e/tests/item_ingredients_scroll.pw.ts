// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 667, height: 375 } })

test('the last inventory recipe ingredient remains reachable after scrolling', async ({ page }) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).tap()
  const inventory = page.locator('[data-character-panel="equipment"]')
  await inventory.getByRole('searchbox', { name: 'Search inventory…' }).fill('Golden Lorito Hood')
  await inventory.locator('.chr-cell:not(.chr-cell--empty)').first().tap()
  const card = inventory.locator('.chr-equip__detail')
  const last = card.locator('.jobs__ingredient').last()
  await expect(last).toBeAttached()
  const body = card.locator('[data-owned-item-id]')
  const bounds = (await body.boundingBox())!
  const ingredients = (await card.locator('.jobs__ingredients').boundingBox())!
  const x = ingredients.x + ingredients.width / 2
  const y = Math.min(bounds.y + bounds.height - 20, ingredients.y + 40)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] })
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x, y: y - step * 25 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(async () => {
      const visible = (await body.boundingBox())!,
        target = (await last.boundingBox())!
      return target.y >= visible.y && target.y + target.height <= visible.y + visible.height
    })
    .toBe(true)
  await page.screenshot({ path: test.info().outputPath('ingredients.png') })
  await last.tap({ timeout: 3000 })
  await expect(page.locator('.aui-floating-window')).toBeVisible()
})
