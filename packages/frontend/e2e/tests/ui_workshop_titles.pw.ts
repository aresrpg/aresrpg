// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('a player without a title is vertically centered inside the nameplate', async ({ page }) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Titles', exact: true }).click()
  await page.evaluate(() => document.fonts.ready)
  const plate = page.locator('[data-nameplate-title="none"] canvas')
  await expect
    .poll(() =>
      plate.evaluate((canvas: HTMLCanvasElement) => {
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const rows: number[] = []
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const offset = (y * canvas.width + x) * 4
            if (data[offset]! > 210 && data[offset + 1]! > 210 && data[offset + 2]! > 210 && data[offset + 3]! > 180)
              rows.push(y)
          }
        }
        return Math.abs((Math.min(...rows) + Math.max(...rows)) / 2 - canvas.height / 2)
      })
    )
    .toBeLessThanOrEqual(1)
})

test('admin and veteran load their generated ornaments and share the subtitle layout', async ({ page }) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Titles', exact: true }).click()
  const veteran = page.locator('[data-nameplate-title="title_veteran"] canvas')
  const admin = page.locator('[data-nameplate-title="admin"] canvas')
  await expect(veteran).toHaveAttribute('aria-label', 'Sceat · Veteran')
  await expect(admin).toHaveAttribute('aria-label', 'Sceat · Admin')
  const expect_ornaments = async () => {
    for (const [canvas, channel] of [
      [veteran, 1],
      [admin, 0],
    ] as const) {
      await expect
        .poll(() =>
          canvas.evaluate((element: HTMLCanvasElement, dominant) => {
            const { data } = element.getContext('2d')!.getImageData(0, 0, element.width, element.height)
            let colored = 0
            for (let y = 0; y < element.height; y++) {
              for (let x = 0; x < 50; x++) {
                const offset = (y * element.width + x) * 4
                if (data[offset + 3]! > 50 && data[offset + dominant]! > data[offset + 1 - dominant]! * 1.2) colored++
              }
            }
            return colored
          }, channel)
        )
        .toBeGreaterThan(100)
    }
    await expect
      .poll(() =>
        admin.evaluate((canvas: HTMLCanvasElement) => {
          const { data } = canvas.getContext('2d')!.getImageData(canvas.width / 2 - 40, 0, 80, 26)
          let red = 0
          for (let offset = 0; offset < data.length; offset += 4) {
            if (data[offset]! > 100 && data[offset]! > data[offset + 1]! * 2 && data[offset + 3]! > 50) red++
          }
          return red
        })
      )
      .toBeGreaterThan(20)
  }
  await expect_ornaments()
  const sizes = await page
    .locator('[data-nameplate-title]:not([data-nameplate-title="none"]) canvas')
    .evaluateAll((canvases: HTMLCanvasElement[]) => canvases.map(({ width, height }) => ({ width, height })))
  expect(sizes[0]).toEqual(sizes[1])
  await page.getByRole('button', { name: 'Mobile · 932 × 430', exact: true }).click()
  await expect(page.locator('.aui-preview-surface [data-nameplate-title] canvas')).toHaveCount(3)
  await expect_ornaments()
  await page.screenshot({ path: test.info().outputPath('nameplates.png') })
})
