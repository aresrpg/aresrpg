// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/workload.ts'

import { install_probe } from '../support/browser_probe.ts'
import { install_renderer_startup_trace } from '../support/renderer_startup_trace.ts'

test('the renderer presents terrain and releases its GPU resources', async ({ page, browser }, info) => {
  const diagnostics = await browser.newBrowserCDPSession()
  const { gpu } = await diagnostics.send('SystemInfo.getInfo')
  await info.attach('graphics-environment', {
    body: JSON.stringify({ browser: browser.version(), gpu }, null, 2),
    contentType: 'application/json',
  })
  await diagnostics.detach()
  const errors: string[] = []
  const startup: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().startsWith('[renderer-startup]')) startup.push(message.text())
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(install_probe)
  await page.addInitScript(install_renderer_startup_trace)
  try {
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
    const webgl_uploads = startup
      .map((line) => JSON.parse(line.slice('[renderer-startup] '.length)) as { webgl_drawn_after_resize?: boolean })
      .filter((event) => event.webgl_drawn_after_resize !== undefined)
    expect(webgl_uploads.length).toBeGreaterThan(0)
    expect(webgl_uploads.every((event) => event.webgl_drawn_after_resize)).toBe(true)
  } finally {
    await info.attach('renderer-startup-trace', { body: startup.join('\n'), contentType: 'text/plain' })
  }
})
