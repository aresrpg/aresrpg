// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 844, height: 390 }]) {
  test(`HUD placement and single Friends/Admin controls at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(`/e2e/fixtures/ui_world_hud.html?hud-layout${viewport.width < 900 ? '&mobile' : ''}`)
    const chat = page.locator('.gw-worldchat'),
      banner = page.locator('.current-event-hud')
    await expect(banner).toBeHidden()
    expect((await chat.boundingBox())!.width).toBeLessThan(90)
    const search = page.locator('.world-zone-search')
    await expect(search).toHaveAccessibleName('Tap to search')
    await search.click({ trial: true })
    const search_box = (await search.boundingBox())!
    expect(search_box.height).toBeGreaterThanOrEqual(44)
    expect(search_box.x + search_box.width).toBeLessThanOrEqual((await page.locator('.gw-compass').boundingBox())!.x)
    await page.screenshot({ path: test.info().outputPath('mobile-hud.png') })
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
  await expect(page.locator('[data-wallet-trigger]')).toHaveCount(0)
})

for (const viewport of [
  { width: 667, height: 320 },
  { width: 1440, height: 900 },
]) {
  test(`nearby fights open in a bounded modal at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html?hud-layout&mobile')
    const button = page.locator('.world-multiplayer [aria-expanded]')
    const before = (await button.boundingBox())!
    await expect(page.locator('.world-nearby-fights')).toHaveCount(0)
    await button.click()
    const modal = page.getByRole('dialog', { name: 'Nearby fights', exact: true })
    await expect(modal).toBeVisible()
    const list = modal.locator('.world-nearby-fights')
    await expect(list.locator('.world-nearby-fight')).toHaveCount(2)
    const bounds = (await modal.locator('.aui-window').boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    expect((await button.boundingBox())!.y).toBe(before.y)
    await expect(list.getByRole('button').first()).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('nearby-fights.png') })
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.world-nearby-fights')).toHaveCount(0)
  })
}
