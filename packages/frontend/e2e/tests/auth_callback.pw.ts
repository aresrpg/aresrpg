// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const pathname of ['/enoki', '/enoki/']) {
  test(`the OAuth callback ${pathname} preserves its result when the popup inherits a gift intent`, async ({
    page,
  }) => {
    const application_requests: string[] = []
    page.on('request', (request) => {
      if (/\/assets\/(app_boot|game_entry)-[^/]+\.js$/.test(new URL(request.url()).pathname))
        application_requests.push(request.url())
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      // Synthetic bearer and OAuth values; this test never authenticates or claims an asset.
      sessionStorage.setItem('aresrpg:gift-link', `${location.origin}/gift#$test-gift`)
    })
    await page.goto(`${pathname}#id_token=test-oauth-result`, { waitUntil: 'networkidle' })
    expect(new URL(page.url()).pathname).toBe(pathname)
    expect(new URL(page.url()).hash).toBe('#id_token=test-oauth-result')
    await expect(page.locator('#root')).toBeEmpty()
    expect(application_requests).toEqual([])
  })
}
