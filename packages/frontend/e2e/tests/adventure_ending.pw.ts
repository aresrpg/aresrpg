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
    if (victory) {
      const ending = page.locator('[data-adventure-ending]')
      await expect(ending).toHaveAttribute('data-stage', 'orbit')
      await expect(modal).toHaveCount(0)
      const yaw = await page.evaluate(() => window.ending_probe.snapshot().yaw)
      await expect.poll(() => page.evaluate(() => window.ending_probe.snapshot().yaw)).not.toBe(yaw)
      await expect(ending).toHaveAttribute('data-stage', 'poison')
      expect(await page.evaluate(() => window.ending_probe.snapshot().ready)).toBe(false)
      await expect(modal).toHaveCount(0)
      await expect(ending).toHaveAttribute('data-stage', 'dying')
      await expect(modal).toHaveCount(0)
    }
    await expect(modal).toBeVisible()
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
