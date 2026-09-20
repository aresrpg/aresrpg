// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('sparse marketplace sales draw a connected price line across untraded days', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/e2e/fixtures/marketplace.html?stackable&tiny&sparse')
  const canvas = page.locator('[data-tradingview-prices] canvas').first()
  await expect(canvas).toBeVisible()
  await expect(async () => {
    const longest_line = await canvas.evaluate((element: HTMLCanvasElement) => {
      const { width, height } = element
      const { data } = element.getContext('2d')!.getImageData(0, 0, width, height)
      let run = 0
      let longest = 0
      for (let x = 0; x < width; x++) {
        let cyan = false
        for (let y = 0; y < height; y++) {
          const offset = (y * width + x) * 4
          if (Math.abs(data[offset]! - 74) < 10 && Math.abs(data[offset + 1]! - 158) < 10 && data[offset + 2]! > 245)
            cyan = true
        }
        run = cyan ? run + 1 : 0
        longest = Math.max(longest, run)
      }
      return longest
    })
    expect(longest_line).toBeGreaterThan(40)
  }).toPass()
})
