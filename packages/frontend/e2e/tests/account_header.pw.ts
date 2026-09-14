// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
  { width: 640, height: 360 },
]) {
  test(`wallet dropdown shares the header and stays inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    )
    await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
    const header = page.locator('[data-app-header]')
    const trigger = header.locator('[data-wallet-trigger]')
    const wallet = page.locator('[data-wallet-card]')
    await expect(trigger).toBeInViewport()
    await expect(trigger).toContainText('SUI')
    await expect(trigger).toContainText('Account')
    await expect(trigger).toContainText('0xaaaaaa…aaaaa')
    expect((await header.boundingBox())!.height).toBe(36)
    await expect(page.locator('[data-app-account-panel] [data-wallet-card]')).toHaveCount(0)
    await expect(wallet).toBeHidden()
    await trigger.click()
    await expect(wallet).toBeVisible()
    const box = (await wallet.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    expect(await wallet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/wallet-header-${viewport.width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(wallet).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await wallet.getByRole('button', { name: 'Add funds', exact: true }).click()
    await expect(wallet).toBeHidden()
    await expect(page.locator('dialog[open]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })
}

test('the account dropdown remains available on pages without character tabs', async ({ page }) => {
  for (const route of ['settings', 'marketplace']) {
    await page.goto(`/e2e/fixtures/responsive_preview.html?page=${route}`)
    await expect(page.locator('[data-character-tabs]')).toHaveCount(0)
    await page.locator('[data-wallet-trigger]').click()
    await expect(page.locator('[data-wallet-card]')).toBeVisible()
    await page.locator('[data-app-header]').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('[data-wallet-card]')).toBeHidden()
  }
})

test('wallet actions and localized details remain reachable in the dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  for (const locale of ['en', 'fr', 'de', 'es', 'uk', 'ja']) {
    await page.goto(`/e2e/fixtures/responsive_preview.html?page=world&locale=${locale}`)
    await page.locator('[data-wallet-trigger]').click()
    const wallet = page.locator('[data-wallet-card]')
    await expect(wallet).toBeVisible()
    expect(await wallet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const button of await wallet.locator('button').all()) await expect(button).toBeInViewport()
    await page.keyboard.press('Escape')
  }
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  await page.locator('[data-wallet-trigger]').click()
  await page.locator('[data-wallet-card]').getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('[data-wallet-card]')).toBeHidden()
  await expect(page.locator('dialog[open]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('language choices can be reached inside a short scrolling sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 360 })
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  const language = page.locator('[data-language-card]')
  await language.getByRole('button', { name: 'English', exact: true }).click()
  const japanese = language.getByRole('button', { name: '日本語', exact: true })
  await japanese.scrollIntoViewIfNeeded()
  await expect(japanese).toBeInViewport()
  await expect(page.locator('[data-connection-card]')).toBeInViewport({ ratio: 0.999 })
})

test('the account header formats linked names like the leaderboard', async ({ page }) => {
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world&suins=sceat.sceat.sui')
  const trigger = page.locator('[data-wallet-trigger]')
  await expect(trigger).toContainText('@sceat')
  await expect(trigger).toContainText('Account')
  await trigger.click()
  await expect(page.locator('[data-wallet-card]')).toContainText('0xaaaaaa…aaaaa')
})

test('navbar fullscreen toggle follows browser state and keeps account controls available', async ({ page }) => {
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  const toggle = page.locator('[data-fullscreen-toggle]')
  await toggle.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
  await expect(toggle).toHaveAccessibleName('Exit fullscreen')
  await expect(page.locator('[data-wallet-trigger]')).toBeInViewport()
  await toggle.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(toggle).toHaveAccessibleName('Enter fullscreen')
  await toggle.click()
  await page.evaluate(() => document.exitFullscreen())
  await expect(toggle).toHaveAccessibleName('Enter fullscreen')
})

test('fullscreen rejection remains visible without changing the toggle state', async ({ page }) => {
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = async () => {
      throw new Error('Permission denied')
    }
  })
  const toggle = page.locator('[data-fullscreen-toggle]')
  await toggle.click()
  await expect(page.getByText('Could not change fullscreen mode.', { exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
})

test('unsupported fullscreen leaves no unusable navbar button', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }))
  await page.goto('/e2e/fixtures/responsive_preview.html?page=world')
  await expect(page.locator('[data-wallet-trigger]')).toBeVisible()
  await expect(page.locator('[data-fullscreen-toggle]')).toHaveCount(0)
})
