// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('retains the podium, shows 100 entries and a personal rank, and changes categories', async ({ page }) => {
  await page.goto('/e2e/fixtures/leaderboard.html')
  await expect(page.getByRole('tab')).toHaveCount(9)
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(101)
  await expect(page.locator('.leaderboard-podium')).toHaveCount(3)
  await expect
    .poll(() =>
      page
        .locator('.leaderboard-medal')
        .evaluateAll((icons) =>
          icons.every((icon) => icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth === 128)
        )
    )
    .toBe(true)
  await expect(page.locator('.leaderboard-podium').nth(0)).toContainText('#2')
  await expect(page.locator('.leaderboard-podium').nth(1)).toContainText('#1')
  await expect(page.locator('.leaderboard-row-self')).toContainText('501')
  await page.getByRole('tab', { name: 'Mob kills', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Mob kills', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Reset in 22 days', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Previous|Next|Current season/ })).toHaveCount(0)
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
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(101)
  await expect(page.getByRole('row').last()).toContainText('100')
  await expect(page.getByText(/Season|Epochs|No activity this season/)).toHaveCount(0)
  await expect(page.locator('.leaderboard-podium')).toHaveCount(3)
  await expect(page.locator('.leaderboard-podium').getByText('Unclaimed', { exact: true })).toHaveCount(3)
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

test('a single unnamed player retains the Monument podium and shared app surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/e2e/fixtures/leaderboard.html?state=single')
  await expect(page.locator('.leaderboard-podium')).toHaveCount(3)
  await expect(page.locator('.leaderboard-podium[data-rank="1"]')).toContainText('0x0000…0001')
  await expect(page.locator('.leaderboard-podium').getByText('Unclaimed', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(101)
  await expect(page.locator('.leaderboard-step').first()).toHaveCSS('background-color', 'rgb(18, 18, 26)')
  await expect(page.getByRole('columnheader')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const podium = await page
    .locator('.leaderboard-step')
    .evaluateAll((steps) => steps.map((step) => step.getBoundingClientRect().height))
  expect(podium[1]).toBeGreaterThan(podium[0]!)
  expect(podium[0]).toBeGreaterThan(podium[2]!)
  await page.screenshot({ path: 'test-results/leaderboards-monument-single.png' })
})
