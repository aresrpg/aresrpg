// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the dapp's browser test measures on the rendered page: boxes, the scroll, and one capture per state.
import { expect, test, type Locator, type Page } from '@playwright/test'

import { BRAN, MIRA, open_dapp, type Bot } from './dapp_bot.ts'

export type Box = Readonly<{ x: number; y: number; width: number; height: number }>
/** The box of an element on screen, in window pixels. */
export const box = async (target: Locator): Promise<Box> => (await target.first().boundingBox())!
export const right = ({ x, width }: Box): number => x + width
export const bottom = ({ y, height }: Box): number => y + height
export const scroll_y = (page: Page): Promise<number> => page.evaluate(() => Math.round(scrollY))
/** The end of the page, as a player who scrolled all the way down sees it. */
export const scroll_to_end = (page: Page): Promise<void> =>
  page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))

/**
 * One state as the window shows it: no sideways scroll and nothing clipped. The backdrop and the tab
 * bar are fixed to the window, so a taller page is captured once more in a window as tall as itself
 * (`-full`); a state with an open dialog, or `whole: false`, is captured as the window only.
 */
export const shot = async (page: Page, name: string, whole = true): Promise<void> => {
  const { width, height } = page.viewportSize()!
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const clipped = await page.locator('.light-page').evaluate((node) => node.scrollWidth - node.clientWidth)
  expect(clipped, `${name}-${width} is ${clipped}px wider than the window`).toBeLessThanOrEqual(0)
  const file = (suffix: string) => test.info().outputPath(`${name}-${width}${suffix}.png`)
  await page.screenshot({ path: file('') })
  const tall = await page.evaluate(() => document.documentElement.scrollHeight)
  if (!whole || tall <= height || (await page.locator('dialog[open]').count())) return
  await page.setViewportSize({ width, height: tall })
  await page.evaluate(() => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted))))
  await page.screenshot({ path: file('-full') })
  await page.setViewportSize({ width, height })
}

export const tab = (page: Page, name: string) => page.locator(`.dapp-tabs [data-tab="${name}"]`)
export const open_tab = async (page: Page, name: string) => {
  await tab(page, name).click()
  await expect(tab(page, name)).toHaveAttribute('aria-current', 'page')
}
export const hero = (page: Page, id: string) => page.locator(`.dapp-hero-card[data-hero="${id}"]`)
export const run = (page: Page, id: string) => page.locator(`.dapp-run[data-run="${id}"]`)
/** The one notice of the direct request, whatever tab made it. */
export const direct = (page: Page) => page.locator('[data-direct]')
export const start = (page: Page) => page.locator('[data-start]')
export const fee = (page: Page) => page.locator('.dapp-fee-cap input')
export const bot_chip = (page: Page) => page.locator('.dapp-chip', { hasText: 'Bot' })
export const segment = (page: Page, group: string, name: string) =>
  page.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
/** Real entry checks stay on this machine: every request to another host is refused before it leaves. */
export const local_only = (page: Page) =>
  page.route(
    (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient')
  )
/** Seats one hero through the sheet of a seat. */
export const seat = async (page: Page, number: number, id: string) => {
  await page.locator(`.dapp-raid-seat[data-seat="${number}"]`).click()
  await page.locator(`[data-seat-sheet] .dapp-hero-picker [data-hero="${id}"]`).click()
  await expect(page.locator(`.dapp-raid-seat[data-seat="${number}"]`)).toHaveAttribute('data-hero', id)
}
export const enter = (page: Page) => page.locator('[data-raid-enter]')
export const short_notice = (page: Page) => page.getByRole('dialog', { name: 'Not enough keys for the whole team' })
export const in_room = (page: Page, id: string) =>
  expect(page.locator(`[data-raid-hero="${id}"]`)).toContainText('Room 1 of 8', { timeout: 15_000 })
/** Work on wheat with no tool: the one start the planner blocks for a reason the player can fix. */
export const blocked_work = async (page: Page) => {
  await open_tab(page, 'quest')
  await page.locator('[data-mode="work"]').click()
  await segment(page, 'Go to work', 'Gather one resource').click()
  await page.locator('[data-work-item="wheat"]').click()
  await expect(page.locator('[data-line="tool_required"]')).toHaveText('Mira: has no tool for this profession.')
  await expect(start(page)).toBeDisabled()
}
/** The board shows once the game server named the heroes; the silent consent round trip reloads the page. */
export const board = async (page: Page, bot: Bot) => {
  await open_dapp(page, bot)
  await expect(page.locator('.dapp-layout')).toBeVisible({ timeout: 45_000 })
}
/** The board once the bot answered: every free hero says it is ready. */
export const ready = async (page: Page, bot: Bot) => {
  await board(page, bot)
  await expect(hero(page, MIRA)).toHaveAttribute('data-status', 'free')
}
/** Both heroes hunt as one team from the Quest tab. */
export const team_hunt = async (page: Page) => {
  await open_tab(page, 'quest')
  await page.getByRole('group', { name: 'Who' }).locator(`[data-hero="${BRAN}"]`).click()
  await start(page).click()
  await expect(run(page, BRAN)).toContainText('Fighting with Mira', { timeout: 15_000 })
}
export const KEY_NAME = 'Key of the Gilded Lorito'
/** From a team short of keys to the key's offers in the market, which trades as the bot account. */
export const open_key_market = async (page: Page) => {
  await page.getByRole('button', { name: `Find ${KEY_NAME} on the market` }).click()
  await expect(tab(page, 'market')).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'I understand' }).click()
  const buy = page.locator('[data-marketplace-cheapest-lot="1"]').getByRole('button', { name: 'Buy' })
  await expect(buy).toBeEnabled({ timeout: 15_000 })
  // The price is shown here and only here, beside the bot's own balance.
  await expect(page.locator('.dapp-market')).toContainText('0.55')
  // The bot account sells items and has no sales ledger here.
  await expect(segment(page, 'Marketplace', 'Sell')).toBeVisible()
  await expect(segment(page, 'Marketplace', 'History')).toHaveCount(0)
  return buy
}
