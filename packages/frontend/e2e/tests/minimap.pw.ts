// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const marker_pixel = ({ center, x, large = false }: { center: number; x: number; large?: boolean }) => {
  const canvas = document.querySelector<HTMLCanvasElement>(large ? '.gw-worldmap__lens' : '.gw-minimap__lens')!
  const size = large ? 768 : 288
  const diameter = large ? 1536 : 448
  const px = Math.round(size / 2 + ((x - center) * size) / diameter)
  const py = Math.round(size / 2 + ((40 - (large ? -80 : 0)) * size) / diameter)
  return [...canvas.getContext('2d')!.getImageData(px, py, 1, 1).data].slice(0, 3)
}

test('resource icons repaint while stationary and follow the current zone and consumption', async ({ page }, info) => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  await page.route('**/wheat-*.png', async (route) => {
    requests++
    await ready
    await route.continue()
  })
  await page.goto('/e2e/fixtures/minimap.html', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-minimap]')).toBeVisible()
  const gold = [200, 150, 60]
  await expect.poll(() => page.evaluate(marker_pixel, { center: 160, x: 120 })).toEqual(gold)
  release()
  await expect.poll(() => page.evaluate(marker_pixel, { center: 160, x: 120 })).not.toEqual(gold)
  expect(await page.evaluate(marker_pixel, { center: 160, x: 220 })).toEqual(gold)
  await info.attach('minimap-icons', {
    body: await page.locator('[data-minimap]').screenshot(),
    contentType: 'image/png',
  })
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').move(200))
  await expect.poll(() => page.evaluate(marker_pixel, { center: 200, x: 220 })).not.toEqual(gold)
  expect(await page.evaluate(marker_pixel, { center: 200, x: 120 })).toEqual(gold)
  await page.locator('.gw-minimap__open').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // The expanded map remains centered on the zone where it opened, even as the player moves.
  await expect.poll(() => page.evaluate(marker_pixel, { center: 432, x: 220, large: true })).not.toEqual(gold)
  await expect.poll(() => page.evaluate(marker_pixel, { center: 432, x: 120, large: true })).toEqual(gold)
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').move(160))
  await expect.poll(() => page.evaluate(marker_pixel, { center: 432, x: 120, large: true })).not.toEqual(gold)
  await expect.poll(() => page.evaluate(marker_pixel, { center: 432, x: 220, large: true })).toEqual(gold)
  await info.attach('world-map-icons', { body: await page.getByRole('dialog').screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').move(200))
  await expect.poll(() => page.evaluate(marker_pixel, { center: 200, x: 220 })).not.toEqual(gold)
  expect(requests).toBe(1)
  const before = await page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').consume())
  await expect
    .poll(() => page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()))
    .not.toBe(before)
  const consumed = await page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').travel())
  await expect
    .poll(() => page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()))
    .not.toBe(consumed)
  const terrain = () =>
    page
      .locator('canvas')
      .evaluate((canvas) => [...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 32, 32).data])
  const after_travel = await terrain()
  await page.evaluate(() => Reflect.get(window, 'minimap_fixture').remount())
  // Fractional terrain cells can differ by a rounding shade after repainting an existing canvas.
  await expect
    .poll(async () => {
      const fresh = await terrain()
      return fresh.reduce((sum, channel, index) => sum + Math.abs(channel - after_travel[index]!), 0) / fresh.length
    })
    .toBeLessThan(1)
})
