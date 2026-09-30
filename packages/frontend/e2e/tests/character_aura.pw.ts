// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('Unbroken uses the same live effect in crowds and fight motion and clears on unequip', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/character_aura.html')
  await expect.poll(() => page.evaluate(() => window.aura_probe?.snapshot().auras)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBe(0)
  expect((await page.evaluate(() => window.aura_probe.snapshot())).aura_height).toBeCloseTo(2)
  await page.evaluate(() => window.aura_probe.moving(true))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBeGreaterThan(0)
  await page.evaluate(() => window.aura_probe.moving(false))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBe(0)
  await page.evaluate(() => window.aura_probe.crowd(true))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().crowd.instances)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().auras)).toBe(1)
  await page.evaluate(() => window.aura_probe.equip(false))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().auras)).toBe(0)
  await page.evaluate(() => {
    window.aura_probe.equip(true)
    window.aura_probe.fight()
  })
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().auras)).toBe(1)
  expect((await page.evaluate(() => window.aura_probe.snapshot())).aura_height).toBeCloseTo(1.4)
  await page.evaluate(() => window.aura_probe.walk_fight())
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBeGreaterThan(0)
  await page.evaluate(() => window.aura_probe.visible(false))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().auras)).toBe(0)
  expect(errors).toEqual([])
})

test('the client admin profile renders red/purple haze without an equipped title', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/character_aura.html')
  await expect.poll(() => page.evaluate(() => window.aura_probe?.snapshot().auras)).toBe(1)
  await page.evaluate(() => {
    window.aura_probe.equip(false)
    window.aura_probe.admin(true)
    window.aura_probe.moving(true)
  })
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().haze)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBeGreaterThan(0)
  await page.evaluate(() => window.aura_probe.moving(false))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().particles)).toBe(0)
  await page.evaluate(() => window.aura_probe.admin(false))
  await expect.poll(() => page.evaluate(() => window.aura_probe.snapshot().auras)).toBe(0)
  expect(await page.evaluate(() => window.aura_probe.snapshot().haze)).toBe(0)
  expect(errors).toEqual([])
})
