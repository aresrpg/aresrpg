// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The look of the Raid tab: two columns inside the main column, a key line sized to what it says,
// and the same treatment for a live run and a result. One capture per state and window.
import { expect, test, type Locator, type Page } from '@playwright/test'

import { BRAN, MIRA, bot_fixture } from '../fixtures/dapp_bot.ts'
import * as view from '../fixtures/dapp_view.ts'

const { bottom, box, right, shot, ready, seat, enter, in_room, tab, open_tab, KEY_NAME, WINDOWS } = view

const raid = (page: Page) => page.locator('.dapp-raid')
const split = (page: Page) => raid(page).locator('.dapp-raid-split')
const columns = (page: Page): readonly [Locator, Locator] => [
  split(page).locator('> :nth-child(1)'),
  split(page).locator('> :nth-child(2)'),
]
/** Two columns of about 45% and 55% that start level on a desktop; one column, left first, on a phone. */
const expect_columns = async (page: Page) => {
  const [left, side] = (await Promise.all(columns(page).map(box))) as [view.Box, view.Box]
  if (page.viewportSize()!.width < 960) return expect(side.y).toBeGreaterThanOrEqual(bottom(left))
  expect(Math.abs(left.y - side.y)).toBeLessThanOrEqual(1)
  expect(side.x).toBeGreaterThanOrEqual(right(left))
  const share = left.width / (left.width + side.width)
  expect(share).toBeGreaterThan(0.42)
  expect(share).toBeLessThan(0.48)
  // Nothing is left empty: the two columns take the whole main column.
  const main = await box(raid(page))
  expect(right(side)).toBeGreaterThanOrEqual(right(main) - 1)
}
/** Every sentence on screen had copy: a key without any would print itself. */
const expect_copy = (page: Page) =>
  expect(raid(page)).not.toContainText(/\b(raid|drops|fee|travel|position|run)_[a-z_]+/)

for (const { width, height } of WINDOWS) {
  test.describe(`the Raid tab at ${width}px`, () => {
    test.beforeEach(({ page }) => page.setViewportSize({ width, height }))

    test('a setup with keys and a team, its live run and its result keep two columns', async ({ page }) => {
      const bot = bot_fixture(2)
      await ready(page, bot)
      await open_tab(page, 'raid')
      await seat(page, 1, MIRA)
      await seat(page, 2, BRAN)
      await expect_columns(page)
      await expect_copy(page)
      // The key line is sized to what it says, never to its panel.
      const key = page.locator('.dapp-raid-key')
      await expect(key).toHaveAttribute('data-raid-keys', '2')
      await expect(key.locator('[data-item-row]')).toContainText(`${KEY_NAME}×2`)
      const [chip, panel] = [await box(key.locator('[data-item-row]')), await box(page.locator('[data-raid-dungeon]'))]
      expect(chip.width).toBeLessThan(panel.width - 40)
      await expect(key.locator('[data-raid-key-ways]')).toHaveCount(0)
      // The board is three seats by two.
      const seats = await Promise.all([1, 3, 4, 6].map((number) => box(page.locator(`[data-seat="${number}"]`))))
      expect(seats[0]!.y).toBe(seats[1]!.y)
      expect(seats[2]!.y).toBeGreaterThanOrEqual(bottom(seats[0]!))
      expect(seats[2]!.y).toBe(seats[3]!.y)
      // The side panel: the drops once, the ledger, the runs and the one Enter.
      const [, side] = columns(page)
      await expect(side.locator('[data-raid-drops] [data-item-row]')).toHaveCount(6)
      await expect(side.locator('.dapp-ledger dt')).toHaveText(['Keys used', 'Travel'])
      await expect(side.locator('.dapp-ledger dd').first()).toHaveText('2, one per hero')
      await expect(enter(page)).toBeEnabled()
      await shot(page, 'setup')

      await enter(page).click()
      await in_room(page, MIRA)
      await in_room(page, BRAN)
      await expect(page.locator('[data-raid-loot]')).toContainText('Wheat', { timeout: 15_000 })
      await expect_columns(page)
      await expect_copy(page)
      await expect(page.locator('[data-raid-drops]')).toHaveCount(1)
      await shot(page, 'run')
      // The run cards of a team take both columns under them, two to a row: no column is left empty.
      const cards = await Promise.all([MIRA, BRAN].map((id) => box(view.run(page, id))))
      const [first, second] = cards.toSorted((one, other) => one.x - other.x) as [view.Box, view.Box]
      if (width >= 960) {
        expect(first.y).toBe(second.y)
        expect(right(second)).toBeGreaterThanOrEqual(right(await box(raid(page))) - 1)
      }

      await page.getByRole('button', { name: 'Stop the team' }).click()
      await expect(page.locator('[data-raid-follow="result"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('[data-raid-follow="run"]')).toHaveCount(0)
      await expect_columns(page)
      await expect_copy(page)
      await expect(page.getByRole('button', { name: 'Change team' })).toBeVisible()
      await shot(page, 'result')
    })

    test('a lone hero keeps its run card under its raid block, and its loot beside it', async ({ page }) => {
      const bot = bot_fixture(1)
      await ready(page, bot)
      await open_tab(page, 'raid')
      await seat(page, 1, BRAN)
      await enter(page).click()
      await in_room(page, BRAN)
      await expect(page.locator('[data-raid-loot]')).toContainText('Wheat', { timeout: 15_000 })
      await expect_columns(page)
      const [left, side] = columns(page)
      await expect(left.locator(view.run(page, BRAN))).toBeVisible()
      await expect(side.locator('[data-raid-loot]')).toBeVisible()
      await expect(side.locator('[data-raid-drops]')).toBeVisible()
      await expect_copy(page)
      await shot(page, 'run-solo')
      await page.getByRole('button', { name: 'Stop the team' }).click()
      await expect(page.locator('[data-raid-follow="result"]')).toBeVisible({ timeout: 15_000 })
      await expect_columns(page)
      await shot(page, 'result-solo')
    })

    test('with no key, the key line itself leads to the market in one press', async ({ page }) => {
      const bot = bot_fixture()
      await ready(page, bot)
      await open_tab(page, 'raid')
      await expect_columns(page)
      const key = page.locator('.dapp-raid-key')
      await expect(key).toHaveAttribute('data-raid-keys', '0')
      const ways = key.locator('[data-raid-key-ways]')
      await expect(ways.locator('[data-market-link="listed"]')).toBeVisible()
      await expect(ways.getByRole('button', { name: 'Quest for keys' })).toBeVisible()
      // The hint of an empty team is a line of the team block, under its board.
      const [hint, seats, left] = [
        await box(page.locator('[data-raid-hint]')),
        await box(page.locator('.dapp-raid-board')),
        await box(columns(page)[0]),
      ]
      expect(hint.y).toBeGreaterThanOrEqual(bottom(seats))
      expect(right(hint)).toBeLessThanOrEqual(right(left) + 1)
      await expect(enter(page)).toBeDisabled()
      await shot(page, 'setup-no-key')
      // A seated team reads how many keys it lacks beside the plan; the ways to one stay on the key line.
      await seat(page, 1, MIRA)
      await expect(page.locator('[data-raid-short="1"]')).toBeVisible()
      await expect(page.locator('[data-raid-key-ways]')).toHaveCount(1)
      await expect(enter(page)).toHaveCount(0)
      await expect_copy(page)
      await shot(page, 'setup-no-key-team')
      await ways.locator('[data-market-link="listed"]').click()
      await expect(tab(page, 'market')).toHaveAttribute('aria-current', 'page')
      await page.getByRole('button', { name: 'I understand' }).click()
      const buy = page.locator('[data-marketplace-cheapest-lot="1"]').getByRole('button', { name: 'Buy' })
      await expect(buy).toBeEnabled({ timeout: 15_000 })
      await shot(page, 'no-key-market', false)
    })
  })
}
