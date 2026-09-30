// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/workload.ts'

import { install_probe } from '../support/browser_probe.ts'

test('the renderer presents terrain and releases its GPU resources', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(install_probe)
  await page.goto('/e2e/fixtures/workload.html')
  await page.waitForFunction(() => typeof window.run_renderer_smoke === 'function')
  const result = await page.evaluate(() => window.run_renderer_smoke())
  expect(result.backend).toBe('webgpu')
  expect(result.displayed).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.workload_resources())).toEqual({
    buffers: 0,
    large_buffers: 0,
    buffer_bytes: 0,
    textures: 0,
  })
  expect(errors).toEqual([])
})
