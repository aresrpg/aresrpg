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

test('raised podium and compact rows fit the desktop modal without a visible table header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/e2e/fixtures/leaderboard.html')
  const entries = page.locator('.leaderboard-entries')
  await expect(entries.getByRole('row')).toHaveCount(100)
  await expect(page.locator('.leaderboard-category-toggle')).toBeHidden()
  const tab = await page.getByRole('tab', { name: 'Combat XP', exact: true }).boundingBox()
  expect(tab!.height).toBeLessThanOrEqual(28)
  const winner = (await page.locator('.leaderboard-podium[data-rank="1"]').boundingBox())!
  const silver = (await page.locator('.leaderboard-podium[data-rank="2"]').boundingBox())!
  expect(winner.y).toBeLessThan(silver.y)
  expect(winner.height).toBeGreaterThan(silver.height)
  const table = (await page.locator('.leaderboard-table').boundingBox())!
  const list = (await entries.boundingBox())!
  expect(list.y - table.y).toBeLessThanOrEqual(1)
  const rows = await entries
    .getByRole('row')
    .evaluateAll((elements) => elements.slice(0, 3).map((element) => element.getBoundingClientRect().toJSON()))
  expect(rows[0]!.x).toBe(rows[1]!.x)
  expect(rows[1]!.y).toBeGreaterThan(rows[0]!.y)
  expect(rows[0]!.height).toBeLessThanOrEqual(40)
  await page.screenshot({ path: test.info().outputPath('leaderboard-desktop.png') })
})

test.describe('mobile leaderboard categories', () => {
  test.use({ hasTouch: true })
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ])
    test(`dropdown saves space and stays inside the modal at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/e2e/fixtures/leaderboard.html')
      const modal = page.locator('.aui-rankings-port')
      const toggle = page.locator('.leaderboard-category-toggle')
      const menu = page.locator('.leaderboard-category-menu')
      await expect(page.locator('.leaderboard-entries > [role="row"]')).toHaveCount(100)
      await expect(page.getByRole('tablist', { name: 'Category' })).toBeHidden()
      await expect(toggle).toBeVisible()
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await toggle.tap()
      await expect(menu).toBeVisible()
      const frame = (await modal.boundingBox())!
      const popup = (await menu.boundingBox())!
      expect(frame.x).toBeGreaterThanOrEqual(0)
      expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height)
      expect(popup.x).toBeGreaterThanOrEqual(frame.x)
      expect(popup.y + popup.height).toBeLessThanOrEqual(frame.y + frame.height)
      expect(popup.x + popup.width).toBeLessThanOrEqual(frame.x + frame.width)
      await menu.getByRole('button', { name: 'Gathering', exact: true }).tap()
      await expect(menu).toBeHidden()
      await expect(toggle).toHaveAccessibleName('Category: Gathering')
      await toggle.tap()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(modal).toBeVisible()
      await toggle.tap()
      await menu.getByRole('button', { name: 'Combat XP', exact: true }).tap()
      const entries = page.locator('.leaderboard-entries')
      expect((await entries.boundingBox())!.height).toBeGreaterThan(80)
      await page.screenshot({ path: test.info().outputPath(`leaderboard-${viewport.width}.png`) })
      await entries.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const last = (await entries.getByRole('row').last().boundingBox())!
      const list = (await entries.boundingBox())!
      expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height + 1)
      expect(await modal.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect(
        await page.locator('.leaderboard-page').evaluate((element) => element.scrollHeight - element.clientHeight)
      ).toBeLessThanOrEqual(1)
    })
})

test('player inspection pages the roster, shows gear stats, and closes independently of the leaderboard', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/leaderboard.html')
  await page.locator('.leaderboard-entries .leaderboard-user-name button').first().click()
  const profile = page.getByRole('dialog', { name: 'Player profile', exact: true })
  await expect(profile).toBeVisible()
  await expect(profile.locator('.player-profile-roster h2')).toBeVisible()
  await expect(profile.locator('.player-profile-character')).toHaveCount(20)
  await profile.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(profile.locator('.player-profile-character')).toHaveCount(1)
  await expect(profile.locator('.player-profile-character')).toContainText('Profile Hero 21')
  await expect(profile.locator('.player-profile-jobs dl > div')).toHaveCount(11)
  await profile.locator('.player-profile-character').click()
  const weapon = profile.getByRole('button', { name: 'Equipped blade', exact: true })
  await expect(weapon).toBeVisible()
  await weapon.hover()
  await expect(profile.getByRole('tooltip')).toContainText('Vitality')
  await expect(profile.getByRole('tooltip')).toContainText('25')
  await page.screenshot({ path: test.info().outputPath('profile-desktop.png') })
  await page.keyboard.press('Escape')
  await expect(profile).toBeHidden()
  await expect(page.locator('.leaderboard-page')).toBeVisible()
})

test('inspection handles unavailable and transferred characters and fits a compact window', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 800 })
  await page.goto('/e2e/fixtures/leaderboard.html?inspection=error')
  await page.locator('.leaderboard-podium button').first().click()
  const profile = page.getByRole('dialog', { name: 'Player profile', exact: true })
  await expect(profile.getByRole('alert')).toContainText('Profile information is temporarily unavailable.')
  await expect(profile.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0)
  await page.goto('/e2e/fixtures/leaderboard.html?inspection=missing')
  await page.locator('.leaderboard-entries .leaderboard-user-name button').first().click()
  await profile.locator('.player-profile-character').first().click()
  await expect(profile.getByRole('status')).toContainText('no longer owned')
  await page.keyboard.press('Escape')
  await page.locator('.leaderboard-entries .leaderboard-user-name button').first().click()
  await expect(profile.getByText('Select a character to inspect their equipment.')).toBeVisible()
  const bounds = await profile.locator('.player-profile-window').boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(540)
  await page.screenshot({ path: test.info().outputPath('profile-compact.png') })
})

test.describe('touch player inspection', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } })
  test('touch profile retains compact equipment icons without expanding panels', async ({ page }) => {
    await page.goto('/e2e/fixtures/leaderboard.html')
    await page.locator('.leaderboard-entries .leaderboard-player-name').first().tap()
    const profile = page.getByRole('dialog', { name: 'Player profile', exact: true })
    await profile.locator('.player-profile-character').first().tap()
    const item = profile.getByRole('button', { name: 'Equipped blade', exact: true })
    await expect(item).toBeVisible()
    const bounds = await item.boundingBox()
    expect(bounds!.width).toBe(48)
    expect(bounds!.height).toBe(48)
    await expect(profile.locator('[data-inspected-item]')).toHaveCount(0)
    await expect(profile.getByRole('tooltip')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('profile-touch.png') })
  })
})
