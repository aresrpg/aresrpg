// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('fight sword labels use the rendered label scene', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.probe_sword_labels === 'function')
  expect(await page.evaluate(() => window.probe_sword_labels())).toEqual({
    attached: true,
    moved: true,
    hidden: true,
    detached: true,
  })
})

test('labels do not update or traverse the game scene', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.probe_label_scene === 'function')
  expect(await page.evaluate(() => window.probe_label_scene())).toEqual({
    world_updates: 0,
    attached: true,
    moved: true,
    detached: true,
    world_children: 0,
  })
})

test('unavailable graphics reports initialization failure without waiting for a world pose', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined })
  })
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.start_world_input === 'function')
  await expect(page.evaluate(() => window.start_world_input())).rejects.toThrow('webgpu_unavailable')
})

test('actual backend bounds request metadata and preserves device-loss bookkeeping', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.probe_engine_lifetime === 'function')
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

for (const frame_interval of [0, 500])
  test(`real world clears held movement when editing takes focus (${frame_interval ? 'slow frames' : 'normal frames'})`, async ({
    page,
  }) => {
    if (frame_interval)
      await page.addInitScript((interval) => {
        window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), interval)
        window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
      }, frame_interval)
    await page.goto('/e2e/fixtures/engine_lifecycle.html')
    await page.waitForFunction(() => typeof window.start_world_input === 'function')
    await page.evaluate(() => window.start_world_input())
    try {
      await page.locator('canvas').focus()
      await page.waitForFunction(() => window.read_world_pose() !== null)
      const initial = await page.evaluate(() => window.read_world_pose()!)
      await page.keyboard.down('KeyW')
      await page.waitForFunction((start) => {
        const pose = window.read_world_pose()
        return pose !== null && Math.hypot(pose.x - start.x, pose.z - start.z) > 1
      }, initial)
      await page.getByRole('textbox', { name: 'Friends' }).focus()
      // Observe controller settling through fresh publications, never a wall-clock sleep or cached pose.
      await page.waitForFunction(() => window.read_world_motion().stable_samples >= 4, undefined, { timeout: 5_000 })
      const stopped = await page.evaluate(() => ({
        pose: window.read_world_pose()!,
        samples: window.read_world_motion().samples,
      }))
      await page.waitForFunction((since) => window.read_world_motion().samples >= since + 4, stopped.samples, {
        timeout: 5_000,
      })
      const later = await page.evaluate(() => ({ pose: window.read_world_pose()!, motion: window.read_world_motion() }))
      expect(later.motion.samples).toBeGreaterThan(stopped.samples)
      expect(Math.hypot(later.pose.x - stopped.pose.x, later.pose.z - stopped.pose.z)).toBeLessThan(0.01)
    } finally {
      await page.keyboard.up('KeyW')
      await page.evaluate(() => window.stop_world_input())
    }
  })

test('cached real models keep finite combat number and hover anchors', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  await page.waitForFunction(() => typeof window.probe_model_anchors === 'function')
  const result = await page.evaluate(() => window.probe_model_anchors())
  for (const row of result.rows) {
    expect(row.height).toBeGreaterThan(0)
    expect(row.anchor?.every(Number.isFinite)).toBe(true)
    expect(row.crown?.every(Number.isFinite)).toBe(true)
    expect(Math.abs(row.anchor![0]! - row.expected_x)).toBeLessThan(2)
    expect(Math.abs(row.crown![0]! - row.expected_x)).toBeLessThan(2)
    expect(row.label_visible).toBe(true)
    expect(row.label_transform).not.toContain('NaN')
  }
  for (const float of result.floats) {
    expect(float.played).toBe(true)
    expect(float.visible).toBe(true)
    expect(float.projected.every((value) => Math.abs(value) <= 1)).toBe(true)
  }
  expect(result.floats).toHaveLength(4)
})

for (const morph of [false, true])
  test(`crowd shaders preserve independent skinning, geometry and shadows (morph=${morph})`, async ({ page }, info) => {
    await page.goto('/e2e/fixtures/engine_lifecycle.html')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const result = await page.evaluate((morph) => window.probe_crowd(morph), morph)
    await info.attach('individual', {
      body: Buffer.from(result.reference_image.split(',')[1]!, 'base64'),
      contentType: 'image/png',
    })
    await info.attach('crowd', {
      body: Buffer.from(result.crowd_image.split(',')[1]!, 'base64'),
      contentType: 'image/png',
    })
    expect(result.batches).toBe(2)
    expect(result.mean_difference).toBeLessThan(0.3)
    expect(errors).toEqual([])
  })

test('run-to walks around a rendered voxel wall and arrives through the world lifecycle', async ({ page }) => {
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  const result = await page.evaluate(() => window.run_terrain_route())
  expect(result.reason).toBe('arrived')
  expect(result.detoured).toBe(true)
  expect(result.crossed_wall).toBe(false)
  expect(Math.hypot(result.x - 136.5, result.z - 128.5)).toBeLessThan(0.25)
})

test('run-to clips through a difficult wall and arrives through the world lifecycle', async ({ page }) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 200)
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
  })
  await page.goto('/e2e/fixtures/engine_lifecycle.html')
  const result = await page.evaluate(() => window.run_terrain_route(63))
  expect(result.reason).toBe('arrived')
  expect(result.crossed_wall).toBe(true)
  expect(result.detoured).toBe(false)
  expect(Math.hypot(result.x - 136.5, result.z - 128.5)).toBeLessThan(0.25)
})
