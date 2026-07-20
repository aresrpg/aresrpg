// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('Q3 dry lens is byte-identical to the legacy inactive graph', async ({ page }) => {
  await page.goto('/demo/lens_water_probe.html')
  await page.waitForFunction(() => /** @type {any} */ (window).__lw_ready === true)
  await page.evaluate(() => /** @type {any} */ (window).__lw.boot())
  const canvas = page.locator('#c')

  const legacy_dry = await canvas.screenshot()
  await page.evaluate(() => /** @type {any} */ (window).__lw.path('dry'))
  const identity_dry = await canvas.screenshot()
  expect(identity_dry).toEqual(legacy_dry)

  await page.evaluate(async () => {
    const lens = /** @type {any} */ (window).__lw
    await lens.path('wet')
    await lens.splash()
  })
  const wet = await canvas.screenshot()
  expect(wet.equals(identity_dry), 'wet path still renders a non-identity frame').toBe(false)
})
