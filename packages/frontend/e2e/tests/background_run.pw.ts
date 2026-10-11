// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { install_probe } from '../support/browser_probe.ts'

test('run-to arrives behind the marketplace and in a hidden tab without GPU submissions', async ({ page }) => {
  const city_downloads: string[] = []
  page.on('request', (request) => {
    if (/\/assets\/(thebes|the_ruins|fuwage)-.*\.json$/.test(request.url())) city_downloads.push(request.url())
  })
  await page.addInitScript(install_probe)
  await page.goto('/e2e/fixtures/background_run.html')
  // Let the real world boot before spending the UI action budget on its notice.
  await page.waitForFunction(() => Boolean(Reflect.get(window, 'background_run_state')?.().pose), undefined, {
    timeout: 30_000,
  })
  const start_x = await page.evaluate(() => Reflect.get(window, 'background_run_state')().pose.x as number)
  await page.evaluate(() => Reflect.get(window, 'background_run_start')())
  // A spawned pose is not movement: terrain can still be loading, so the ETA is legitimately unknown.
  await page.waitForFunction((x) => Reflect.get(window, 'background_run_state')().pose?.x > x + 1, start_x, {
    timeout: 30_000,
  })
  await expect(page.locator('.world-run-progress')).toContainText(/≈\d+:\d{2}/)
  const before = await page.evaluate(() => Reflect.get(window, 'background_run_state')().pose.x as number)
  await page.evaluate(() => Reflect.get(window, 'background_run_page')())
  await expect(page.locator('[data-world-frame]')).toBeVisible()
  await page.waitForFunction((x) => Reflect.get(window, 'background_run_state')().pose?.x > x + 2, before)
  const hidden_submissions = await page.evaluate(async () => {
    await window.workload_gpu_done?.()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    return window.workload_submissions
  })
  await page.waitForFunction(() => Reflect.get(window, 'background_run_state')().run === null, undefined, {
    timeout: 15_000,
    polling: 100,
  })
  expect(await page.evaluate(() => window.workload_submissions)).toBe(hidden_submissions)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'visibilityState')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForFunction((before) => window.workload_submissions > before, hidden_submissions)
  // The physical controller can finish braking after the arrival signal on sloped terrain.
  expect(
    Math.abs((await page.evaluate(() => Reflect.get(window, 'background_run_state')().pose.x as number)) - start_x - 50)
  ).toBeLessThan(2)
  expect(city_downloads).toEqual([])
})
