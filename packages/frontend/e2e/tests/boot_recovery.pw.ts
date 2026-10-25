// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }

const policy = deployment.headers
  .flatMap((row) => row.headers)
  .find((header) => header.key === 'Content-Security-Policy')!.value

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
})

for (const asset of ['app_boot', 'game_entry']) {
  test(`missing ${asset} stays on the failed page until explicit reload`, async ({ page }) => {
    let navigations = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++
    })
    await page.route(new RegExp(`/assets/${asset}-[^/]+\\.js$`), (route) => {
      return route.fulfill({ status: 404, body: 'missing' })
    })
    await page.goto('/play-demo?source=test#test-claim-key')
    const shell = page.locator('[data-boot-loading]')
    await expect(shell).toHaveAttribute('data-world-loading', 'failed')
    const reload = shell.getByRole('button', { name: 'Reload', exact: true })
    await expect(reload).toBeVisible()
    // Preload and dynamic import may each request the missing asset. Navigation is the recovery invariant.
    expect(navigations).toBe(1)
    await reload.click()
    await expect.poll(() => navigations).toBe(2)
    expect(page.url()).toContain('/play-demo?source=test#test-claim-key')
  })
}

test('missing entry CSS exposes immediate recovery', async ({ page }) => {
  await page.route(/\/assets\/layout-[^/]+\.css$/, (route) => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/allocation')
  await expect(page.locator('[data-boot-loading]')).toHaveAttribute('data-world-loading', 'failed')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
})

test('the document offers browser reload instructions without JavaScript or losing claim keys', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto('/claim?source=test#test-claim-key')
    await expect(page.getByText('Use your browser’s Reload button to try again.')).toBeVisible({ timeout: 25000 })
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0)
    expect(page.url()).toContain('/claim?source=test#test-claim-key')
  } finally {
    await context.close()
  }
})

test('a slow import can still finish after recovery becomes available', async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  await page.route(/\/assets\/game_entry-[^/]+\.js$/, async (route) => {
    await gate.promise
    // Mount a small successful entry so this test needs no GPU or wallet.
    await route.fulfill({
      contentType: 'text/javascript',
      body: 'export const boot_game = () => document.getElementById("root").replaceChildren(document.createTextNode("Loaded"))',
    })
  })
  await page.goto('/play-demo', { waitUntil: 'domcontentloaded' })
  const shell = page.locator('[data-boot-loading]')
  await expect(shell.getByRole('button', { name: 'Reload', exact: true })).toBeVisible({ timeout: 25000 })
  await expect(shell).toHaveAttribute('data-world-loading', 'assets')
  gate.resolve()
  await expect(page.locator('#root')).toHaveText('Loaded')
})

test('an unavailable GPU adapter leaves loading with visible graphics recovery', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.gpu) Object.defineProperty(navigator.gpu, 'requestAdapter', { value: async () => null })
  })
  await page.goto('/')
  const failed = page.locator('.loading-modal[open] [data-world-loading="failed"]')
  await expect(failed).toBeVisible({ timeout: 30000 })
  await expect(failed).toContainText('Graphics could not start.')
  await expect(failed.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
})

test('a stalled mounted world offers recovery and still processes a late GPU result', async ({ page }) => {
  await page.addInitScript(() => {
    let released = false
    Object.defineProperty(navigator.gpu, 'requestAdapter', {
      value: () =>
        released
          ? Promise.resolve(null)
          : new Promise((resolve) => {
              Reflect.set(globalThis, 'finish_adapter', () => {
                released = true
                resolve(null)
              })
            }),
    })
  })
  await page.goto('/')
  const modal = page.locator('.loading-modal[open]')
  await expect(modal.locator('[data-world-loading="graphics"]')).toBeVisible({ timeout: 30000 })
  await expect(modal.getByRole('button', { name: 'Reload', exact: true })).toBeVisible({ timeout: 25000 })
  await expect(modal).toContainText('Loading is taking longer than expected.')
  await page.evaluate(() => Reflect.get(globalThis, 'finish_adapter')())
  await expect(modal.locator('[data-world-loading="failed"]')).toBeVisible()
})

test('renderer download failure offers reload without blaming browser compatibility', async ({ page }) => {
  let requests = 0
  await page.route(/\/assets\/webgpu_backend-[^/]+\.js$/, (route) => {
    requests++
    return route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.goto('/')
  const failed = page.locator('.loading-modal[open] [data-world-loading="failed"]')
  await expect(failed).toBeVisible({ timeout: 30000 })
  await expect(failed).toContainText('The world stopped loading or rendering.')
  await expect(failed).not.toContainText('Open it in a supported browser.')
  expect(requests).toBeGreaterThan(0)
})

test('loading text and progress stay separated before and after recovery appears', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 844, height: 390 },
      { width: 390, height: 640 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      for (const failed of [false, true]) {
        await page.locator('[data-boot-loading]').evaluate((element, failure) => {
          element.setAttribute('data-world-loading', failure ? 'failed' : 'assets')
        }, failed)
        const story = await page.locator('.loading-story').boundingBox()
        const progress = await page.locator('.loading-progress').boundingBox()
        expect(story!.y + story!.height).toBeLessThanOrEqual(progress!.y)
        await page.locator('.loading-progress').scrollIntoViewIfNeeded()
        const visible = await page.locator('.loading-progress').boundingBox()
        expect(visible!.y + visible!.height).toBeLessThanOrEqual(viewport.height)
      }
    }
  } finally {
    await context.close()
  }
})
