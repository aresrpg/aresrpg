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
  await page.screenshot({ path: '/tmp/mobile-chat-bounded.png' })
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

test('HP loss drains visible heart pixels instead of its transparent top padding', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui_hud.html?damage')
  await expect(page.locator('.aui-health')).toContainText('1040')
  await page.getByRole('button', { name: 'Take damage' }).click()
  await expect(page.locator('.aui-health')).toContainText('936')
  await expect
    .poll(() =>
      page.locator('.aui-health-fill').evaluate((node) => Number.parseFloat(getComputedStyle(node).clipPath.slice(6)))
    )
    .toBeGreaterThan((22 / 128) * 100)
  await page.locator('.aui-health').screenshot({ path: '/tmp/heart-damaged.png' })
})

test('mobile turn introduction uses a small card below the system controls', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/fixtures/mobile_fight.html?intro')
  const card = page.locator('.fight-hud__turn-card')
  await card.evaluate((node) => {
    node.style.animation = 'none'
  })
  const box = (await card.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(300)
  expect(box.height).toBeLessThanOrEqual(96)
  expect(box.y).toBeGreaterThanOrEqual(50)
})

test('level-up radiance cannot enlarge the modal or document scroll area', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/adventure_quests.html')
  await page.locator('[data-win]').click()
  const dialog = page.locator('dialog[open]')
  await expect(dialog.locator('.aui-progression')).toBeVisible()
  expect(
    await dialog.evaluate((node) => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth)
  ).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Later', exact: true })).toBeInViewport()
  await page.screenshot({ path: '/tmp/mobile-level-contained.png' })
})
