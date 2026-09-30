// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { install_probe } from '../support/browser_probe.ts'
import { expect_released_resources } from '../support/workload_assertions.ts'

test('production rendering streams, switches quality and releases every GPU allocation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(install_probe)
  await page.goto('/e2e/fixtures/workload.html')
  await page.waitForFunction(() => typeof window.run_workload === 'function')
  const result = await page.evaluate(() =>
    window.run_workload({
      quality: 'high',
      mode: 'smoke',
      location: 'fixture',
      render_distance: 2,
    })
  )
  expect(result.backend).toBe('webgpu')
  expect_released_resources(result)
  expect(errors).toEqual([])
})
