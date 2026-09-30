// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('missing WebGPU stops immediately without replacing the renderer or downgrading settings', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/e2e/fixtures/engine_recovery.html')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.read_engine_recovery())).toMatchObject({
    state: 'failed',
    backend: 'none',
    recovery: 'none',
    issue: { code: 'webgpu_unavailable' },
  })
  await expect(page.getByRole('button', { name: 'Continue with grid', exact: true })).toHaveCount(0)
})

test('adapter failure retries once at minimum quality and never falls back to WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'adapter_requests', 0)
    Object.defineProperty(navigator, 'gpu', {
      value: {
        requestAdapter: async () => {
          Reflect.set(window, 'adapter_requests', Number(Reflect.get(window, 'adapter_requests')) + 1)
          return null
        },
        getPreferredCanvasFormat: () => 'bgra8unorm',
      },
    })
  })
  await page.goto('/e2e/fixtures/engine_recovery.html')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.read_engine_recovery())).toMatchObject({
    state: 'failed',
    backend: 'none',
    recovery: 'minimum',
    issue: { code: 'webgpu_initialization_failed' },
  })
  expect(await page.evaluate(() => Reflect.get(window, 'adapter_requests'))).toBe(2)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aresrpg.settings')!))).toMatchObject({
    quality: 'low',
    render_distance: 3,
  })
})
