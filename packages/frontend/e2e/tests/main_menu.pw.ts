// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('startup and quality changes show loading progress until the world settles', async ({ page }) => {
  test.setTimeout(120_000)
  let release: () => void = () => {}
  const asset_gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(
    (url) => url.pathname.endsWith('/main_menu.json') && !url.search,
    async (route) => {
      await asset_gate
      await route.continue()
    }
  )
  await page.goto('/e2e/fixtures/main_menu.html')
  const overlay = page.locator('[data-world-loading]')
  await expect(overlay).toBeVisible()
  await expect(page.getByRole('progressbar')).toBeVisible()
  release()
  await expect(overlay).toHaveCount(0, { timeout: 90_000 })
  await page.getByRole('combobox').first().selectOption('low')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveCount(0, { timeout: 30_000 })
})

test('menu drawing-buffer changes cannot introduce viewport scrollbars', async ({ page }) => {
  await page.goto('/e2e/fixtures/main_menu.html')
  const canvas = page.locator('.main-menu-scene canvas')
  await expect(canvas).toBeVisible()
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 650, height: 390 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    // Emulate High-DPR renderer allocation and classic scrollbars: intrinsic buffer dimensions
    // must not grow the CSS surface, even while an oversized content child needs to scroll.
    await canvas.evaluate((element) => {
      element.setAttribute('width', '8192')
      element.setAttribute('height', '8192')
    })
    expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, ...viewport })
    expect(
      await page.locator('.main-menu').evaluate((node) => ({
        x: node.scrollWidth > node.clientWidth,
        y: node.scrollHeight > node.clientHeight,
      }))
    ).toEqual({ x: false, y: false })
    await expect(page.getByRole('img', { name: 'AresRPG' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Press Enter|Tap to start/ })).toBeInViewport()
  }
  await page.locator('.main-menu-content').evaluate((node) => {
    const child = document.createElement('div')
    child.style.cssText = 'height:2000px;flex-shrink:0'
    node.append(child)
  })
  expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 })
})

test('returning players see direct sign-in and replay actions without a card', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aresrpg.demo.played', '1'))
  await page.goto('/e2e/fixtures/main_menu.html')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Play the demo again' })).toBeVisible()
  await expect(page.getByText('Sign in to play', { exact: true })).toHaveCount(0)
  expect(await page.locator('.main-menu-login').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)'
  )
})

test('Enter starts the first demo and does not bypass returning-player sign-in', async ({ page }) => {
  await page.route('**/play-demo', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Demo destination</main>' })
  )
  await page.goto('/e2e/fixtures/main_menu.html')
  await expect(page.getByRole('link', { name: /Press Enter|Tap to start/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/play-demo$/)
  await page.evaluate(() => localStorage.setItem('aresrpg.demo.played', '1'))
  await page.goto('/e2e/fixtures/main_menu.html')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/main_menu\.html$/)
})

test.describe('touch menu layout', () => {
  test.use({ hasTouch: true })

  test('the start prompt stays below the subtitle in portrait and landscape', async ({ page }) => {
    await page.goto('/e2e/fixtures/main_menu.html')
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 1024, height: 512 },
    ]) {
      await page.setViewportSize(viewport)
      const subtitle = page.locator('.main-menu-heading p')
      const start = page.getByRole('link', { name: 'Tap to start', exact: true })
      await expect(start).toBeVisible()
      await expect
        .poll(async () => {
          const text = await subtitle.boundingBox()
          const button = await start.boundingBox()
          return text !== null && button !== null && button.y >= text.y + text.height
        })
        .toBe(true)
      await expect(start).toBeInViewport()
    }
  })
})
