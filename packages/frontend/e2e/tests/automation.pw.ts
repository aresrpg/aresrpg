// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

const unlock = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Finish quests', exact: true }).click()
}

test('completing the journey reveals collapsible gathering controls; reset revokes access', async ({ page }) => {
  await page.goto('/e2e/fixtures/automation.html')
  await expect(page.locator('[data-automation-panel]')).toHaveCount(0)
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Collapse gathering automation' }).click()
  await expect(panel.getByRole('combobox')).toBeHidden()
  await panel.getByRole('button', { name: 'Expand gathering automation' }).click()
  await expect(panel.getByRole('combobox')).toBeVisible()
  await page.getByRole('button', { name: 'Reset quests', exact: true }).click()
  await expect(panel).toHaveCount(0)
})

test('collapse preserves a run and its Stop control; manual movement stops it', async ({ page }) => {
  await page.goto('/e2e/fixtures/automation.html')
  await unlock(page)
  const panel = page.locator('[data-automation-panel]')
  await expect(panel.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  const option = panel.locator('option:not([disabled])').nth(1)
  await panel.getByRole('combobox').selectOption((await option.getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Start', exact: true }).click()
  await panel.getByRole('button', { name: 'Collapse gathering automation' }).click()
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  const chat = page.getByRole('textbox', { name: 'Chat' })
  await chat.fill('w')
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await chat.blur()
  await page.keyboard.press('w')
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Expand gathering automation' }).click()
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
