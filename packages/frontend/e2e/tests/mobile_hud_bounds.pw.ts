// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('mobile chat moves, resizes and stays inside an inset game canvas', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_hud.html')
  await page.locator('main').evaluate((node) => {
    node.style.inset = '24px'
  })
  const toggle = page.locator('.chat__toggle')
  const before = (await toggle.boundingBox())!
  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: before.x + 20, y: before.y + 20 }],
  })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: before.x + 180, y: before.y + 70 }],
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect((await toggle.boundingBox())!.x).toBeGreaterThan(before.x + 80)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect((await page.getByRole('log').boundingBox())!.height).toBeGreaterThan(100)
  const grip = (await page.locator('.chat__resize').boundingBox())!
  expect(grip.width).toBeGreaterThanOrEqual(44)
  await page.mouse.move(grip.x + 20, grip.y + 20)
  await page.mouse.down()
  await page.mouse.move(1200, -400, { steps: 12 })
  await page.mouse.up()
  await expect(async () => {
    const chat = (await page.locator('.gw-worldchat').boundingBox())!
    const frame = (await page.locator('[data-chat-viewport]').boundingBox())!
    expect(chat.x).toBeGreaterThanOrEqual(frame.x - 1)
    expect(chat.y).toBeGreaterThanOrEqual(frame.y - 1)
    expect(chat.x + chat.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
    expect(chat.y + chat.height).toBeLessThanOrEqual(frame.y + frame.height + 1)
  }).toPass()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(async () => {
    const chat = (await page.locator('.gw-worldchat').boundingBox())!
    const frame = (await page.locator('[data-chat-viewport]').boundingBox())!
    expect(chat.x).toBeGreaterThanOrEqual(frame.x - 1)
    expect(chat.y).toBeGreaterThanOrEqual(frame.y - 1)
    expect(chat.x + chat.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
    expect(chat.y + chat.height).toBeLessThanOrEqual(frame.y + frame.height + 1)
  }).toPass()
})
