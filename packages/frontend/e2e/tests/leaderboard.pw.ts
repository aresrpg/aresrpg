// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

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

test('badges fill one row and recalculate overflow when the available width changes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/e2e/fixtures/leaderboard.html')
  const characters = page.locator('[data-badge-row]').first().locator(':scope > span:not([data-badge-overflow])')
  await expect.poll(() => characters.count()).toBeGreaterThan(0)
  await page.getByRole('tab', { name: 'Job XP', exact: true }).click()
  const row = page.locator('[data-badge-row]').first()
  const badges = row.locator(':scope > span:not([data-badge-overflow])')
  await expect.poll(() => badges.count()).toBeGreaterThan(0)
  const wide_count = await badges.count()
  await page.setViewportSize({ width: 700, height: 900 })
  await expect(async () => {
    const count = await badges.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(11)
    await expect(row.locator('[data-badge-overflow]')).toHaveText(`+${11 - count}`)
    const boxes = await row
      .locator(':scope > span')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
    expect(Math.max(...boxes.map(({ y }) => y)) - Math.min(...boxes.map(({ y }) => y))).toBeLessThan(4)
    const container = (await row.boundingBox())!
    expect(boxes.at(-1)!.right).toBeLessThanOrEqual(container.x + container.width)
    const next = await row
      .locator('[data-badge]')
      .nth(count)
      .evaluate((element) => element.getBoundingClientRect().width)
    const counter = await row
      .locator('[data-count]')
      .nth(count + 1)
      .evaluate((element) => element.getBoundingClientRect().width)
    expect(boxes[count - 1]!.right + 4 + next + 4 + counter).toBeGreaterThan(container.x + container.width)
  }).toPass()
  await page.setViewportSize({ width: 1920, height: 900 })
  await expect(badges).toHaveCount(wide_count)
})
