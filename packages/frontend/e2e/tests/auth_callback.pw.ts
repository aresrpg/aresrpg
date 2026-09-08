// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('the OAuth callback preserves its result when the popup inherits a gift intent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    // Synthetic bearer and OAuth values; this test never authenticates or claims an asset.
    sessionStorage.setItem('aresrpg:gift-link', `${location.origin}/gift#$test-gift`)
  })
  await page.goto('/enoki#id_token=test-oauth-result', { waitUntil: 'networkidle' })
  expect(new URL(page.url()).pathname).toBe('/enoki')
  expect(new URL(page.url()).hash).toBe('#id_token=test-oauth-result')
  await expect(page.locator('#root')).toBeEmpty()
})
