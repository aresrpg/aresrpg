// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { has_webgpu_adapter } from '../support/webgpu.ts'

for (const kind of ['grid', 'webgpu'] as const)
  test(`instanced captions preserve the world, health updates and cleanup (${kind})`, async ({ page }, info) => {
    await page.goto('/e2e/fixtures/captions.html')
    if (kind === 'webgpu') test.skip(!(await has_webgpu_adapter(page)), 'This browser has no WebGPU adapter')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const result = await page.evaluate((backend) => window.probe_captions(backend), kind)
    await info.attach(`captions-${kind}.png`, {
      body: Buffer.from(result.image.split(',')[1]!, 'base64'),
      contentType: 'image/png',
    })
    expect(result.background[3]).toBe(255)
    expect(result.background.slice(0, 3).some((channel) => channel > 30)).toBe(true)
    expect(result.retained).toEqual(result.background)
    expect(result.full_health[1]).toBeGreaterThan(200)
    expect(result.reduced_health[1]).toBeLessThan(100)
    expect(result.before.tiles).toBe(result.after.tiles)
    expect(result.before.instances).toBe(2)
    expect(result.disposed_labels.labels).toBe(0)
    expect(result.disposed_labels.pages).toBe(0)
    expect(result.clean).toEqual(result.background)
    expect(result.semantics.join('')).toContain('<script> 中文 한국어 tiếng Việt')
    expect(result.scripts).toBe(0)
    expect(result.restored).toBe(true)
    if (kind === 'grid') expect(result.recovered_health?.[1]).toBeGreaterThan(200)
    expect(errors).toEqual([])
  })
