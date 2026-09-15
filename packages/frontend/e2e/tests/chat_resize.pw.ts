// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('chat resizing persists across reloads while staying bounded beside the HUD', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  )
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  const chat = page.locator('.gw-worldchat')
  const handle = page.getByRole('button', { name: 'Resize chat' })
  await expect(handle).toBeVisible()
  const initial = (await chat.boundingBox())!
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(1800, 0, { steps: 5 })
  await page.mouse.up()
  const expanded = (await chat.boundingBox())!
  expect(expanded.width).toBeGreaterThan(initial.width)
  expect(expanded.height).toBeGreaterThan(initial.height)
  expect(expanded.width).toBeLessThanOrEqual(640)
  expect(expanded.height).toBeLessThanOrEqual(600)
  await page.screenshot({ path: 'test-results/resized-chat.png' })
  expect(expanded.x).toBe(initial.x)
  expect(Math.abs(expanded.y + expanded.height - initial.y - initial.height)).toBeLessThan(1)
  await page.mouse.move(20, 20)
  expect((await chat.boundingBox())!.width).toBe(expanded.width)
  await handle.focus()
  await page.keyboard.press('ArrowDown')
  expect((await chat.boundingBox())!.height).toBeLessThan(expanded.height)
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('aresrpg.settings')!).chat_size as { width: number; height: number }
  )
  expect(saved).toEqual({ width: expanded.width, height: expanded.height - 20 })
  await page.reload()
  await expect(handle).toBeVisible()
  await expect(async () => {
    const restored = (await chat.boundingBox())!
    expect(restored.width).toBe(saved.width)
    expect(restored.height).toBe(saved.height)
  }).toPass()
  for (const viewport of [
    { width: 800, height: 500 },
    { width: 440, height: 360 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(async () => {
      const box = (await chat.boundingBox())!
      const frame = (await page.locator('[data-world-frame]').boundingBox())!
      const hud = (await page.locator('.fight-hud--overworld .fight-hud__bar').boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(box.y).toBeGreaterThanOrEqual(frame.y)
      expect(hud.x + hud.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(hud.y + hud.height <= box.y + 1 || hud.x >= box.x + box.width).toBe(true)
    }).toPass()
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aresrpg.settings')!).chat_size)).toEqual(saved)
  await page.reload()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(async () => {
    const restored = (await chat.boundingBox())!
    expect(restored.width).toBe(saved.width)
    expect(restored.height).toBe(saved.height)
  }).toPass()
})

test('chat remains resizable when browser storage is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    })
  })
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  )
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  const chat = page.locator('.gw-worldchat')
  const handle = page.getByRole('button', { name: 'Resize chat' })
  await expect(handle).toBeVisible()
  const initial = (await chat.boundingBox())!
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  expect((await chat.boundingBox())!.width).toBeGreaterThan(initial.width)
  expect(errors).toEqual([])
})

test('fight chat uses the same resize handle and saved size as overworld chat', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  )
  await page.goto('/e2e/fixtures/responsive_preview.html?page=fight')
  const chat = page.locator('.preview-fight .gw-worldchat')
  const handle = chat.getByRole('button', { name: 'Resize chat' })
  await expect(handle).toBeVisible()
  const initial = (await chat.boundingBox())!
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 160, grip.y - 80, { steps: 5 })
  await page.mouse.up()
  const resized = (await chat.boundingBox())!
  expect(resized.width).toBeGreaterThan(initial.width)
  expect(resized.height).toBeGreaterThan(initial.height)
  const hud = (await page.locator('.preview-fight .fight-hud__bar').boundingBox())!
  expect(hud.x).toBeGreaterThanOrEqual(resized.x + resized.width)
  expect(hud.x + hud.width).toBeLessThanOrEqual(1920)

  await handle.focus()
  await page.keyboard.press('ArrowDown')
  expect((await chat.boundingBox())!.height).toBeLessThan(resized.height)
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('aresrpg.settings')!).chat_size as { width: number; height: number }
  )
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  await expect(async () => {
    const box = (await page.locator('.gw-worldchat').boundingBox())!
    expect(box.width).toBe(saved.width)
    expect(box.height).toBe(saved.height)
  }).toPass()
})
