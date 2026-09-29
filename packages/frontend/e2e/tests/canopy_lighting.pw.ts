// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('rounded canopy lighting has no roughness-dependent sun reflection underneath', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 800, height: 700 })
  await page.goto('/e2e/fixtures/canopy_lighting.html')
  await page.waitForFunction(() => window.canopy_lighting?.snapshot().materials === 1)
  expect((await page.evaluate(() => window.canopy_lighting.snapshot())).lights).toEqual([
    'DirectionalLight',
    'HemisphereLight',
  ])
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  )
  const before = await page.screenshot({ path: test.info().outputPath('canopy.png') })
  await page.evaluate(() => window.canopy_lighting.max_roughness())
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  )
  const after = await page.screenshot()
  const delta = await page.evaluate(
    async ({ before, after }) => {
      const read = async (bytes: number[]) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        image.close()
        return context.getImageData(200, 150, 400, 400).data
      }
      const a = await read(before),
        b = await read(after)
      let total = 0
      for (let index = 0; index < a.length; index += 4)
        total +=
          Math.abs(a[index]! - b[index]!) +
          Math.abs(a[index + 1]! - b[index + 1]!) +
          Math.abs(a[index + 2]! - b[index + 2]!)
      return total / (400 * 400 * 3)
    },
    { before: [...before], after: [...after] }
  )
  expect(delta).toBeLessThan(0.25)
  expect(errors).toEqual([])
})
