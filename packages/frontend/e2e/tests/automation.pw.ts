// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

const unlock = async (page: Page): Promise<void> => {
  for (const key of [
    'ArrowUp',
    'ArrowUp',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowLeft',
    'ArrowRight',
    'b',
    'a',
  ])
    await page.keyboard.press(key)
}

test('Konami reveals gathering below Friends, shakes the world, and fades HACK ZONE', async ({ page }) => {
  await page.goto('/e2e/fixtures/automation.html')
  await expect(page.locator('[data-friends-card]')).toBeVisible()
  await expect(page.locator('[data-automation-panel]')).toHaveCount(0)
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  await expect(panel).toBeVisible()
  await expect(page.getByText('HACK ZONE', { exact: true })).toBeVisible()
  expect(
    await page.locator('[data-world-frame]').evaluate((element) => element.getAnimations().length)
  ).toBeGreaterThan(0)
  const friends = await page.locator('[data-friends-card]').boundingBox()
  const automation = await panel.boundingBox()
  expect(automation!.y).toBeGreaterThan(friends!.y + friends!.height)
  await page.screenshot({ path: 'test-results/hack-zone-unlock.png' })
  await expect(page.locator('[data-hack-zone]')).toHaveCount(0, { timeout: 5_000 })
  await expect(panel).toBeVisible()
  await unlock(page)
  await expect(page.locator('[data-hack-zone]')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/automation-hud.png' })
})

test('typing does not unlock; reduced motion removes shake; manual movement stops a run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/fixtures/automation.html')
  const chat = page.getByRole('textbox', { name: 'Chat' })
  await chat.focus()
  await unlock(page)
  await expect(page.locator('[data-automation-panel]')).toHaveCount(0)
  await chat.blur()
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  await expect(panel).toBeVisible()
  expect(await page.locator('[data-world-frame]').evaluate((element) => element.getAnimations().length)).toBe(0)
  await expect(panel.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  const option = panel.locator('option:not([disabled])').nth(1)
  await panel.getByRole('combobox').selectOption((await option.getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Stop', exact: true }).blur()
  await page.keyboard.press('w')
  await expect(panel.getByText('Stopped', { exact: true })).toBeVisible()
})

test('switching app pages and browser focus preserves the run and keeps Stop available', async ({ page }) => {
  await page.goto('/e2e/fixtures/automation.html')
  await expect(page.locator('[data-friends-card]')).toBeVisible()
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  const option = panel.locator('option:not([disabled])').nth(1)
  await panel.getByRole('combobox').selectOption((await option.getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  expect(await panel.evaluate((element) => element.closest('[data-world-frame]') === null)).toBe(true)
  const other = await page.context().newPage()
  await other.goto('about:blank')
  await other.bringToFront()
  await other.close()
  await page.bringToFront()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'World', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(panel.getByText('Stopped', { exact: true })).toBeVisible()
})

test('reselecting a character preserves automation; switching characters stops it', async ({ page }) => {
  await page.goto('/e2e/fixtures/automation.html')
  await expect(page.locator('[data-friends-card]')).toBeVisible()
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  const option = panel.locator('option:not([disabled])').nth(1)
  await panel.getByRole('combobox').selectOption((await option.getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('button', { name: 'Alice', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Bob', exact: true }).click()
  await expect(panel.getByText('Stopped', { exact: true })).toBeVisible()
})
