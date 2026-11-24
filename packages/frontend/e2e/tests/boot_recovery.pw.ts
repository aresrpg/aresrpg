// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }

const policy = deployment.headers
  .flatMap((row) => row.headers)
  .find((header) => header.key === 'Content-Security-Policy')!.value

test.use({ serviceWorkers: 'block' })
// Every document is served under the production content security policy.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
})

test('a game whose code went missing stays on its failed postcard until the player reloads', async ({ page }) => {
  let navigations = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++
  })
  await page.route(/\/assets\/start-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/world?source=test#test-claim-key')
  const shell = page.locator('[data-boot-loading]')
  await expect(shell).toHaveAttribute('data-world-loading', 'failed')
  const reload = shell.getByRole('button', { name: 'Reload', exact: true })
  await expect(reload).toBeVisible()
  // Preload and dynamic import may each request the missing code. Navigation is the recovery invariant.
  expect(navigations).toBe(1)
  await reload.click()
  await expect.poll(() => navigations).toBe(2)
  expect(page.url()).toContain('/world?source=test#test-claim-key')
})

test('the game document offers browser reload instructions without JavaScript or losing its address', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto('/world?source=test#test-claim-key')
    // The postcard reveals its recovery after its delay; with no script, the browser's own reload is the way.
    const recovery = page.locator('[data-boot-loading] .loading-browser-reload')
    await expect(recovery).toHaveText('Use your browser’s Reload button to try again.')
    await expect(recovery).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0)
    expect(page.url()).toContain('/world?source=test#test-claim-key')
  } finally {
    await context.close()
  }
})
