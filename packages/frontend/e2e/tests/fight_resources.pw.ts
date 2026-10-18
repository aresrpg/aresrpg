// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('the first fight waits for actor appearances before accepting a spell', async ({ page }) => {
  let release: () => void = () => {}
  let requested: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = new Promise<void>((resolve) => {
    requested = resolve
  })
  await page.route(/\/assets\/yajin_male-[^/]+\.js$/, async (route) => {
    requested()
    await held
    await route.continue()
  })
  await page.goto('/e2e/fixtures/fight_spells.html?quality=low')
  await page.waitForFunction(() => Reflect.has(window, 'demo_spell_probe'))
  await expect(page.locator('[data-world-loading]:visible')).toHaveCount(0, { timeout: 60000 })
  const opening = page.evaluate(() => Reflect.get(window, 'demo_spell_probe').open('yajin'))
  try {
    await request
    const spell = page.getByRole('button', { name: /^Deviousness/ })
    await expect(spell).toBeVisible()
    // Keep the URL unavailable beyond the ordinary opening cue; loading must own the lock.
    await page.waitForTimeout(1500)
    await expect(spell).toBeDisabled()
  } finally {
    release()
    await opening
  }
  await expect(page.getByRole('button', { name: /^Deviousness/ })).toBeEnabled()
})
