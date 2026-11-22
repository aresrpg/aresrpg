// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The look and the flow of the Quest tab: nothing about a place or a work shows before the player
// picks it, the plan opens beside its entry, and one capture is kept per state and window.
import { expect, test, type Locator, type Page } from '@playwright/test'

import * as fake from '../fixtures/dapp_bot.ts'
import * as view from '../fixtures/dapp_view.ts'

const { MIRA, bot_fixture } = fake
const { bottom, box, right, run, open_tab, start, ready, segment, fee, shot, place, WINDOWS } = view
const choose = view.pick_place

const SUI = 1_000_000_000n
/** The widest a mode card may be: a card, never a bar across the page. */
const CARD = 264
/** The most running text a fight plan may hold, in words. */
const PLAN_WORDS = 45

const plan = (page: Page): Locator => page.locator('.dapp-quest-plan')
const words = async (target: Locator): Promise<number> => (await target.innerText()).split(/\s+/).filter(Boolean).length
/** Nothing of a plan is on the page: no difficulty, no fee limit, no drops link, no Start. */
const expect_no_plan = async (page: Page): Promise<void> => {
  for (const mark of ['.dapp-quest-plan', '[data-start]', '.dapp-fee-cap', '[data-drops]', '[data-facts]'])
    await expect(page.locator(mark), mark).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Difficulty' })).toHaveCount(0)
}
/**
 * The plan stands beside the list in a wide window, in view wherever the list is scrolled to; on one
 * column it is right under its entry.
 */
const expect_plan_at = async (page: Page, entry: Locator, phone: boolean): Promise<void> => {
  await expect(plan(page)).toBeVisible()
  await entry.scrollIntoViewIfNeeded()
  const [card, panel, list] = [await box(entry), await box(plan(page)), await box(page.locator('.dapp-quest-split'))]
  if (phone) {
    expect(panel.y).toBeGreaterThanOrEqual(bottom(card))
    expect(panel.y - bottom(card)).toBeLessThanOrEqual(12)
    return
  }
  expect(panel.x).toBeGreaterThanOrEqual(right(card))
  await expect(plan(page)).toBeInViewport({ ratio: 0.9 })
  // The list keeps about two fifths of the tab; the plan takes the rest.
  expect(card.width / list.width).toBeGreaterThan(0.36)
  expect(card.width / list.width).toBeLessThan(0.42)
}

for (const { width, height, phone } of WINDOWS) {
  test(`a fight quest shows nothing of a place before one is picked, at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    const bot = bot_fixture(1)
    bot.balance = 12n * SUI
    await ready(page, bot)
    await open_tab(page, 'quest')

    // Nothing picked: two compact mode cards, the heroes as chips, the list of places, and no plan.
    await expect_no_plan(page)
    const [fight, work] = [
      await box(page.locator('[data-mode="fight"]')),
      await box(page.locator('[data-mode="work"]')),
    ]
    expect(fight.y).toBe(work.y)
    expect(work.x).toBeGreaterThanOrEqual(right(fight))
    expect(fight.width).toBeLessThanOrEqual(CARD)
    await expect(page.getByRole('group', { name: 'Who' }).getByRole('button')).toHaveCount(2)
    await expect(place(page, 'here')).not.toHaveAttribute('data-selected')
    if (!phone) await expect(page.locator('[data-plan-hint]')).toHaveText('Pick a place')
    else await expect(page.locator('[data-plan-hint]')).toBeHidden()
    // A city and a biome are told apart by their edge and their chip, not by a colour.
    const edge = (key: string) => place(page, key).evaluate((card) => getComputedStyle(card).borderLeftStyle)
    expect([await edge('city:thebes'), await edge('biome:plains')]).toEqual(['solid', 'dashed'])
    await expect(place(page, 'city:thebes').locator('.dapp-quest-kind')).toHaveText('City')
    await expect(place(page, 'biome:plains').locator('.dapp-quest-kind')).toHaveText('Biome')
    // A place card holds one fact line at most, and no paragraph.
    await expect(place(page, 'biome:plains').locator('p')).toHaveCount(1)
    await shot(page, 'quest-none')

    // A city picked: its plan opens at its entry, compact and nearly wordless.
    await choose(page, 'city:thebes')
    await expect_plan_at(page, place(page, 'city:thebes'), phone)
    await expect(plan(page).getByRole('heading', { name: 'Thebes' })).toBeVisible()
    await expect(plan(page)).toBeInViewport()
    await expect(plan(page).locator('dt')).toHaveText(['Monsters level', 'Group size', 'Key drop', 'Rarest drop'])
    await expect(plan(page).locator('p')).toHaveCount(0)
    expect(await words(plan(page))).toBeLessThanOrEqual(PLAN_WORDS)
    await expect(start(page)).toHaveText('Send Mira')
    await expect(fee(page)).toHaveAttribute('placeholder', 'No limit')
    await shot(page, 'quest-city')
    // In a wide window the plan stays in view while the list scrolls under it, down to its last place.
    if (!phone) {
      await place(page, 'biome:rainforest').scrollIntoViewIfNeeded()
      await expect(plan(page)).toBeInViewport({ ratio: 0.9 })
      await page.evaluate(() => scrollTo(0, 0))
    }
    // Choosing the chosen place again closes its plan: the tab is back to nothing picked.
    await choose(page, 'city:thebes')
    await expect_no_plan(page)

    // A biome picked with a difficulty: the size of its groups is one row of the ledger.
    await choose(page, 'biome:plains')
    await segment(page, 'Difficulty', 'Medium').click()
    await expect(plan(page).locator('[data-group="medium"] dd')).toHaveText(/^\d+(–\d+)?$/)
    await expect(plan(page).locator('[data-unfit]')).toHaveCount(0)
    await expect_plan_at(page, place(page, 'biome:plains'), phone)
    await shot(page, 'quest-biome')
    // A difficulty the place cannot offer says so in one line and offers no Start.
    await choose(page, 'city:thebes')
    await expect(plan(page).locator('[data-unfit]')).toContainText('Thebes is not at that distance.')
    await expect(start(page)).toHaveCount(0)
    await shot(page, 'quest-unfit')

    // "Where each hero stands" is one entry of the list; its Start sends the hero, which then heads the tab.
    await segment(page, 'Difficulty', 'Any').click()
    await choose(page, 'here')
    await expect_plan_at(page, place(page, 'here'), phone)
    await start(page).dblclick()
    await expect(run(page, MIRA)).toBeInViewport({ timeout: 15_000 })
    expect(bottom(await box(run(page, MIRA)))).toBeLessThanOrEqual((await box(page.locator('[data-mode="fight"]'))).y)
    await expect(run(page, MIRA).locator('.dapp-run-drops')).toContainText('Wheat', { timeout: 15_000 })
    expect(bot.runs.size).toBe(1)
    await page.evaluate(() => scrollTo(0, 0))
    await shot(page, 'quest-out')
  })

  test(`work shows its configuration only after the player picks what to do, at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    const bot = bot_fixture()
    bot.balance = 12n * SUI
    await ready(page, bot)
    await open_tab(page, 'quest')
    await page.locator('[data-mode="work"]').click()

    // Nothing picked: the worker as chips, three ways as cards, and nothing else.
    await expect_no_plan(page)
    await expect(page.locator('[data-way]')).toHaveCount(3)
    await expect(page.locator('[data-work-item], [data-job]')).toHaveCount(0)
    const ways = await Promise.all(['auto', 'gather', 'craft'].map((way) => box(page.locator(`[data-way="${way}"]`))))
    if (!phone) expect(new Set(ways.map(({ y }) => y)).size).toBe(1)
    await shot(page, 'quest-work-none')

    // The bot's own pick is the pick at once: its plan opens with the way.
    await page.locator('[data-way="auto"]').click()
    await expect(plan(page).getByRole('heading', { name: 'Let your bot pick' })).toBeVisible()
    await expect(start(page)).toBeEnabled()
    await shot(page, 'quest-work-auto')

    // A recipe: the list opens with the way, the plan with the recipe.
    await page.locator('[data-way="craft"]').click()
    await expect(page.locator('.dapp-quest-plan')).toHaveCount(0)
    if (!phone) await expect(page.locator('[data-plan-hint]')).toHaveText('Pick a recipe.')
    await page.locator('[data-job="FARMER"]').click()
    const flour = page.locator('[data-work-item="wheat_flour"]')
    await flour.click()
    await expect_plan_at(page, page.locator('.dapp-quest-entry', { has: flour }), phone)
    await expect(plan(page).getByRole('heading', { name: 'Wheat Flour' })).toBeVisible()
    await expect(plan(page).locator('[data-material="wheat"] dd')).toContainText('2 of 2')
    await expect(plan(page).locator('[data-material="water"]')).toHaveAttribute('data-missing', '1')
    await expect(plan(page).locator('p:not(.dapp-market-unsold, .aui-sr)')).toHaveCount(0)
    await segment(page, 'Objective', 'Make a number').click()
    await expect(plan(page).locator('[data-work-tries] dd')).toHaveText(/^~\d+$/)
    await shot(page, 'quest-work-recipe')

    // A blocked start: wheat with no tool. The plan says why in one line and the Start is closed.
    await page.locator('[data-way="gather"]').click()
    await page.locator('[data-work-item="wheat"]').click()
    await expect(page.locator('[data-line="tool_required"]')).toHaveText('Mira: has no tool for this profession.')
    await expect(plan(page).locator('[data-tool-missing="FARMER"]')).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await shot(page, 'quest-blocked')
    expect(bot.runs.size).toBe(0)
  })
}
