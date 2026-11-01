// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('professions follow the viewed character without changing a locked crafter or writing transactions', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/character_progression.html?craft_lock')
  const sheet = page.locator('.aui-character-sheet')
  const rail = page.locator('.aui-character-rail')
  await rail.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(rail.getByRole('button', { name: 'Jobs', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.locator('[data-skill]')).toHaveCount(11)
  await expect(sheet.locator('[data-skill="MINER"]')).toContainText('Lv 5')
  await expect(sheet.locator('[data-skill="FARMER"]')).toContainText('Lv 1')
  await page.getByRole('button', { name: 'View crafter', exact: true }).click()
  await expect(sheet.locator('[data-skill="MINER"]')).toContainText('Lv 90')
  await page.getByRole('button', { name: 'View Nox', exact: true }).click()
  await expect(sheet.locator('[data-skill="MINER"]')).toContainText('Lv 5')
  await expect(page.locator('[data-craft-lock]')).toHaveText('0xcrafter')
  await expect(page.locator('[data-calls]')).toHaveText('0')
  await expect(sheet.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
})

test('switching to professions preserves an unsubmitted characteristic allocation', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_progression.html')
  const sheet = page.locator('.aui-character-sheet')
  const rail = page.locator('.aui-character-rail')
  await expect(rail.locator('small')).toHaveText('12')
  await sheet.getByRole('button', { name: 'Add a point to Strength', exact: true }).click()
  await rail.getByRole('button', { name: 'Jobs', exact: true }).click()
  await rail.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(sheet.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  await sheet.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('[data-calls]')).toHaveText('1')
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 667, height: 375 },
]) {
  test(`compact profession view stays usable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/demo#ui')
    await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Stats', exact: true }).click()
    const sheet = page.locator('.aui-character-sheet')
    const window_box = await page.locator('.game-character-window--stats').boundingBox()
    await page.locator('.aui-character-rail').getByRole('button', { name: 'Jobs', exact: true }).click()
    expect(await page.locator('.game-character-window--stats').boundingBox()).toEqual(window_box)
    await expect(sheet.locator('[data-skill]')).toHaveCount(11)
    await sheet.locator('[data-skill="BAKER"]').scrollIntoViewIfNeeded()
    await expect(sheet.locator('[data-skill="BAKER"]')).toBeInViewport()
    expect(
      await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('professions.png') })
  })
}
