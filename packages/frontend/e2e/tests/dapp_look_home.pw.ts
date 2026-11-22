// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The look of the Home tab, its page frame, the side feed and the toast of a find: one capture per
// state and window, and the measures that say the frame is the approved one.
import { expect, test, type Page } from '@playwright/test'

import * as fake from '../fixtures/dapp_bot.ts'
import * as view from '../fixtures/dapp_view.ts'

const { MIRA, BRAN, KEY, HOOD, bot_fixture, item } = fake
const { bottom, box, right, hero, ready, board, shot, painted, expect_frame, WINDOWS } = view

const SUI = 1_000_000_000n
const FEED = 300

/** A toast slides in: it is captured once every animation that ends has ended. */
const settled = (page: Page) =>
  page.evaluate(async () => {
    const ending = document
      .getAnimations()
      .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
    await Promise.all(ending.map((animation) => animation.finished))
  })
const toasts = (page: Page) => page.locator('[data-toasts]')
const feed_rows = (page: Page) => page.locator('.dapp-bag-feed li')

for (const { width, height, phone } of WINDOWS) {
  test(`Home with free heroes is the approved frame and board at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const bot = bot_fixture(1)
    bot.balance = 12n * SUI
    await ready(page, bot)
    await expect(page.getByRole('heading', { level: 1, name: 'What to do now' })).toBeVisible()
    // One centred column holds the bar and the board, and the five tabs stand inside the bar.
    await expect_frame(page)
    const [feed, next] = [await box(page.locator('.dapp-bag-feed-panel')), await box(page.locator('.dapp-next'))]
    const action = await box(page.locator('.dapp-next').getByRole('button'))
    const text = await box(page.locator('.dapp-next-text'))
    // The action of the next step stands under its sentence, at the left, sized to its label.
    expect(action.y).toBeGreaterThanOrEqual(bottom(text))
    expect(action.x - next.x).toBeLessThanOrEqual(24)
    expect(action.width).toBeLessThanOrEqual(260)
    const [mira, bran] = [await box(hero(page, MIRA)), await box(hero(page, BRAN))]
    if (!phone) {
      // The feed is the secondary column, at the right of the board.
      expect(Math.round(feed.width)).toBe(FEED)
      expect(feed.x).toBeGreaterThanOrEqual(right(next))
      // Two hero cards share a row.
      expect(mira.y).toBe(bran.y)
      expect(bran.x).toBeGreaterThanOrEqual(right(mira))
    } else {
      // On a phone the feed is a strip above the board, and the cards stack.
      expect(bottom(feed)).toBeLessThanOrEqual(next.y)
      expect(bran.y).toBeGreaterThanOrEqual(bottom(mira))
    }
    // The fee line is a label and its value, not a sentence.
    await expect(page.locator('[data-wallet-fees] dt')).toHaveText('Network fees your bot paid')
    await expect(page.locator('[data-wallet-fees] dd')).toHaveText('0.000 SUI')
    await shot(page, 'home')
    // Scrolled to its end in a short window, the bar stays at the top and the side column under it.
    if (phone) return
    await page.setViewportSize({ width, height: 480 })
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await painted(page)
    const [bar, side] = [await box(page.locator('.light-page-header')), await box(page.locator('.dapp-bag-feed-panel'))]
    expect(bar.y).toBeGreaterThanOrEqual(0)
    expect(side.y).toBeGreaterThanOrEqual(bottom(bar))
    await shot(page, 'home-scrolled', false)
  })

  test(`an account with no hero shows its first steps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const bot = bot_fixture()
    bot.heroes = []
    await board(page, bot)
    await expect(page.getByRole('heading', { name: 'Welcome to Expeditions' })).toBeVisible()
    await expect(page.locator('.dapp-step')).toHaveCount(3)
    await shot(page, 'home-empty')
  })

  test(`a find is one toast "+n item", and a row of the feed, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    // Both heroes are out when the page opens: the bot reports their runs, and Home can stop each.
    const bot = bot_fixture()
    for (const id of [MIRA, BRAN]) bot.runs.set(id, { strategy: 'fight_nearby' })
    await board(page, bot)
    await expect(hero(page, MIRA)).toHaveAttribute('data-status', 'activity', { timeout: 45_000 })
    await expect(page.locator('.dapp-next')).toHaveAttribute('data-next', 'out')
    // The bag the page first sees is its baseline: it tells nothing.
    await expect(toasts(page)).toHaveCount(0)
    // Five kinds arrive in one change of the bag: one toast names three and counts the others.
    bot.bag = [...bot.bag, item('water', 2), item('wheat_flour', 1), item(KEY, 1)]
    bot.bag = bot.bag.map((row) => (row.item_type === HOOD ? { ...row, amount: row.amount + 1 } : row))
    await hero(page, BRAN).getByRole('button', { name: 'Stop' }).click()
    await expect(toasts(page)).toContainText('+2 more', { timeout: 15_000 })
    await expect(toasts(page)).not.toContainText('New in your bag')
    await expect(toasts(page).locator('> div')).toHaveCount(1)
    if (phone)
      expect(bottom(await box(toasts(page)))).toBeLessThanOrEqual((await box(page.locator('.dapp-tabs:visible'))).y)
    await settled(page)
    await shot(page, 'home-toast-many', false)
    // The feed holds one row per kind: its picture, "+n" and its name.
    await expect(feed_rows(page)).toHaveCount(5)
    await expect(feed_rows(page).filter({ hasText: 'Water' })).toContainText('+2')
    await expect(feed_rows(page).first().locator('img')).toHaveCount(1)
    await expect(toasts(page)).toHaveCount(0, { timeout: 15_000 })
    await expect(hero(page, MIRA)).toHaveAttribute('data-status', 'activity')
    await shot(page, 'home-out')
    // One kind is the plain toast: "+3 Wheat" beside the picture of the item.
    bot.bag = bot.bag.map((row) => (row.item_type === 'wheat' ? { ...row, amount: row.amount + 3 } : row))
    await hero(page, MIRA).getByRole('button', { name: 'Stop' }).click()
    const told = toasts(page).locator('> div')
    await expect(told).toHaveText(/^\+3 Wheat/, { timeout: 15_000 })
    await expect(told.locator('img')).toHaveCount(1)
    await settled(page)
    await shot(page, 'home-toast', false)
    // A row of the feed opens the sheet of its item.
    await expect(toasts(page)).toHaveCount(0, { timeout: 15_000 })
    await feed_rows(page).filter({ hasText: 'Wheat Flour' }).getByRole('button').click()
    await expect(page.getByRole('dialog', { name: 'Wheat Flour' })).toBeVisible()
  })
}

test('the tokenomics page, whose panel the owner named as the model of the backdrop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await view.local_only(page)
  await page.goto('/kares#tokenomics')
  await expect(page.locator('.light-page-panel')).toBeVisible({ timeout: 60_000 })
  await shot(page, 'kares-tokenomics', false)
})
