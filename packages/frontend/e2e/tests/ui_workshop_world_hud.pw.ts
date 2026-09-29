// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`live HUD keeps six party members visible and utility controls reachable at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto(`/e2e/fixtures/ui_world_hud.html${viewport.width < 900 ? '?mobile' : ''}`)
    const dock = page.locator('.world-social-dock')
    await expect(dock.locator('.party-frame__member')).toHaveCount(6)
    const box = (await dock.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    expect(await dock.locator('.party-frame').evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true)
    await expect(page.locator('[data-character-tab="character-0"]')).toHaveAttribute('aria-pressed', 'true')
    if (viewport.width < 900) await page.locator('.character-switcher-trigger').click()
    await page.locator('[data-character-tab="character-1"]').click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    if (viewport.width < 900) {
      await expect(page.getByRole('button', { name: 'High', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Low', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Low', exact: true })).toHaveAttribute('aria-pressed', 'true')
    } else await expect(page.getByRole('button', { name: 'High', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Language', exact: true }).click()
    await expect(page.locator('.aui-language-grid .aui-language-badge')).toHaveCount(11)
    await page.getByRole('button', { name: /Français/ }).click()
    await expect(page.locator('.language-trigger')).toContainText('Français')
    await page.keyboard.press('Escape')
    const wallet = page.locator('[data-wallet-trigger]')
    await expect(wallet.locator('[data-sui-logo]')).toHaveCount(1)
    await expect(wallet.locator('[data-kares-logo]')).toHaveCount(1)
    await expect(wallet).toContainText('12.42')
    await expect(wallet).toContainText('12,345')
    const balances = await wallet.locator('.wallet-trigger__balance').all()
    const sui_box = (await balances[0]!.boundingBox())!
    const kares_box = (await balances[1]!.boundingBox())!
    expect(Math.abs(sui_box.y - kares_box.y)).toBeLessThan(1)
    expect(kares_box.x).toBeGreaterThan(sui_box.x + sui_box.width)
    expect(await wallet.innerText()).not.toContain('Account')
    await wallet.click()
    await expect(page.getByRole('button', { name: 'Add funds', exact: true })).toBeEnabled()
    await page.screenshot({ path: `/tmp/wallet-dropdown-${viewport.width}.png` })
    await page.getByRole('button', { name: 'Add funds', exact: true }).click()
    await expect(page.locator('.aui-funding-window')).toBeVisible()
    await page.keyboard.press('Escape')
    if (viewport.width < 900) {
      await expect(page.locator('[data-fullscreen-toggle]')).toBeHidden()
      await page.getByRole('button', { name: /Nearby fights/ }).click()
      await expect(page.locator('.mobile-camera')).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Run & join' })).toHaveCount(2)
    const party_box = (await dock.locator('.party-frame').boundingBox())!
    const nearby_box = (await dock.locator('.world-nearby-fights').boundingBox())!
    if (viewport.width < 900) expect(nearby_box.x + nearby_box.width).toBeLessThanOrEqual(party_box.x)
    await page.getByRole('button', { name: 'Run & join' }).first().click()
    await expect(page.getByText('Running to position', { exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Group only', exact: true })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('switch', { name: 'Group only', exact: true }).click()
    await expect(page.getByRole('switch', { name: 'Group only', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: `/tmp/live-hud-${viewport.width}.png` })
  })
}

test('signed-out wallet balances open the same dropdown without inventing amounts', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui_world_hud.html?guest')
  const wallet = page.locator('[data-wallet-trigger]')
  await expect(wallet.locator('.wallet-trigger__balance')).toHaveCount(2)
  expect(await wallet.innerText()).not.toContain('Account')
  await wallet.click()
  await expect(page.locator('[data-wallet-card]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add funds', exact: true })).toBeDisabled()
  await expect(
    page.locator('[data-wallet-card]').getByRole('link', { name: 'Sign in to play', exact: true })
  ).toBeVisible()
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`Settings uses the shared layout and live native toggles at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.locator('.aui-settings')
    await expect(settings).toBeVisible()
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await settings.getByRole('button', { name: 'Volume', exact: true }).click()
    const music = settings.getByRole('switch', { name: 'Music', exact: true })
    await expect(music).toBeChecked()
    await music.uncheck()
    await expect(music).not.toBeChecked()
    await settings.getByRole('button', { name: 'Quality', exact: true }).click()
    await settings.getByRole('button', { name: 'Volume', exact: true }).click()
    await expect(music).not.toBeChecked()
    await page.screenshot({ path: `/tmp/settings-shared-${viewport.width}.png` })
    await settings.getByRole('button', { name: 'Account', exact: true }).click()
    await expect(settings.locator('[data-suins-settings]')).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Use this name', exact: true })).toBeVisible()
  })
}
