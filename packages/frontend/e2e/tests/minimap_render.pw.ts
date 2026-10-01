// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('minimap reuses terrain during rotation and nearby movement, then refreshes after travel', async ({ page }) => {
  await page.addInitScript(() => {
    let fills = 0
    Object.defineProperty(window, 'minimap_fill_count', { get: () => fills })
    CanvasRenderingContext2D.prototype.fillRect = new Proxy(CanvasRenderingContext2D.prototype.fillRect, {
      apply: (target, receiver, args) => {
        fills += 1
        return Reflect.apply(target, receiver, args)
      },
    })
  })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await expect(page.locator('.gw-minimap canvas')).toBeVisible()
  const count = () => page.evaluate(() => Number(Reflect.get(window, 'minimap_fill_count')))
  const settled = () =>
    expect
      .poll(() =>
        page.evaluate(async () => {
          const before = Reflect.get(window, 'minimap_fill_count')
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
          return before === Reflect.get(window, 'minimap_fill_count')
        })
      )
      .toBe(true)
  await expect.poll(count).toBeGreaterThanOrEqual(25_600)
  await settled()
  const initial = await count()
  await page.locator('[data-test-rotate]').evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(count).toBeGreaterThan(initial)
  expect((await count()) - initial).toBeLessThan(1_000)
  // The live pose feed admits updates at 50 ms intervals.
  await page.waitForTimeout(60)
  const rotated = await count()
  await page.locator('[data-test-move]').evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(count).toBeGreaterThan(rotated)
  expect((await count()) - rotated).toBeLessThan(1_000)
  await page.waitForTimeout(60)
  const moved = await count()
  await page.locator('[data-test-travel]').evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(count).toBeGreaterThanOrEqual(moved + 25_600)
  await settled()
  await page.locator('.gw-minimap').screenshot({ path: test.info().outputPath('minimap-after-travel.png') })
  const before_map = await count()
  await page.locator('.gw-minimap .aui-minimap-controls button').click()
  await expect(page.locator('.aui-map-viewport canvas')).toBeVisible()
  await expect.poll(count).toBeGreaterThanOrEqual(before_map + 25_600)
  await settled()
  await page.locator('.aui-map-viewport').screenshot({ path: test.info().outputPath('world-map.png') })
})
