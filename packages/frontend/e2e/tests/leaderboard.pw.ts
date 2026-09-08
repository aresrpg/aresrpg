// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('retains the podium, shows 100 entries and a personal rank, and changes seasons', async ({ page }) => {
  await page.goto('/e2e/fixtures/leaderboard.html')
  await expect(page.getByRole('tab')).toHaveCount(9)
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(101)
  await expect(page.locator('.leaderboard-podium')).toHaveCount(3)
  await expect(page.locator('.leaderboard-podium').nth(0)).toContainText('#2')
  await expect(page.locator('.leaderboard-podium').nth(1)).toContainText('#1')
  await expect(page.locator('.leaderboard-row-self')).toContainText('501')
  await page.getByRole('tab', { name: 'Mob kills', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Mob kills', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('Season 7', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Current season', exact: true }).click()
  await expect(page.getByText('Season 8', { exact: true })).toBeVisible()
  await expect(page.locator('.leaderboard-podium').nth(2)).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/leaderboards-desktop.png' })
})

test('mobile contains long exact scores and hundreds of character badges without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/fixtures/leaderboard.html')
  await expect(page.locator('.leaderboard-podium')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByText('+494', { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Marketplace', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('.leaderboard-podium').nth(2)).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/leaderboards-mobile.png' })
})

test('empty and failed reads remain explicit', async ({ page }) => {
  await page.goto('/e2e/fixtures/leaderboard.html?state=empty')
  await expect(page.getByText('No activity this season.', { exact: true })).toBeVisible()
  await expect(page.locator('.leaderboard-podium')).toHaveCount(0)
  await page.goto('/e2e/fixtures/leaderboard.html?state=error')
  await expect(page.getByRole('alert')).toContainText('Rankings are temporarily unavailable.')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
})

test('all six locales render category and profession labels', async ({ page }) => {
  const locales = [
    ['en', 'Job XP', 'Farmer'],
    ['fr', 'XP métiers', 'Paysan'],
    ['de', 'Berufs-EP', 'Bauer'],
    ['es', 'XP de oficios', 'Granjero'],
    ['uk', 'Досвід професій', 'Фермер'],
    ['ja', '職業経験値', '農夫'],
  ] as const
  for (const [locale, category, profession] of locales) {
    await page.goto(`/e2e/fixtures/leaderboard.html?locale=${locale}`)
    await expect(page.getByRole('tab')).toHaveCount(9)
    await page.getByRole('tab', { name: category, exact: true }).click()
    await expect(page.getByText(profession, { exact: true }).first()).toBeVisible()
  }
})
