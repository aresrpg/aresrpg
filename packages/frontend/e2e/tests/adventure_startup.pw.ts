// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('a failed adventure scene stays recoverable without starting a fallback world', async ({ page }) => {
  let requests = 0
  await page.route(/\/assets\/adventure-[^/]+\.json$/, (route) => {
    requests += 1
    return route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.goto('/play-demo')
  await expect(page.locator('[data-world-loading="failed"]')).toBeVisible()
  await expect(page.locator('[data-world-loading="failed"] button')).toBeVisible()
  await expect(page.locator('.world-social-dock')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reload', exact: true }).last().click()
  await expect.poll(() => requests).toBe(2)
  await expect(page.locator('[data-world-loading="failed"]')).toBeVisible()
})
