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
  await page.screenshot({ path: test.info().outputPath('canopy.png') })
  const delta = await page.locator('canvas').evaluate(async (source: HTMLCanvasElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 700
    const context = canvas.getContext('2d')!
    const read = () => {
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      return context.getImageData(200, 150, 400, 400).data
    }
    await new Promise(requestAnimationFrame)
    const before = read()
    window.canopy_lighting.max_roughness()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const after = read()
    let total = 0
    for (let index = 0; index < before.length; index += 4)
      total +=
        Math.abs(before[index]! - after[index]!) +
        Math.abs(before[index + 1]! - after[index + 1]!) +
        Math.abs(before[index + 2]! - after[index + 2]!)
    return total / (400 * 400 * 3)
  })
  expect(delta).toBeLessThan(0.25)
  expect(errors).toEqual([])
})
