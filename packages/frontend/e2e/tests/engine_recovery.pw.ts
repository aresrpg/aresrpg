// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('failed graphics exhausts exactly two fresh-canvas recovery attempts and persists minimum settings', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined })
    const canvases = new Set<HTMLCanvasElement>()
    const get_context = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = new Proxy(get_context, {
      apply: (target, receiver: HTMLCanvasElement, args) => {
        if (args[0] !== 'webgl2') return Reflect.apply(target, receiver, args)
        canvases.add(receiver)
        return null
      },
    })
    Reflect.set(window, 'recovery_canvases', canvases)
  })
  await page.goto('/e2e/fixtures/engine_recovery.html')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.read_engine_recovery())).toMatchObject({
    state: 'failed',
    recovery: 'grid',
  })
  expect(await page.evaluate(() => (Reflect.get(window, 'recovery_canvases') as Set<HTMLCanvasElement>).size)).toBe(3)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aresrpg.settings')!))).toMatchObject({
    quality: 'low',
    render_distance: 3,
  })
})

test('two failed world boots recover to a real WebGL grid on the third canvas', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined })
    const canvases = new Set<HTMLCanvasElement>()
    const get_context = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = new Proxy(get_context, {
      apply: (target, receiver: HTMLCanvasElement, args) => {
        if (args[0] === 'webgl2') {
          canvases.add(receiver)
          if (canvases.size <= 2) return null
        }
        return Reflect.apply(target, receiver, args)
      },
    })
    Reflect.set(window, 'recovery_canvases', canvases)
  })
  await page.goto('/e2e/fixtures/engine_recovery.html')
  await expect(page.getByRole('button', { name: 'Continue with grid', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.read_engine_recovery())).toMatchObject({
    state: 'degraded',
    backend: 'grid',
    recovery: 'grid',
  })
  const canvases = await page.evaluate(() =>
    [...(Reflect.get(window, 'recovery_canvases') as Set<HTMLCanvasElement>)].map((canvas) => canvas.isConnected)
  )
  expect(canvases).toEqual([false, false, true])
  await page.getByRole('button', { name: 'Continue with grid', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0)
})
