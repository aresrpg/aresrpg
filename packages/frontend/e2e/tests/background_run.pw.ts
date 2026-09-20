// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('run-to keeps moving and arrives after switching to the marketplace', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/e2e/fixtures/background_run.html')
  // Let the real world boot before spending the UI action budget on its notice.
  await page.waitForFunction(() => Boolean(Reflect.get(window, 'background_run_state')?.().pose), undefined, {
    timeout: 30_000,
  })
  const notice = page.getByRole('button', { name: 'Continue with grid', exact: true })
  await notice.click()
  await expect(notice).toHaveCount(0)
  await page.evaluate(() => Reflect.get(window, 'background_run_start')())
  await page.waitForFunction(() => Reflect.get(window, 'background_run_state')().pose?.x > 1)
  const before = await page.evaluate(() => Reflect.get(window, 'background_run_state')().pose.x as number)
  await page.evaluate(() => Reflect.get(window, 'background_run_page')())
  await expect(page.locator('[data-world-frame]')).toHaveAttribute('aria-hidden', 'true')
  await page.waitForFunction((x) => Reflect.get(window, 'background_run_state')().pose?.x > x + 2, before)
  expect(await page.evaluate(() => Reflect.get(window, 'background_run_state')().run?.status)).toBe('running')
  await page.waitForFunction(() => Reflect.get(window, 'background_run_state')().run === null, undefined, {
    timeout: 15_000,
  })
})
