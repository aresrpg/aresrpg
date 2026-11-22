// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The look of the dapp's Heroes and Market tabs: one capture per state and width, and the facts of the
// layout a capture cannot assert. The game's own market window is captured beside them for comparison.
import { expect, test, type Locator } from '@playwright/test'

import { HOOD, KEY, MIRA, OFFER, bot_fixture, directs_of } from '../fixtures/dapp_bot.ts'
import * as view from '../fixtures/dapp_view.ts'

const { KEY_NAME, WINDOWS, box, direct, ready, right, segment, open_tab, painted, pick_key, shot, shot_file } = view
const TABS = [
  { panel: 'equipment', label: 'Equipment' },
  { panel: 'stats', label: 'Stats' },
  { panel: 'spells', label: 'Spells' },
  { panel: 'jobs', label: 'Jobs' },
] as const
/** How far an element's content is wider than its own box: above zero it scrolls sideways. */
const sideways = (target: Locator) => target.evaluate((node) => node.scrollWidth - node.clientWidth)
const style = (target: Locator, property: string) =>
  target.first().evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property)

/** A second public offer beside the fixture's one-unit lot: a lot of ten. */
const LOT_OF_TEN = { ...OFFER, id: `0x${'6'.repeat(64)}`, amount: 10, price_mist: '4000000000', group_key: 'lot-10' }

for (const { width, height, phone } of WINDOWS) {
  test(`Heroes is one window with four tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await ready(page, bot_fixture())
    await open_tab(page, 'heroes')
    const heroes = page.locator('.dapp-heroes-tab')
    const window = heroes.locator('.dapp-heroes-window')
    await expect(window).toHaveCount(1)
    // The summary names the hero and counts its unspent points; the picker stands above it.
    const card = heroes.locator(`.dapp-hero-card[data-hero="${MIRA}"]`)
    await expect(card).toContainText('Mira')
    await expect(card.locator('[data-heroes-points="stats"]')).toContainText('Stat points')
    expect((await box(heroes.locator('.dapp-hero-picker'))).y).toBeLessThan((await box(card)).y)
    expect((await box(card)).y).toBeLessThan((await box(window)).y)
    const size = async () => (({ width, height }) => ({ width, height }))(await box(window))
    const frame = await size()
    for (const { panel, label } of TABS) {
      await segment(page, 'Mira', label).click()
      await expect(heroes.locator('[data-character-panel]')).toHaveCount(1)
      await expect(window).toHaveAttribute('data-character-panel', panel)
      await expect(segment(page, 'Mira', label)).toHaveAttribute('aria-pressed', 'true')
      // The game's tab is drawn, not its loading line.
      await expect(window.locator('.game-character-body > .dapp-note')).toHaveCount(0)
      await painted(page)
      // One frame for the four tabs: the page does not jump when the tab changes.
      expect(await size()).toEqual(frame)
      expect(right(await box(window))).toBeLessThanOrEqual(width)
      // On a desktop no tab scrolls sideways inside the window; a phone keeps the game's own inner scroll.
      if (!phone) expect(await sideways(window.locator('.game-character-body'))).toBeLessThanOrEqual(0)
      await shot(page, `heroes-${panel}`, panel === 'equipment')
      await window.scrollIntoViewIfNeeded()
      await shot(page, `heroes-${panel}-window`, false)
    }
    // An unspent count opens the tab that spends it.
    await segment(page, 'Mira', 'Equipment').click()
    await card.locator('[data-heroes-points="spells"]').click()
    await expect(window).toHaveAttribute('data-character-panel', 'spells')
    // The tab stays when the hero changes.
    await heroes.locator('.dapp-hero-picker [data-hero]').nth(1).click()
    await expect(window).toHaveAttribute('data-character-panel', 'spells')
  })

  test(`the Market is the game's market window, with offers and a Buy, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const bot = bot_fixture()
    bot.offers = [OFFER, LOT_OF_TEN]
    await ready(page, bot)
    await open_tab(page, 'market')
    await page.getByRole('button', { name: 'I understand' }).click()
    const market = page.locator('.dapp-market')
    const frame = market.locator('.aui-window.aui-feature-port.aui-market-port')
    await expect(frame).toHaveCount(1)
    // The market spans the board: no side column on this tab.
    await expect(page.locator('.dapp-bag-feed-panel')).toHaveCount(0)
    expect(right(await box(frame))).toBeLessThanOrEqual(width)
    // The port's own rules reach the market: a category is the game's flat 38px row, not a default button.
    const group = market.locator('[data-marketplace-general-categories] .market-filter[aria-pressed="false"]')
    await expect(group.first()).toBeVisible()
    if (!phone) {
      expect(await style(group, 'min-height')).toBe('38px')
      expect(await style(group, 'box-shadow')).toBe('none')
      // The game's side-by-side form: three rails of the port's widths, then the item.
      expect(await style(market.locator('.market-browse'), 'display')).toBe('flex')
      expect((await box(market.locator('.market-groups'))).width).toBe(150)
      expect((await box(market.locator('.market-subcategories'))).width).toBe(150)
      expect((await box(market.locator('.market-templates'))).width).toBe(210)
      // The window fits the screen: its panels scroll inside it, as in the game.
      expect((await box(frame)).y + (await box(frame)).height).toBeLessThanOrEqual(height)
    } else {
      // The market's own narrow form: a rail takes the row, and a category is a 44px touch target.
      expect((await box(market.locator('.market-groups'))).width).toBeGreaterThan(300)
      expect((await box(group)).height).toBeGreaterThanOrEqual(44)
    }
    await shot(page, 'market-buy-empty', false)
    // Offers load for the item on screen only: pick the key.
    await pick_key(market)
    const unit = market.locator('[data-marketplace-cheapest-lot="1"]')
    const ten = market.locator('[data-marketplace-cheapest-lot="10"]')
    await expect(unit).toContainText('0.55')
    await expect(ten).toContainText('4.40')
    const buy = unit.getByRole('button', { name: 'Buy', exact: true })
    await expect(buy).toBeEnabled()
    await buy.scrollIntoViewIfNeeded()
    await expect(buy).toBeInViewport({ ratio: 1 })
    await shot(page, 'market-buy')
    await segment(page, 'Marketplace', 'Sell').click()
    await expect(market.locator(`[data-marketplace-owned-item="${HOOD}-1"]`)).toBeVisible()
    await expect(market.getByRole('button', { name: /collect/i })).toHaveCount(0)
    await shot(page, 'market-sell')
    // Buy is one request of the bot account, for the offer on screen.
    await segment(page, 'Marketplace', 'Buy').click()
    await expect(buy).toBeEnabled()
    await buy.dblclick()
    await expect(direct(page)).toHaveText(new RegExp(`Bought: 1 × ${KEY_NAME}`))
    expect(directs_of(bot, 'market_buy')).toHaveLength(1)
    expect(directs_of(bot, 'market_buy')[0]!.action).toMatchObject({ item_type: KEY, amount: 1 })
  })
}

test('the game’s own market window, for comparison: the workshop’s populated window at the game’s 1280px size', async ({
  page,
}) => {
  // At 1280x800 the game gives the window min(1540, 1280 - 28) by min(900, 800 - 28).
  const game = { width: 1252, height: 772 }
  await page.setViewportSize({ width: 1700, height: 1100 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Marketplace', exact: true }).click()
  const port = page.locator('.aui-feature-port.aui-market-port')
  await expect(port).toBeVisible()
  // The workshop frames its preview: grow the browser until the window has the game's size.
  for (const _ of [1, 2, 3]) {
    const { width, height } = await box(port)
    const browser = page.viewportSize()!
    await page.setViewportSize({
      width: Math.round(browser.width + game.width - width),
      height: Math.round(browser.height + game.height - height),
    })
    await painted(page)
  }
  expect(await box(port)).toMatchObject(game)
  await port
    .locator('[data-marketplace-general-categories]')
    .getByRole('button', { name: /^Consumables/ })
    .click()
  await port.locator('[data-marketplace-item-types]').getByRole('button', { name: /^Key/ }).click()
  await expect(port.locator('[data-marketplace-cheapest-lot="1"]')).toBeVisible()
  test.info().annotations.push({ type: 'game window', description: JSON.stringify(await box(port)) })
  await port.screenshot({ path: shot_file('game-market-buy-1280') })
  await segment(page, 'Marketplace', 'Sell').click()
  await painted(page)
  await port.screenshot({ path: shot_file('game-market-sell-1280') })
})

test('the game’s own market window, for comparison: the real host of the 3D game at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="marketplace"]').click()
  const port = page.locator('.aui-feature-port.aui-market-port')
  await expect(port).toBeVisible()
  // The market is a lazy page: it shows its disclaimer first, once.
  const understood = page.getByRole('button', { name: 'I understand' })
  const browse = port.locator('.market-browse')
  await expect(understood.or(browse)).toBeVisible()
  if (await understood.isVisible()) await understood.click()
  await expect(browse).toBeVisible()
  await painted(page)
  test.info().annotations.push({ type: 'game window', description: JSON.stringify(await box(port)) })
  await page.screenshot({ path: shot_file('game-market-host-1280') })
})
