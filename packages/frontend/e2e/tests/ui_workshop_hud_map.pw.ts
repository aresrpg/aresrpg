// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('fight effects stay compact, chat avoids overlap, and HUD returns to center when chat shrinks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_hud.html')
  const hud = page.locator('.aui-combat-hud')
  const chat = page.locator('.gw-worldchat')
  await expect(hud).toBeVisible()
  await expect
    .poll(async () => {
      const a = (await hud.boundingBox())!,
        b = (await chat.boundingBox())!
      return a.x - (b.x + b.width)
    })
    .toBeGreaterThanOrEqual(10)
  const resize = page.locator('.chat__resize')
  await resize.focus()
  for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowLeft')
  await expect
    .poll(async () => {
      const box = (await hud.boundingBox())!
      return Math.abs(box.x + box.width / 2 - 720)
    })
    .toBeLessThan(1)
  await page.locator('.fight-hud__spell').first().hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip.locator('[data-fight-spell-effects]')).toBeVisible()
  await expect(tooltip.locator('.spell-constraints,[data-spell-level-tabs]')).toHaveCount(0)
  expect((await tooltip.boundingBox())!.height).toBeLessThan(180)
  await expect(page.locator('.aui-carved-icon img')).toHaveCount(12)
  await page.setViewportSize({ width: 844, height: 390 })
  await page.mouse.move(3, 3)
  await expect
    .poll(async () => {
      const a = (await hud.boundingBox())!,
        b = (await chat.boundingBox())!
      return a.x - (b.x + b.width)
    })
    .toBeGreaterThanOrEqual(10)
  expect((await hud.boundingBox())!.x + (await hud.boundingBox())!.width).toBeLessThanOrEqual(844)
})

test('production map reuses completed terrain during drag and zoom instead of exposing unfinished rows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_hud.html?map')
  const canvas = page.locator('.aui-map-interaction canvas')
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(800)
  const terrain_pixels = () =>
    canvas.evaluate((element: HTMLCanvasElement) => {
      const ctx = element.getContext('2d')!
      return [0.2, 0.4, 0.6, 0.8]
        .flatMap((x) =>
          [0.2, 0.4, 0.6, 0.8].map((y) => {
            const pixel = ctx.getImageData(Math.floor(element.width * x), Math.floor(element.height * y), 1, 1).data
            return (
              pixel[3] === 255 &&
              !(pixel[0] === 32 && pixel[1] === 42 && pixel[2] === 45) &&
              pixel[0] + pixel[1] + pixel[2] > 0
            )
          })
        )
        .filter(Boolean).length
    })
  expect(await terrain_pixels()).toBe(16)
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (const x of [0.55, 0.6, 0.65, 0.7]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height / 2, { steps: 4 })
    expect(await terrain_pixels()).toBe(16)
  }
  await page.mouse.up()
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  expect(await terrain_pixels()).toBe(16)
})
