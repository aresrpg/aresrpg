// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('explicit spectators see turn order and played turn portraits with an exit at bottom right', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/mobile_fight.html?spectator')
  await expect(page.locator('.fight-hud__turns')).toBeVisible()
  await expect(page.locator('.fight-hud__turn-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Play turn cue', exact: true }).click()
  await expect(page.locator('.fight-hud__turn-card img')).toBeVisible()
  await expect(page.locator('.aui-combat-spells')).toHaveCount(0)
  const exit = page.getByRole('button', { name: 'Stop spectating', exact: true })
  await expect(exit).toHaveClass(/aui-button/)
  const box = (await exit.boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(820)
  expect(box.y + box.height).toBeGreaterThan(366)
  expect(box.x + box.width).toBeLessThanOrEqual(844)
  expect(box.y + box.height).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath('spectator.png') })
})
