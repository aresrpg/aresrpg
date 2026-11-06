// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    loading_probe: {
      frames: number
      started: number
      finished: number
      worker_frames: number
      requests: number
      done: boolean
      long_tasks: number[]
    }
  }
}

// Manual diagnostic over the production-built world, including real worker transfer and GPU readiness.
test('plant preparation leaves the loading UI thread available', async ({ page }) => {
  test.setTimeout(120000)
  await page.addInitScript(() => {
    const probe = {
      frames: 0,
      started: 0,
      finished: 0,
      worker_frames: 0,
      requests: 0,
      done: false,
      long_tasks: [] as number[],
    }
    window.loading_probe = probe
    const frame = () => {
      probe.frames++
      if (!probe.done) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    new PerformanceObserver((list) => {
      probe.long_tasks.push(...list.getEntries().map(({ duration }) => duration))
    }).observe({ type: 'longtask', buffered: true })
    window.Worker = new Proxy(Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker
        const post = worker.postMessage
        Reflect.set(worker, 'postMessage', (message: { type?: string } | null, ...options: unknown[]) => {
          if (message?.type === 'flora') {
            probe.requests++
            probe.started = performance.now()
            const initial_frames = probe.frames
            worker.addEventListener('message', ({ data }: MessageEvent<{ type?: string }>) => {
              if (data.type !== 'flora') return
              probe.finished = performance.now()
              probe.worker_frames = probe.frames - initial_frames
            })
          }
          return Reflect.apply(post, worker, [message, ...options])
        })
        return worker
      },
    })
  })
  await page.goto('/e2e/fixtures/loading_world.html')
  await expect(page.locator('.loading-modal[open]')).toBeVisible()
  await expect(page.locator('.loading-modal[open]')).toHaveCount(0, { timeout: 100000 })
  const probe = await page.evaluate(() => {
    window.loading_probe.done = true
    return window.loading_probe
  })
  await test.info().attach('loading-responsiveness', { body: JSON.stringify(probe), contentType: 'application/json' })
  expect(probe.requests).toBe(1)
  expect(probe.finished).toBeGreaterThan(probe.started)
  expect(probe.worker_frames).toBeGreaterThan(0)
})
