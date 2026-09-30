// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cpus, release, totalmem } from 'node:os'

import { expect, test } from '@playwright/test'

import { install_probe } from '../support/browser_probe.ts'
import { expect_released_resources } from '../support/workload_assertions.ts'

// Report measured throughput with machine identity; OS names are not hardware budgets.
for (const location of ['city', 'forest'] as const) {
  test(`production ${location} streaming and population`, async ({ page, browser }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
      if (message.text().startsWith('[workload]')) console.log(location, message.text())
    })
    await page.addInitScript(install_probe)
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    await page.exposeFunction('collect_heap', async () => {
      await session.send('HeapProfiler.collectGarbage')
      const { metrics } = await session.send('Performance.getMetrics')
      return metrics.find(({ name }) => name === 'JSHeapUsedSize')!.value
    })
    await page.goto('/e2e/fixtures/workload.html')
    await page.waitForFunction(() => typeof window.run_workload === 'function')
    const result = await page.evaluate(
      (location) =>
        window.run_workload({
          quality: 'high',
          mode: 'full',
          benchmark: true,
          location,
        }),
      location
    )
    const adapter = await page.evaluate(() => window.workload_adapter)
    const { captures, ...measurements } = result
    await info.attach('performance', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          os: process.platform,
          os_release: release(),
          cpu: cpus()[0]!.model,
          memory_bytes: totalmem(),
          browser: browser.version(),
          adapter,
          ...measurements,
        },
        null,
        2
      ),
    })
    for (const [name, frame] of Object.entries(captures)) {
      if (frame)
        await info.attach(name, { body: Buffer.from(frame.split(',')[1]!, 'base64'), contentType: 'image/png' })
    }
    expect(result.backend).toBe('webgpu')
    expect(adapter).not.toBeNull()
    expect(adapter!.fallback).toBe(false)
    expect(JSON.stringify(adapter)).not.toMatch(/swiftshader|llvmpipe|software/i)
    expect_released_resources(result)
    expect(errors).toEqual([])
  })
}
