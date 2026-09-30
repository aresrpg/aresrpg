// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cpus, release, totalmem } from 'node:os'

import { expect, test } from '@playwright/test'

import { install_gpu_timing_probe } from '../support/gpu_timing_probe.ts'
import { install_probe } from '../support/browser_probe.ts'
import { expect_released_resources } from '../support/workload_assertions.ts'

const CPU_RATE = Number(process.env.PERF_CPU_RATE ?? 1)

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
    if (process.env.PERF_GPU !== '0') await page.addInitScript(install_gpu_timing_probe)
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
          cpu_throttle: CPU_RATE,
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

const diagnostic_cases = [
  { location: 'city', quality: 'high', canopy: 'clusters', water: true },
  { location: 'city', quality: 'high', canopy: 'clusters', water: false },
  { location: 'city', quality: 'high', canopy: 'voxels', water: true },
  { location: 'forest', quality: 'high', canopy: 'clusters', water: true },
  { location: 'forest', quality: 'high', canopy: 'clusters', water: false },
  { location: 'forest', quality: 'high', canopy: 'voxels', water: true },
  { location: 'city', quality: 'medium', canopy: 'clusters', water: true },
  { location: 'city', quality: 'low', canopy: 'clusters', water: true },
  { location: 'ruins', quality: 'high', canopy: 'clusters', water: true, party_size: 3 },
  { location: 'ruins', quality: 'high', canopy: 'clusters', water: false, party_size: 3 },
  { location: 'ruins', quality: 'high', canopy: 'voxels', water: true, party_size: 3 },
  { location: 'ruins', quality: 'high', canopy: 'clusters', water: true, party_size: 3, navigation: true },
] as const

for (const config of diagnostic_cases) {
  const name = `${config.location}-${config.quality}-${config.canopy}-water-${config.water}${'navigation' in config ? '-navigation' : ''}`
  test(`diagnostic ${name}`, async ({ page, browser }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
      if (message.text().startsWith('[workload]')) console.log(name, message.text())
    })
    await page.addInitScript(install_probe)
    if (process.env.PERF_GPU !== '0') await page.addInitScript(install_gpu_timing_probe)
    await page.goto('/e2e/fixtures/workload.html')
    await page.waitForFunction(() => typeof window.run_diagnostics === 'function')
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE })
    if ('navigation' in config) {
      await session.send('Profiler.enable')
      await session.send('Profiler.start')
    }
    const { captures, ...measurements } = await page.evaluate((config) => window.run_diagnostics(config), config)
    if ('navigation' in config) {
      const { profile } = await session.send('Profiler.stop')
      await info.attach('cpu-profile', { contentType: 'application/json', body: JSON.stringify(profile) })
    }
    const adapter = await page.evaluate(() => window.workload_adapter)
    await info.attach('diagnostic', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          os: process.platform,
          os_release: release(),
          cpu: cpus()[0]!.model,
          memory_bytes: totalmem(),
          browser: browser.version(),
          adapter,
          cpu_throttle: CPU_RATE,
          ...measurements,
        },
        null,
        2
      ),
    })
    for (const [name, frame] of Object.entries(captures)) {
      await info.attach(name, { body: Buffer.from(frame.split(',')[1]!, 'base64'), contentType: 'image/png' })
    }
    for (const sample of measurements.samples.filter(({ stage }) => stage.startsWith('empty-'))) {
      if (sample.uploads) expect(sample.uploads.bytes / sample.frames).toBeLessThan(65_536)
    }
    expect(measurements.backend).toBe('webgpu')
    expect(adapter).not.toBeNull()
    expect(adapter!.fallback).toBe(false)
    expect(JSON.stringify(adapter)).not.toMatch(/swiftshader|llvmpipe|software/i)
    expect(await page.evaluate(() => window.workload_resources())).toEqual({
      buffers: 0,
      large_buffers: 0,
      buffer_bytes: 0,
      textures: 0,
    })
    expect(errors).toEqual([])
  })
}
