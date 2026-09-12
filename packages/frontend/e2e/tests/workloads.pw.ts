// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cpus, release, totalmem } from 'node:os'

import { expect, test } from '@playwright/test'
import type { EngineQuality } from '@aresrpg/engine'

import type {} from '../fixtures/workload.ts'
import { install_probe } from '../support/browser_probe.ts'
import { capture_flat_cpu_profile } from '../support/flat_cpu_profile.ts'

const mode = process.env.BROWSER_WORKLOAD === 'full' ? 'full' : 'smoke'
const full = mode === 'full'
const hardware = process.env.REQUIRE_HARDWARE === '1'
const populations: Readonly<
  Record<string, { characters: number; mobs: number; pets: number; frames: number; packs: number; nodes: number }>
> = {
  smaller: { characters: 32, mobs: 100, pets: 32, frames: 180, packs: 48, nodes: 20 },
  stress: { characters: 200, mobs: 100, pets: 100, frames: 180, packs: 48, nodes: 20 },
}
const population = populations[process.env.BROWSER_POPULATION ?? '']

const scenes = full
  ? [
      { name: 'city', location: 'city' as const },
      { name: 'forest', location: 'forest' as const },
      // Owner-reported regression on 2026-09-08, high quality and distance 11.
      { name: 'reported forest', location: 'forest' as const, focus: [-1527, -72] as const },
    ]
  : [{ name: 'city', location: 'city' as const }]

for (const quality of ['low', 'medium', 'high'] as const)
  for (const scene of scenes) {
    const { location } = scene
    const target_fps = process.platform === 'darwin' ? 120 : 30
    test(`${scene.name} / ${quality}`, async ({ page, browser }, info) => {
      const finish_profile = await capture_flat_cpu_profile(page, info, process.env.PERF_PROFILE === '1')
      const errors = new Set<string>()
      page.on('pageerror', (error) => errors.add(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.add(message.text())
        if (message.text().startsWith('[workload]')) console.log(`${scene.name}/${quality}`, message.text())
      })
      await page.addInitScript(install_probe)
      if (browser.browserType().name() === 'chromium') {
        const session = await page.context().newCDPSession(page)
        await session.send('Performance.enable')
        await page.exposeFunction('collect_heap', async () => {
          await session.send('HeapProfiler.collectGarbage')
          const { metrics } = await session.send('Performance.getMetrics')
          return metrics.find(({ name }) => name === 'JSHeapUsedSize')!.value
        })
      }
      await page.goto('/e2e/fixtures/workload.html')
      await page.waitForFunction(() => typeof window.run_workload === 'function')
      const { captures, ...result } = await page.evaluate((config) => window.run_workload(config), {
        quality,
        mode,
        benchmark: hardware,
        location,
        population,
        ...('focus' in scene ? { focus: scene.focus } : {}),
      } as const)
      const adapter = await page.evaluate(() => window.workload_adapter)
      await finish_profile()
      await info.attach('workload', {
        body: JSON.stringify(
          {
            os: process.platform,
            os_release: release(),
            arch: process.arch,
            cpu: cpus()[0]!.model,
            memory_bytes: totalmem(),
            browser: browser.version(),
            adapter,
            ...result,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })
      await Promise.all(
        Object.entries(captures).map(([stage, frame]) =>
          info.attach(stage, { body: Buffer.from(frame.split(',')[1]!, 'base64'), contentType: 'image/png' })
        )
      )
      expect([...errors]).toEqual([])
      expect(result.disposed_resources).toEqual({ buffers: 0, large_buffers: 0, buffer_bytes: 0, textures: 0 })
      expect(result.state.render.failed_chunks).toBe(0)
      expect(result.state.chunks.failed).toBe(0)
      const returned = result.samples.filter(({ stage }) => stage.startsWith('returned-'))
      expect(returned.length).toBe(full ? 4 : 2)
      for (const sample of returned) {
        expect(sample.resident).toBeLessThanOrEqual(returned[0]!.resident)
        expect(sample.radius).toBeLessThanOrEqual(returned[0]!.radius)
        expect(sample.queued).toBe(0)
        expect(sample.in_flight).toBe(0)
        expect(sample.resources.buffers).toBeLessThanOrEqual(returned[0]!.resources.buffers)
        expect(sample.resources.textures).toBeLessThanOrEqual(returned[0]!.resources.textures)
        if (sample.heap_bytes !== null)
          expect(sample.heap_bytes - returned[0]!.heap_bytes!).toBeLessThanOrEqual(32 * 1024 * 1024)
      }
      const cycled = result.samples.filter(({ stage }) => stage === 'quality-cycle-high')
      for (const sample of cycled.slice(1)) {
        expect(sample.resources.textures, 'Quality switches retain no superseded render targets').toBe(
          cycled[0]!.resources.textures
        )
        expect(sample.resources.large_buffers, 'Quality switches retain one far-index allocation').toBe(
          cycled[0]!.resources.large_buffers
        )
      }
      if (hardware) {
        expect(result.backend, 'Performance requires the real WebGPU renderer').toBe('webgpu')
        expect(adapter, 'The actual renderer adapter must identify itself').not.toBeNull()
        expect(adapter!.fallback).toBe(false)
        expect(JSON.stringify(adapter)).not.toMatch(/swiftshader|llvmpipe|software/i)
        const running = result.samples.filter(
          ({ stage }) =>
            ![
              'startup',
              'population',
              'player-entry',
              'crowd-entry',
              'fight-entry',
              'flatten-transition',
              'restore-transition',
            ].includes(stage) && !stage.startsWith('quality-')
        )
        // Teleport stress keeps stall/resource bounds; steady gameplay owns the FPS target.
        for (const sample of running.filter(({ stage }) => !stage.includes('traversal'))) {
          expect(sample.p95_ms, `${sample.stage}: submission p95`).toBeLessThanOrEqual(1000 / target_fps)
          expect(sample.completed_fps, `${sample.stage}: GPU completion must be measured`).not.toBeNull()
          expect(sample.completed_fps!, `${sample.stage}: completed throughput`).toBeGreaterThanOrEqual(target_fps)
        }
        expect(
          Math.max(...result.samples.map(({ max_ms }) => max_ms)),
          'Cold or transition frame stall'
        ).toBeLessThanOrEqual(500)
        expect(Math.max(...running.map(({ max_ms }) => max_ms)), 'Steady or streaming frame stall').toBeLessThanOrEqual(
          250
        )
        expect(result.ready_ms, 'Cold world loading').toBeLessThanOrEqual(15_000)
      }
    })
  }

for (const missing of ['api', 'adapter'])
  test(`missing WebGPU ${missing} uses the playable flat fallback`, async ({ page }, info) => {
    await page.addInitScript(install_probe)
    await page.addInitScript(
      (kind) =>
        Object.defineProperty(navigator, 'gpu', {
          value: kind === 'api' ? undefined : { requestAdapter: async () => null },
        }),
      missing
    )
    await page.goto('/e2e/fixtures/workload.html')
    await page.waitForFunction(() => typeof window.run_workload === 'function')
    const result = await page.evaluate(() =>
      window.run_workload({ quality: 'low' as EngineQuality, mode: 'smoke', location: 'city' })
    )
    expect(result.backend).toBe('grid')
    expect(result.state.chunks).toMatchObject({ resident: 0, planning: 0, queued: 0, in_flight: 0 })
    expect(result.characters).toBe(24)
    expect(result.mobs).toBe(12)
    await info.attach('fallback', { body: JSON.stringify(result), contentType: 'application/json' })
  })
