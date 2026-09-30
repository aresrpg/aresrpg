// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { open_responsive_preview } from '../support/responsive_preview.ts'

test('wallet geometry waits for asynchronous locale initialization', async ({ page }) => {
  await page.route('**/assets/en-*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    await route.continue()
  })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
  await expect(page.locator('[data-wallet-trigger]')).toBeInViewport()
})

test('preview blocks external API calls while local assets load normally', async ({ page }) => {
  await page.route('https://fixture.invalid/**', (route) =>
    route.fulfill({ body: 'unexpected external response', headers: { 'access-control-allow-origin': '*' } })
  )
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
  const external_allowed = await page.evaluate(() =>
    fetch('https://fixture.invalid/api').then(
      () => true,
      () => false
    )
  )
  expect(external_allowed).toBe(false)
})

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
  { width: 640, height: 360 },
]) {
  test(`wallet popover stays inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
    const header = page.locator('.world-account')
    const trigger = header.locator('[data-wallet-trigger]')
    const wallet = page.locator('[data-wallet-card]')
    await expect(trigger).toBeInViewport()
    await expect(trigger).toHaveAccessibleName('Account')
    await expect(trigger).toHaveAttribute('aria-description', /SUI.*KARES/)
    await expect(page.locator('[data-app-account-panel] [data-wallet-card]')).toHaveCount(0)
    await expect(wallet).toBeHidden()
    await trigger.click()
    await expect(wallet).toBeVisible()
    await expect(wallet).toContainText('0xaaaaaa…aaaaa')
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
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}

test('closing a feature window restores access to the world account controls', async ({ page }) => {
  for (const route of ['settings', 'marketplace']) {
    await open_responsive_preview(page, `/e2e/fixtures/responsive_preview.html?page=${route}`)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click()
    await page.locator('[data-wallet-trigger]').click()
    await expect(page.locator('[data-wallet-card]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-wallet-card]')).toBeHidden()
  }
})

test('wallet actions and localized details remain reachable in the dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  for (const locale of ['en', 'fr', 'de', 'es', 'uk', 'ja']) {
    await open_responsive_preview(page, `/e2e/fixtures/responsive_preview.html?page=world&locale=${locale}`)
    await page.locator('[data-wallet-trigger]').click()
    const wallet = page.locator('[data-wallet-card]')
    await expect(wallet).toBeVisible()
    expect(await wallet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const button of await wallet.locator('button').all()) await expect(button).toBeInViewport()
    await page.keyboard.press('Escape')
  }
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
  await page.locator('[data-wallet-trigger]').click()
  await page.locator('[data-wallet-card]').getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('[data-wallet-card]')).toBeHidden()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('language choices remain reachable from settings in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 360 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=settings')
  await page.getByRole('button', { name: 'Language', exact: true }).click()
  const japanese = page.locator('.aui-language').getByRole('button', { name: /日本語/ })
  await japanese.scrollIntoViewIfNeeded()
  await expect(japanese).toBeInViewport()
  await japanese.click()
  await expect(page.locator('.language-trigger')).toContainText('日本語')
})

test('the account header formats linked names like the leaderboard', async ({ page }) => {
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world&suins=sceat.sceat.sui')
  const trigger = page.locator('[data-wallet-trigger]')
  await expect(trigger).toHaveAccessibleName('Account')
  await trigger.click()
  await expect(page.locator('[data-wallet-card]')).toContainText('@sceat')
})

test('world fullscreen toggle follows browser state and keeps account controls available', async ({ page }) => {
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
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
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
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

test('unsupported fullscreen leaves no unusable fullscreen button', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }))
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
  await expect(page.locator('[data-wallet-trigger]')).toBeVisible()
  await expect(page.locator('[data-fullscreen-toggle]')).toHaveCount(0)
})
