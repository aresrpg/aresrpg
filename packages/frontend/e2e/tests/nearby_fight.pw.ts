// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

test('nearby fights animate alongside a walking player and release their models when hidden', async ({ page }) => {
  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message))
  await page.goto('/e2e/fixtures/nearby_fight.html')
  await page.waitForFunction(
    () => window.nearby_probe?.snapshot().viewer !== null && window.nearby_probe?.snapshot().engine.state === 'ready'
  )
  const before = await page.evaluate(() => window.nearby_probe.snapshot())
  await page.evaluate(() => window.nearby_probe.show())
  await page.waitForFunction(() => window.nearby_probe.snapshot().fighter !== null)
  const shown = await page.evaluate(() => window.nearby_probe.snapshot())
  expect(shown.viewer).not.toBeNull()
  expect(shown.pose?.character_id).toBe('viewer')
  expect(shown.camera?.target[2]).toBeCloseTo(before.camera!.target[2], 0)
  await page.evaluate(() => window.nearby_probe.step_fighter())
  await expect.poll(() => page.evaluate(() => window.nearby_probe.snapshot().cell)).not.toBe(shown.cell)
  await page.waitForFunction(() => window.nearby_probe.snapshot().queued === 0)
  await page.evaluate(() => window.nearby_probe.walk(1))
  await page.waitForFunction((start) => {
    const { pose } = window.nearby_probe.snapshot()
    return !!pose && Math.hypot(pose.x - start!.x, pose.z - start!.z) > 1
  }, shown.pose)
  await page.evaluate(() => window.nearby_probe.walk(0))
  await page.screenshot({ path: 'test-results/nearby-fight.png' })
  await page.evaluate(() => window.nearby_probe.hide())
  await page.waitForFunction(() => window.nearby_probe.snapshot().fighter === null)
  expect(await page.evaluate(() => window.nearby_probe.snapshot().viewer)).not.toBeNull()
  expect(crashes).toEqual([])
})

const obstruction_pixels = async (page: Page): Promise<number> => {
  const bytes = await page.screenshot()
  return page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0
      for (let offset = 0; offset < pixels.length; offset += 4)
        if (
          pixels[offset]! > 120 &&
          pixels[offset]! > pixels[offset + 1]! * 1.8 &&
          pixels[offset]! > pixels[offset + 2]! * 1.8
        )
          count++
      return count
    },
    [...bytes]
  )
}

test('ambient board clears obstructing voxels and restores them when it leaves view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/e2e/fixtures/nearby_fight.html?clearance')
  await page.waitForFunction(() => window.nearby_probe?.snapshot().engine.state === 'ready')
  await expect.poll(() => obstruction_pixels(page)).toBeGreaterThan(100)
  const before = await obstruction_pixels(page)
  await page.evaluate(() => window.nearby_probe.show())
  await page.waitForFunction(() => window.nearby_probe.snapshot().fighter !== null)
  await expect.poll(() => obstruction_pixels(page)).toBeLessThan(before * 0.2)
  await page.screenshot({ path: 'test-results/nearby-fight-clearance.png' })
  await page.evaluate(() => window.nearby_probe.hide())
  await expect.poll(() => obstruction_pixels(page)).toBeGreaterThan(before * 0.8)
})
