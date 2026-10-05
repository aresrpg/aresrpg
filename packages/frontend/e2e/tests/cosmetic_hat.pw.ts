// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }

test('Fud cosmetic overrides the regular hat and mounts its real GLB on the head', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
  })
  const policy = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!.value
  await page.route('**/e2e/fixtures/cosmetic_hat.html', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('/e2e/fixtures/cosmetic_hat.html')
  await expect(page.locator('output')).toContainText('"mounted":true')
  await expect(page.locator('output')).toContainText('"visible":true')
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/cosmetic-hat.png' })
})
