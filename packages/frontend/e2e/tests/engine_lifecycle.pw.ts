// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('unavailable graphics reports initialization failure without waiting for a world pose', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined })
    const get_context = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = new Proxy(get_context, {
      apply: (target, receiver, args) => (args[0] === 'webgl2' ? null : Reflect.apply(target, receiver, args)),
    })
  })
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.start_world_input === 'function')
  await expect(page.evaluate(() => window.start_world_input())).rejects.toThrow('graphics_unavailable')
})

test('actual backend bounds request metadata and preserves device-loss bookkeeping', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.probe_engine_lifetime === 'function')
  const supported = await page.evaluate(async () => {
    const gpu = Reflect.get(navigator, 'gpu') as { requestAdapter: () => Promise<unknown> } | undefined
    return gpu !== undefined && (await gpu.requestAdapter()) !== null
  })
  test.skip(!supported, 'This browser has no WebGPU adapter')
  const result = await page.evaluate(() => window.probe_engine_lifetime())
  expect(result).toEqual({
    removed: true,
    retained: 0,
    previous: 'removed',
    recreated: 'rendered',
    bookkeeping: true,
    reported_loss: true,
  })
})

test('real world clears held movement immediately when editing takes focus', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.start_world_input === 'function')
  await page.evaluate(() => window.start_world_input())
  await page.locator('canvas').focus()
  await page.waitForFunction(() => window.read_world_pose() !== null)
  const initial = await page.evaluate(() => window.read_world_pose()!)
  await page.keyboard.down('KeyW')
  await page.waitForFunction((start) => {
    const pose = window.read_world_pose()
    return pose !== null && Math.hypot(pose.x - start.x, pose.z - start.z) > 1
  }, initial)
  await page.getByRole('textbox', { name: 'Friends' }).focus()
  // Allow existing physical deceleration and the throttled pose feed to settle, while W stays held.
  await page.waitForTimeout(400)
  const stopped = await page.evaluate(() => window.read_world_pose()!)
  await page.waitForTimeout(300)
  const later = await page.evaluate(() => window.read_world_pose()!)
  expect(Math.hypot(later.x - stopped.x, later.z - stopped.z)).toBeLessThan(0.01)
  await page.keyboard.up('KeyW')
  await page.evaluate(() => window.stop_world_input())
})
