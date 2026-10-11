// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import items from '../../../../seed/content/items.json' with { type: 'json' }
import { authored_character_model_classes } from '../../src/content/character_model_catalog.ts'
import { CHARACTER_HEIGHT } from '../../src/game/core/collision.ts'

const pets = items.filter(({ category }) => category === 'pet').map(({ item_type }) => item_type)

for (const classe of authored_character_model_classes) {
  test(`${classe}: both riding poses stay attached across the pet roster`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/e2e/fixtures/riding.html')
    await page.waitForFunction(() => window.riding_probe !== undefined)
    for (const pet of pets) {
      await page.evaluate(async ({ pet, classe }) => window.riding_probe.choose(pet, classe), { pet, classe })
      await expect
        .poll(async () => page.evaluate(() => window.riding_probe.snapshot().every(({ visible }) => visible)))
        .toBe(true)
      for (const moving of [false, true]) {
        await page.evaluate((moving) => window.riding_probe.moving(moving), moving)
        // Sample after the crossfade; contact must hold as the pet's own animation advances.
        await page.waitForTimeout(250)
        const snapshots = await page.evaluate(() => window.riding_probe.snapshot())
        for (const sample of snapshots) {
          expect(sample.visible, `${classe}/${pet}/${sample.sex}`).toBe(true)
          expect(sample.gap).not.toBeNull()
          expect(sample.gap!).toBeLessThan(0.00001)
          expect(sample.feet_y!).toBeGreaterThan(-0.02)
        }
      }
    }
    expect(errors).toEqual([])
  })
}

test('mounted movement, pet replacement and first-person dismount keep the real world camera on the rider', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/riding.html?world')
  await page.waitForFunction(() => window.riding_world_probe?.ready())
  const initial = await page.evaluate(() => window.riding_world_probe.snapshot())
  expect(initial.riding).toBe(true)
  await page.evaluate(() => window.riding_world_probe.move({ forward: 1, strafe: 0 }))
  await expect
    .poll(async () => page.evaluate(() => window.riding_world_probe.snapshot().camera!.fov), { timeout: 10_000 })
    .toBeGreaterThan(initial.camera!.fov + 2)
  await test.info().attach('mounted-speed', { body: await page.screenshot(), contentType: 'image/png' })
  await page.evaluate(() => window.riding_world_probe.move({ forward: 0, strafe: 0 }))
  const moved = await page.evaluate(() => window.riding_world_probe.snapshot())
  expect(moved.camera!.fov).toBeGreaterThan(initial.camera!.fov + 1)
  expect(moved.camera!.speed_wind!).toBeGreaterThan(0.1)
  expect(Math.hypot(moved.pose!.x - initial.pose!.x, moved.pose!.z - initial.pose!.z)).toBeGreaterThan(0.2)
  await page.evaluate(async () => window.riding_world_probe.set_pet('primemachin'))
  await page.waitForFunction(() => (window.riding_world_probe.snapshot().pet_height ?? 0) > 2)
  await page.evaluate(() => window.riding_world_probe.first_person())
  await page.waitForTimeout(600)
  const mounted = await page.evaluate(() => window.riding_world_probe.snapshot())
  expect(mounted.first_person).toBe(true)
  expect(mounted.camera!.position[1]).toBeGreaterThan(mounted.pose!.y + CHARACTER_HEIGHT * 0.9 + 0.2)
  await page.evaluate(() => window.riding_world_probe.ride(false))
  await page.waitForTimeout(600)
  const dismounted = await page.evaluate(() => window.riding_world_probe.snapshot())
  expect(dismounted.riding).toBe(false)
  expect(dismounted.camera!.position[1]).toBeCloseTo(dismounted.pose!.y + CHARACTER_HEIGHT * 0.9, 1)
  expect(errors).toEqual([])
})
