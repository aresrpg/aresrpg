// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'
import type {} from '../fixtures/water.ts'

test.use({ viewport: { width: 480, height: 320 } })

const pixels = async (page: Page) => {
  const frame = await page.screenshot()
  return page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = 480
      canvas.height = 320
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return [...context.getImageData(160, 130, 160, 80).data]
    },
    [...frame]
  )
}
const luminance = (rgba: readonly number[]) =>
  rgba.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0) / (rgba.length * 0.75)
const ready = (page: Page) => page.waitForFunction(() => window.water_probe?.ready)

test('water darkens at night and stays finite across the waterline at large coordinates', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/water.html')
  await ready(page)
  const day = luminance(await pixels(page))
  await page.evaluate(async () => {
    window.water_probe.phase(0.9)
    await window.water_probe.advance(500)
  })
  expect(day).toBeGreaterThan(30)
  expect(luminance(await pixels(page)) / day).toBeLessThan(0.7)
  await page.evaluate(() => window.water_probe.phase(0.32))
  // The former zero-length bed normal poisoned bloom at x/z=16384 near the waterline.
  for (const height of [60.001, 60, 59.999]) {
    for (const aim of [-20, -0.01, 1]) {
      await page.evaluate(({ height, aim }) => window.water_probe.camera(16384, height, aim), { height, aim })
      await ready(page)
      const rgba = await pixels(page)
      let black = 0
      for (let index = 0; index < rgba.length; index += 4)
        if (Math.max(rgba[index]!, rgba[index + 1]!, rgba[index + 2]!) < 3) black++
      expect(black / (rgba.length / 4)).toBeLessThan(0.02)
    }
  }
  await page.evaluate(() => window.water_probe.dispose())
  expect(errors).toEqual([])
})

test('sea-level ground never acquires an animated water sheet when quality changes', async ({ page }) => {
  await page.goto('/e2e/fixtures/water.html?shore')
  for (const quality of ['high', 'low', 'medium'] as const) {
    await page.evaluate((quality) => window.water_probe.quality(quality), quality)
    await ready(page)
    const before = await pixels(page)
    // Advance the real wave clock; this is a motion assertion, not a readiness delay.
    await page.evaluate(() => window.water_probe.advance(1200))
    const after = await pixels(page)
    const delta = before.reduce((sum, value, index) => sum + Math.abs(value - after[index]!), 0) / before.length
    expect(delta).toBeLessThan(0.1)
  }
  await page.evaluate(() => window.water_probe.dispose())
})
