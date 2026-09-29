// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`HUD placement and single Friends/Admin controls at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(`/e2e/fixtures/ui_world_hud.html?hud-layout${viewport.width < 900 ? '&mobile' : ''}`)
    const chat = page.locator('.gw-worldchat'),
      banner = page.locator('.current-event-hud')
    await expect(banner).toBeVisible()
    const chat_box = (await chat.boundingBox())!,
      banner_box = (await banner.boundingBox())!
    expect(banner_box.x).toBe(chat_box.x)
    if (viewport.width >= 1024) expect(banner_box.width).toBe(chat_box.width)
    else {
      expect(chat_box.width).toBeLessThan(90)
      expect(banner_box.width).toBeGreaterThan(chat_box.width)
      expect(banner_box.x + banner_box.width).toBeLessThanOrEqual(viewport.width)
    }
    expect(banner_box.y + banner_box.height).toBeLessThan(chat_box.y)
    expect(banner_box.height).toBeLessThan(100)
    const automation = page.locator('.world-social-dock [data-automation-panel]')
    await expect(automation).toBeVisible()
    expect((await automation.boundingBox())!.y).toBeGreaterThan((await page.locator('.party-frame').boundingBox())!.y)
    await automation.scrollIntoViewIfNeeded()
    expect((await automation.boundingBox())!.y + (await automation.boundingBox())!.height).toBeLessThanOrEqual(
      viewport.height
    )
    await page.locator('[data-test-notification]').evaluate((node: HTMLButtonElement) => node.click())
    const notification = page.getByText('HUD verification', { exact: true })
    await expect(notification).toBeVisible()
    const notification_box = (await notification.locator('xpath=../..').boundingBox())!
    expect(notification_box.y + notification_box.height).toBeGreaterThan(viewport.height - 30)
    expect(notification_box.x + notification_box.width).toBeGreaterThan(viewport.width - 30)
    await page.locator('[data-friends-card]').click()
    const friends = page.getByRole('dialog', { name: 'Friends', exact: true })
    await expect(friends).toHaveCount(1)
    await expect(friends.locator('.aui-window-header')).toHaveCount(1)
    await expect(friends.getByRole('button', { name: 'Add friend', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Admin', exact: true }).click()
    const header = page.locator('.aui-admin-port > .aui-window-header')
    await expect(header.locator('[data-wallet-menu]')).toHaveCount(1)
    await expect(page.getByText('Overview', { exact: true })).toHaveCount(0)
    const header_box = (await header.boundingBox())!
    const wallet_box = (await header.locator('[data-wallet-menu]').boundingBox())!
    expect(header_box.height).toBeLessThan(85)
    expect(wallet_box.y).toBeGreaterThanOrEqual(header_box.y)
    expect(wallet_box.y + wallet_box.height).toBeLessThanOrEqual(header_box.y + header_box.height)
    expect(wallet_box.x + wallet_box.width).toBeLessThan((await header.locator('.aui-window-title').boundingBox())!.x)
    await header.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.locator('[data-wallet-picker]')).toBeVisible()
  })
}

test('Admin charts stay wide and fit the available desktop space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Admin', exact: true }).click()
  const charts = page.locator('[data-admin-charts]')
  await expect(charts.getByRole('img')).toHaveCount(6)
  for (const height of [900, 1200]) {
    await page.setViewportSize({ width: 1440, height })
    await expect.poll(() => charts.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
    const plot = (await charts.getByRole('img').first().boundingBox())!
    expect(plot.width).toBeGreaterThan(plot.height * 2)
  }
})

test('Settings return-to-home uses the existing leave confirmation', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const leave = page.locator('.settings-footer').getByRole('button', { name: 'Return to home', exact: true })
  await expect(leave).toHaveClass(/aui-button--danger/)
  await leave.click()
  const confirmation = page.getByRole('dialog', { name: 'Do you want to leave the game?', exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Keep playing', exact: true }).click()
  await expect(leave).toBeVisible()
  await leave.click()
  await confirmation.getByRole('button', { name: 'Return to home', exact: true }).click()
  await expect(page.locator('[data-wallet-trigger]')).toContainText('—')
})
