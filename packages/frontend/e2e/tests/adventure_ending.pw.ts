// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/adventure_ending.tsx'

for (const victory of [false, true]) {
  test(`boss ${victory ? 'victory plays the fatal cinematic' : 'defeat'} logs in directly from rebirth`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(`/e2e/fixtures/adventure_ending.html${victory ? '?victory' : ''}`)
    await page.waitForFunction(() => window.ending_probe.snapshot().yaw !== null)
    expect(await page.evaluate(() => window.ending_probe.snapshot().ready)).toBe(false)
    await page.evaluate(() => window.ending_probe.finish())
    const modal = page.getByRole('dialog', { name: 'You died of your wounds…', exact: true })
    // Scene loading plus the complete cinematic use the test budget, not a five-second UI assertion budget.
    await modal.waitFor({ state: 'visible', timeout: 60_000 })
    if (victory) {
      const frames = await page.evaluate(() => window.ending_probe.frames())
      expect([...new Set(frames.map(({ stage }) => stage))]).toEqual(['orbit', 'poison', 'dying'])
      expect(frames.every(({ ready, rebirth }) => !ready && !rebirth)).toBe(true)
      const orbit = frames.filter(({ stage }) => stage === 'orbit')
      expect(orbit[0]!.yaw).not.toBeNull()
      expect(orbit.at(-1)!.yaw).not.toBe(orbit[0]!.yaw)
    }
    await modal.locator('article').evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished))
    })
    await page.setViewportSize({ width: 667, height: 300 })
    const login = modal.getByRole('button', { name: 'Continue with Google', exact: true })
    await expect(login).toBeInViewport({ ratio: 1 })
    await expect(login).toBeEnabled()
    await expect(modal.locator('a')).toHaveCount(0)
    await login.click()
    await expect.poll(() => page.evaluate(() => window.ending_probe.snapshot().auth)).toBe('google')
    await page.evaluate(() => window.ending_probe.fail_login())
    await expect(modal.getByRole('alert')).toBeVisible()
    await expect(login).toBeEnabled()
    await login.click()
    await page.evaluate(() => window.ending_probe.accept_login())
    await expect(modal).toHaveCount(0)
    await expect(page.locator('.adventure-ending')).toHaveCount(0)
    await expect(page.locator('[data-player-login], .main-menu')).toHaveCount(0)
    await expect(page.locator('[data-world-frame]')).toBeAttached()
    await expect.poll(() => page.evaluate(() => window.ending_probe.snapshot().phase)).toBe('entered')
    await expect(page).toHaveURL(/\/$/)
    expect(errors).toEqual([])
  })
}
