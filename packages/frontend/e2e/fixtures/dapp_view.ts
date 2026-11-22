// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the dapp's browser test measures on the rendered page: boxes, the scroll, and one capture per state.
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { BRAN, MIRA, open_dapp, type Bot } from './dapp_bot.ts'

export { local_only } from './dapp_bot.ts'

export type Box = Readonly<{ x: number; y: number; width: number; height: number }>
/** The box of an element on screen, in window pixels. */
export const box = async (target: Locator): Promise<Box> => (await target.first().boundingBox())!
export const right = ({ x, width }: Box): number => x + width
export const bottom = ({ y, height }: Box): number => y + height
export const scroll_y = (page: Page): Promise<number> => page.evaluate(() => Math.round(scrollY))
/** The end of the page, as a player who scrolled all the way down sees it. */
export const scroll_to_end = (page: Page): Promise<void> =>
  page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))

/** The windows a state is checked in. Below 960px the page is one column, with its tabs at the bottom. */
export const WIDE = { width: 1920, height: 1080, phone: false } as const
export const LARGE = { width: 1440, height: 900, phone: false } as const
export const DESKTOP = { width: 1280, height: 800, phone: false } as const
export const PHONE = { width: 390, height: 844, phone: true } as const
/** The windows the look of a state is captured in. */
export const WINDOWS = [LARGE, DESKTOP, PHONE] as const
/** Two frames later, what the last change asked for is painted. */
export const painted = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
/**
 * Where a capture is written. Captures are review material: a run that names a folder in
 * `DAPP_LOOK_DIR` gets them there, one folder per spec; any other run keeps them in the test's output.
 */
export const shot_file = (name: string): string => {
  const folder = process.env.DAPP_LOOK_DIR
  if (!folder) return test.info().outputPath(`${name}.png`)
  const spec = join(folder, basename(test.info().file, '.pw.ts'))
  mkdirSync(spec, { recursive: true })
  return join(spec, `${name}.png`)
}
/**
 * One state as the window shows it: no sideways scroll and nothing clipped. The backdrop and the tab
 * bar are fixed to the window, so a taller page is captured once more in a window as tall as itself
 * (`-full`) and then left where it was scrolled to; a state with an open dialog, or `whole: false`, is
 * captured as the window only.
 */
export const shot = async (page: Page, name: string, whole = true): Promise<void> => {
  const { width, height } = page.viewportSize()!
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const clipped = await page.locator('.light-page').evaluate((node) => node.scrollWidth - node.clientWidth)
  expect(clipped, `${name}-${width} is ${clipped}px wider than the window`).toBeLessThanOrEqual(0)
  await page.screenshot({ path: shot_file(`${name}-${width}`) })
  const tall = await page.evaluate(() => document.documentElement.scrollHeight)
  if (!whole || tall <= height || (await page.locator('dialog[open]').count())) return
  const at = await scroll_y(page)
  await page.setViewportSize({ width, height: tall })
  await painted(page)
  await page.screenshot({ path: shot_file(`${name}-${width}-full`) })
  await page.setViewportSize({ width, height })
  await page.evaluate((y) => scrollTo(0, y), at)
}

/** The tabs exist once in the bar and once for the phone's bottom bar: the one on screen is meant. */
export const tab = (page: Page, name: string) => page.locator(`.dapp-tabs [data-tab="${name}"]:visible`)
export const open_tab = async (page: Page, name: string) => {
  await tab(page, name).click()
  await expect(tab(page, name)).toHaveAttribute('aria-current', 'page')
}
/** The one centred column of the page: the bar and the board share it. */
export const COLUMN = 1240
/**
 * The frame of the board. On a desktop it is one centred column: the tabs stand inside the bar, and the
 * board is as wide as the bar. On a phone the tabs are the bar at the bottom of the window. The box of
 * the tabs on screen is returned.
 */
export const expect_frame = async (page: Page): Promise<Box> => {
  const { width } = page.viewportSize()!
  const phone = width < 960
  const tabs = page.locator('.dapp-tabs:visible')
  await expect(tabs).toHaveAttribute('data-place', phone ? 'page' : 'bar')
  const [header, row] = [await box(page.locator('.light-page-header')), await box(tabs)]
  const layout = await box(page.locator('.dapp-layout'))
  if (phone) return row
  expect(Math.abs(header.x - (width - right(header)))).toBeLessThanOrEqual(1)
  expect(header.width).toBeLessThanOrEqual(COLUMN)
  expect(row.x).toBeGreaterThanOrEqual(header.x)
  expect(right(row)).toBeLessThanOrEqual(right(header))
  expect(bottom(row)).toBeLessThanOrEqual(bottom(header))
  expect(Math.abs(layout.x - header.x) + Math.abs(right(layout) - right(header))).toBeLessThanOrEqual(1)
  return row
}
export const hero = (page: Page, id: string) => page.locator(`.dapp-hero-card[data-hero="${id}"]`)
export const run = (page: Page, id: string) => page.locator(`.dapp-run[data-run="${id}"]`)
/** The one notice of the direct request, whatever tab made it. */
export const direct = (page: Page) => page.locator('[data-direct]')
export const start = (page: Page) => page.locator('[data-start]')
/** A place of the Quest tab by its key: `here` (where each hero stands), `city:thebes`, `biome:plains`. */
export const place = (page: Page, key: string) => page.locator(`.dapp-quest-place[data-place="${key}"]`)
/**
 * Picks a place: nothing of a place shows before that, and its plan, with the Start, opens at its
 * entry. Picking the picked place again closes its plan.
 */
export const pick_place = (page: Page, key = 'here') => place(page, key).locator('.dapp-quest-place-pick').click()
export const fee = (page: Page) => page.locator('.dapp-fee-cap input')
export const bot_chip = (page: Page) => page.locator('.dapp-chip[data-bot-balance]')
export const segment = (page: Page, group: string, name: string) =>
  page.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
/** The Quest tab with the plan of where each hero stands: the Start of the proposed hero is on it. */
export const open_plan = async (page: Page) => {
  await open_tab(page, 'quest')
  await pick_place(page)
}
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
  await pick_place(page)
  await start(page).click()
  await expect(run(page, BRAN)).toContainText('Fighting with Mira', { timeout: 15_000 })
}
export const KEY_NAME = 'Key of the Gilded Lorito'
/** Picks the dungeon key in a market: its group, its category, then the item. Its offers load from then on. */
export const pick_key = async (market: Locator) => {
  const pick = (list: string, name: RegExp | string) =>
    market.locator(`[data-marketplace-${list}]`).getByRole('button', { name }).click()
  await pick('general-categories', /^Consumables/)
  await pick('item-types', /^Key/)
  await pick('template-options', KEY_NAME)
}
/** The bot says what it does on the game socket's account subscription: the page hears it with no read. */
export const push_status = (page: Page, status: object) =>
  page.evaluate((pushed) => (window as unknown as { push_status: (s: unknown) => void }).push_status(pushed), status)
/** The one press from a missing key to its offers: it stands on the key line, or beside a team short of keys. */
export const buy_key = (page: Page) =>
  page.locator('[data-raid-key-ways]').getByRole('button', { name: 'Buy on the market', exact: true })
/** From a team short of keys to the key's offers in the market, which trades as the bot account. */
export const open_key_market = async (page: Page) => {
  await buy_key(page).click()
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
