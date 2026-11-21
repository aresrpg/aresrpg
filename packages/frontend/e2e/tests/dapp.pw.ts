// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import * as fake from '../fixtures/dapp_bot.ts'
import * as view from '../fixtures/dapp_view.ts'

const { MIRA, BRAN, NOVA, HOOD, OFFER, bot_fixture, calls_of, directs_of, hold, item, open_dapp, tree_of } = fake
const { bottom, box, right, scroll_to_end, scroll_y, shot, local_only } = view
const { tab, open_tab, hero, run, direct, start, fee, bot_chip, segment } = view
const { seat, enter, short_notice, in_room, blocked_work, board, ready, team_hunt, KEY_NAME, open_key_market } = view
type Bot = fake.Bot
const PRICE_LINE = /\d+ classes · 10 SUI, paid by your bot/
const UNREACHABLE = 'We could not reach your bot. Reload this page to try again.'
const SUI = 1_000_000_000n
/** The windows a state is captured in: its height, by its width. */
const HEIGHTS: Readonly<Record<number, number>> = { 1920: 1080, 1280: 800, 390: 844 }
const starts = (bot: Bot) => calls_of(bot, 'bot_start_behavior')

test('the /dapp route boots the engine-less surface: Google sign-in, no renderer download', async ({ page }) => {
  await local_only(page)
  const scripts: string[] = []
  page.on('request', (request) => scripts.push(request.url()))
  await page.goto('/dapp')
  await expect(page.getByRole('heading', { name: 'Send your heroes on expeditions' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Google/ })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(scripts.filter((url) => /\/three[./]|three\.module/.test(url))).toEqual([])
})

test('the bot consent redirect opens in the dapp only for the tab that started it', async ({ page }) => {
  await local_only(page)
  await page.addInitScript(() => {
    if (!location.search.includes('claimed')) return
    sessionStorage.setItem(
      'aresrpg:dapp:authorization',
      JSON.stringify({
        issuer: 'https://bot.fixture.invalid',
        owner: '0xowner',
        client_id: 'c',
        redirect_uri: `${location.origin}/dapp`,
        scope: 'bot:observe bot:play bot:pause',
        state: 's',
        verifier: 'v',
        expires_at: Date.now() + 60_000,
      })
    )
  })
  await page.goto('/world?intent=connect-agent&authorization_id=fixture-auth&claimed=1')
  await expect(page.locator('.light-page-header')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('signed out, the dapp asks for Google sign-in and shows neither tabs nor bot controls', async ({ page }) => {
  await open_dapp(page, bot_fixture(), '')
  await expect(page.getByRole('heading', { name: 'Send your heroes on expeditions' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Google/ })).toBeVisible()
  await expect(page.locator('.dapp-tabs')).toHaveCount(0)
  await expect(start(page)).toHaveCount(0)
})

test('a bot service that is down says so in plain words, and Connect tries again', async ({ page }) => {
  const bot = bot_fixture()
  bot.offline = true
  await open_dapp(page, bot)
  await expect(page.getByRole('alert')).toHaveText(/not answering/)
  await expect(page.locator('.dapp-tabs')).toHaveCount(0)
  bot.offline = false
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(hero(page, MIRA)).toHaveAttribute('data-status', 'free', { timeout: 45_000 })
})

test('the board shows before the bot answers, and each wait of the bot is named', async ({ page }) => {
  const bot = bot_fixture()
  const release = hold(bot)
  await board(page, bot)
  // Asked, not answered: the heroes are the game server's, so they show, and none claims a status.
  await expect(page.locator('[data-bot-wait]')).toHaveText('Waking your bot and asking what it is doing…')
  await expect(hero(page, MIRA)).toBeVisible()
  await expect(hero(page, MIRA)).not.toHaveAttribute('data-status')
  await expect(tab(page, 'market')).toBeDisabled()
  await open_tab(page, 'quest')
  await expect(page.locator('[data-line="waiting"]')).toHaveText('Waiting for your bot to answer…')
  await expect(start(page)).toBeDisabled()
  release()
  await expect(page.locator('[data-bot-wait]')).toHaveCount(0)
  await expect(start(page)).toBeEnabled()
  expect(starts(bot)).toEqual([])
  // The bot answers that its baseline is not ready: another wait, with its own sentence.
  bot.answers = 'pending'
  await page.reload()
  await expect(page.locator('[data-bot-wait]')).toHaveText(/catching up with the world/)
  await expect(hero(page, BRAN)).not.toHaveAttribute('data-status')
  // The bot cannot be reached: the board stays, with one plain sentence.
  bot.answers = 'failing'
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText(UNREACHABLE)
  await expect(hero(page, MIRA)).toBeVisible()
  await expect(tab(page, 'market')).toBeDisabled()
  // Nothing claims to wait for a bot that cannot be reached: each closed action says so.
  await expect(page.locator('.dapp-create')).toHaveAttribute('data-create', 'unreachable')
  await expect(page.locator('.dapp-create')).toContainText(UNREACHABLE)
  for (const name of ['quest', 'raid'] as const) {
    await open_tab(page, name)
    await expect(page.locator('.dapp-board')).not.toContainText('Waiting for your bot')
  }
  await open_tab(page, 'quest')
  await expect(page.locator('[data-line="unreachable"]')).toHaveText(UNREACHABLE)
  await expect(start(page)).toBeDisabled()
})

test('an account with no hero shows its first steps, and a hero the bot cannot pay is not offered', async ({
  page,
}) => {
  const bot = bot_fixture()
  bot.heroes = []
  await board(page, bot)
  await expect(page.getByRole('heading', { name: 'Welcome to Expeditions' })).toBeVisible()
  await expect(page.locator('.dapp-step')).toHaveCount(3)
  // The bot wallet pays a hero: with too little SUI the button is closed and one sentence says why.
  const create = page.locator('.dapp-create')
  await expect(create).toHaveAttribute('data-create', 'funds')
  await expect(create).toContainText('Your bot needs 10 SUI for the hero and 0.05 SUI for network fees.')
  await expect(create.getByRole('button', { name: 'Create a hero' })).toBeDisabled()
  for (const name of ['quest', 'raid', 'heroes'] as const) {
    await open_tab(page, name)
    await expect(page.locator(`[data-${name}-empty]`)).toBeVisible()
  }
  expect(bot.directs).toEqual([])
})

// Reported 2026-11-21: with no pick the first click sent the proposed hero and the second sent the next proposal.
test('a double click on Start sends the proposed hero only, never the next proposal too', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await open_tab(page, 'quest')
  await expect(start(page)).toHaveText('Send Mira')
  await start(page).dblclick()
  await expect(run(page, MIRA)).toContainText('Working', { timeout: 15_000 })
  expect(starts(bot)).toHaveLength(1)
  await expect(start(page)).toBeDisabled()
  expect(bot.runs.has(BRAN)).toBe(false)
})

test('a raid short of keys asks first, then sends only the hero that holds one', async ({ page }) => {
  const bot = bot_fixture(1)
  await ready(page, bot)
  await open_tab(page, 'raid')
  await expect(page.locator('p[data-raid-keys]')).toHaveAttribute('data-raid-keys', '1')
  await seat(page, 1, MIRA)
  await seat(page, 2, BRAN)
  await expect(page.locator(`[data-seat="1"] [data-seat-key]`)).toHaveAttribute('data-seat-key', 'held')
  await expect(page.locator(`[data-seat="2"] [data-seat-key]`)).toHaveAttribute('data-seat-key', 'none')
  await expect(page.locator('[data-raid-short="1"]')).toContainText(`1 more ${KEY_NAME} for this team`)
  // A fee limit that cannot be read never becomes "no limit": Enter waits.
  await fee(page).fill('-1')
  await expect(page.locator('[data-fee-cap]')).toHaveAttribute('data-fee-cap', 'invalid')
  await expect(enter(page)).toBeDisabled()
  await fee(page).fill('')
  await enter(page).click()
  await expect(short_notice(page)).toContainText('so only Mira will enter the dungeon.')
  // Outside the market the page shows no price and makes no purchase.
  await expect(short_notice(page)).not.toContainText('SUI')
  await short_notice(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(short_notice(page)).toHaveCount(0)
  expect(starts(bot)).toEqual([])
  await enter(page).click()
  await short_notice(page).getByRole('button', { name: 'Start raid with 1' }).dblclick()
  await in_room(page, MIRA)
  // Exactly the hero that holds a key was sent, alone: the bot's entry rule holds for its tree.
  expect(starts(bot)).toHaveLength(1)
  expect(tree_of(bot, MIRA)).toContain('"dungeon":"gilded_lorito"')
  expect(tree_of(bot, MIRA)).toContain('"allies":[]')
  expect(bot.runs.has(BRAN)).toBe(false)
})

test('a refused purchase says why in one sentence, never a code, and buys nothing', async ({ page }) => {
  const bot = bot_fixture()
  bot.refusal = 'listing_changed_or_ineligible'
  await ready(page, bot)
  await open_tab(page, 'raid')
  await seat(page, 1, MIRA)
  // No key at all: the team cannot enter, and no tree can be sent.
  await expect(page.locator('[data-raid-short="1"]')).toBeVisible()
  await expect(enter(page)).toHaveCount(0)
  await (await open_key_market(page)).dblclick()
  const refused = page.locator('[data-direct="refused"]')
  await expect(refused).toHaveText(/This offer changed or is gone\. Check the current price, then try again\./)
  await expect(refused).toHaveAttribute('role', 'alert')
  await expect(page.locator('body')).not.toContainText('listing_changed')
  expect(directs_of(bot, 'market_buy')).toHaveLength(1)
  await expect(bot_chip(page)).toContainText(/Bot: 2(\.00)? SUI/)
  await refused.getByRole('button', { name: 'Dismiss' }).click()
  await expect(direct(page)).toHaveCount(0)
  expect(starts(bot)).toEqual([])
  // The offers come from the page's own game socket; the bot is never asked to watch them.
  expect(bot.watches).toBe(0)
})

test('a missing key is bought as the bot account, then the whole team enters', async ({ page }) => {
  const bot = bot_fixture(1)
  await ready(page, bot)
  await open_tab(page, 'raid')
  await seat(page, 1, MIRA)
  await seat(page, 2, BRAN)
  await (await open_key_market(page)).dblclick()
  await expect(direct(page)).toHaveText(new RegExp(`Bought: 1 × ${KEY_NAME}\\. It is in your heroes' bag\\.`))
  // One command, for the exact offer on screen, capped at the total the player saw.
  expect(directs_of(bot, 'market_buy')).toHaveLength(1)
  const paid = { item_id: OFFER.id, price_mist: '500000000', max_total_mist: '550000000' }
  expect(bot.directs[0]!.action).toMatchObject(paid)
  await expect(bot_chip(page)).toContainText('Bot: 1.45 SUI')
  await expect(page.locator('.dapp-chip[data-keys]')).toHaveAttribute('data-keys', '2')
  await open_tab(page, 'raid')
  await expect(page.locator('[data-raid-short]')).toHaveCount(0)
  await enter(page).dblclick()
  await in_room(page, BRAN)
  expect(starts(bot)).toHaveLength(2)
  expect(tree_of(bot, BRAN)).toContain(`"allies":["${MIRA}"]`)
})

test('Home names the next step and every hero, and the create sheet states the price', async ({ page }) => {
  const bot = bot_fixture()
  bot.balance = 12n * SUI
  await ready(page, bot)
  const next = page.locator('.dapp-next')
  await expect(next).toHaveAttribute('data-next', 'quest')
  await expect(next).toContainText('Mira is free')
  for (const id of [MIRA, BRAN]) {
    await expect(hero(page, id)).toContainText('Ready')
    await expect(hero(page, id).getByRole('button', { name: 'Send on a quest' })).toBeVisible()
    await expect(hero(page, id).getByRole('button', { name: 'Raid dungeon' })).toBeVisible()
  }
  const tile = page.locator('.dapp-create-tile')
  await expect(tile).toContainText(PRICE_LINE)
  await tile.getByRole('button', { name: 'Create a hero' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText(/Price\s*10 SUI/)
  await expect(sheet.getByText(PRICE_LINE)).toBeInViewport({ ratio: 1 })
  await expect(sheet.locator('canvas')).toHaveCount(0)
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Novalis')
  await sheet.getByRole('button', { name: 'Create a hero' }).dblclick()
  await expect(direct(page)).toHaveText(/novalis is ready\./i)
  expect(directs_of(bot, 'create_character')).toHaveLength(1)
  await expect(hero(page, NOVA)).toContainText('Novalis')
  // The next step fills the pick and opens the tab that shows it; nothing is sent from Home.
  await next.getByRole('button', { name: 'Send on a quest' }).click()
  await expect(tab(page, 'quest')).toHaveAttribute('aria-current', 'page')
  const picked = page.getByRole('group', { name: 'Who' }).locator(`[data-hero="${MIRA}"]`)
  await expect(picked).toHaveAttribute('aria-pressed', 'true')
  expect(starts(bot)).toEqual([])
})

test('a fight quest sends one start per picked hero, with its place, difficulty and fee limit', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await open_tab(page, 'quest')
  const who = page.getByRole('group', { name: 'Who' })
  await expect(who.locator(`[data-hero="${MIRA}"]`)).toHaveAttribute('aria-pressed', 'true')
  await who.locator(`[data-hero="${BRAN}"]`).click()
  await page
    .locator('.dapp-quest-place', { hasText: /^Thebes/ })
    .getByRole('button')
    .first()
    .click()
  // A difficulty is a distance band: one the chosen city does not lie in offers no Start.
  await segment(page, 'Difficulty', 'Medium').click()
  await expect(page.locator('[data-unfit]')).toContainText('Thebes is not at that distance.')
  await expect(start(page)).toHaveCount(0)
  await segment(page, 'Difficulty', 'Easy').click()
  await expect(page.locator('[data-plan="fight"]')).toContainText('Groups of 1 to 2 monsters.')
  // A fee limit that cannot be read offers no Start at all.
  await fee(page).fill('abc')
  await expect(page.locator('[data-fee-cap]')).toContainText('Enter an amount of SUI above zero')
  await expect(start(page)).toHaveCount(0)
  await fee(page).fill('0.5')
  await expect(page.locator('[data-fee-cap]')).toContainText('has paid 0.5 SUI in network fees')
  await expect(start(page)).toHaveText('Send Mira, Bran')
  await start(page).dblclick()
  await expect(run(page, MIRA)).toContainText('Fighting with Bran', { timeout: 15_000 })
  await expect(run(page, BRAN)).toContainText('Working')
  expect(starts(bot)).toHaveLength(2)
  expect(tree_of(bot, MIRA)).toContain(`{"type":"join","character_id":"${MIRA}","allies":["${BRAN}"]}`)
  for (const bound of ['"area":{"world":"nauvis","city":"thebes",', '"max_size":2', '"500000000"'])
    expect(tree_of(bot, MIRA)).toContain(bound)
  await expect(tab(page, 'quest').locator('[data-badge]')).toHaveText('2')
  // Each card folds its hero's own gains; what entered the shared bag is told once, in its feed.
  await expect(run(page, MIRA).locator('.dapp-run-drops')).toContainText('Wheat', { timeout: 15_000 })
  await expect(page.locator('.dapp-bag-feed')).toContainText(/\+[1-9]/, { timeout: 15_000 })
  await run(page, MIRA).getByRole('button', { name: 'Stop' }).dblclick()
  await expect(run(page, MIRA)).toContainText('Finished')
  await expect(run(page, BRAN)).toContainText('Working')
  expect(bot.stops).toEqual([MIRA])
  // A finished card stays until dismissed and sends the same again, once.
  await run(page, MIRA).getByRole('button', { name: 'Send again' }).dblclick()
  await expect(run(page, MIRA).filter({ hasText: 'Working' })).toBeVisible({ timeout: 15_000 })
  expect(starts(bot)).toHaveLength(3)
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(run(page, MIRA)).toHaveCount(1)
})

test('work it has no tool for is blocked with its reason, and auto work sends one worker', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await blocked_work(page)
  await expect(page.locator('[data-tool-missing]')).toContainText('Handymen craft them.')
  await start(page).click({ force: true })
  expect(starts(bot)).toEqual([])
  await segment(page, 'Go to work', 'Let your bot pick').click()
  await expect(start(page)).toHaveText('Start')
  await start(page).click()
  await expect(run(page, MIRA)).toContainText('Gather · Mira', { timeout: 15_000 })
  await expect(run(page, MIRA)).toContainText('Objective: Go to work')
  expect(starts(bot)).toHaveLength(1)
  expect(bot.runs.get(MIRA)?.strategy).toBe('gather_craft')
  await open_tab(page, 'home')
  await expect(hero(page, MIRA)).toHaveAttribute('data-status', 'activity')
  await expect(hero(page, BRAN)).toHaveAttribute('data-status', 'free')
})

test('a raid seats the proposed team, enters once per hero, and stops as a team', async ({ page }) => {
  const bot = bot_fixture(2)
  await ready(page, bot)
  // Home leads with the raid a held key opens, and seats the team it proposes.
  const next = page.locator('.dapp-next')
  await expect(next).toHaveAttribute('data-next', 'raid')
  await expect(next).toContainText('Keys you hold for it: 2.')
  await next.getByRole('button', { name: 'Plan a raid' }).click()
  await expect(tab(page, 'raid')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.dapp-raid-seat[data-hero]')).toHaveCount(2)
  await segment(page, 'Runs', '3').click()
  await expect(page.locator('[data-raid-runs]')).toHaveAttribute('data-raid-runs', '3')
  await enter(page).dblclick()
  await in_room(page, MIRA)
  await in_room(page, BRAN)
  expect(starts(bot)).toHaveLength(2)
  expect(tree_of(bot, BRAN)).toContain(`"dungeon":"gilded_lorito"`)
  expect(tree_of(bot, BRAN)).toContain(`"allies":["${MIRA}"]`)
  expect(tree_of(bot, BRAN)).toContain('"type":"dungeon_runs","op":"gte","value":3')
  await expect(tab(page, 'raid').locator('[data-badge]')).toHaveText('2')
  await expect(page.locator('[data-raid-party][data-live]')).toContainText('Loot from cleared rooms')
  await page.getByRole('button', { name: 'Stop the team' }).dblclick()
  await expect(page.locator('[data-raid-follow="result"]')).toBeVisible({ timeout: 15_000 })
  expect(bot.stops.toSorted()).toEqual([MIRA, BRAN])
})

test('Heroes changes gear, stats and spells by one request each, with no wallet controls', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await open_tab(page, 'heroes')
  const heroes = page.locator('.dapp-heroes-tab')
  await expect(heroes.locator('[data-character-panel]')).toHaveCount(4)
  const strength = heroes.getByRole('button', { name: 'Add a point to Strength', exact: true })
  await expect(strength).toBeEnabled()
  // The bot holds the hero: nothing here moves an item between accounts, uses one or feeds a pet.
  await expect(page.getByRole('region', { name: 'Agent kiosk' })).toHaveCount(0)
  const hood = heroes.locator('.chr-equip__grid').getByRole('button', { name: /Molted Lorito Hood/ })
  await hood.click()
  await expect(heroes.getByRole('button', { name: /^(Select|Feed|Use|Send to agent)\b/ })).toHaveCount(0)
  await hood.dblclick()
  await expect(direct(page)).toHaveText(/Equipment changed\./)
  const worn = { character_id: MIRA, slot: 'hat', item_id: `${HOOD}-1` }
  expect(bot.directs).toEqual([{ kind: 'equip_item', action: worn }])
  await strength.click()
  await heroes.getByRole('button', { name: 'Confirm', exact: true }).dblclick()
  await expect(direct(page)).toHaveText(/Characteristics updated\./)
  expect(directs_of(bot, 'raise_stats')).toHaveLength(1)
  expect(bot.directs[1]!.action).toMatchObject({ character_id: MIRA, spending: { strength: 1 } })
  const level_up = heroes.getByRole('button', { name: /^Level up spell/ })
  await level_up.first().dblclick()
  await expect(direct(page)).toHaveText(/Spell level raised\./)
  expect(directs_of(bot, 'raise_spell')).toHaveLength(1)
  // The pick only chooses whom to look at.
  await heroes.locator(`.dapp-hero-picker [data-hero="${BRAN}"]`).click()
  await expect(heroes.locator(`.dapp-hero-card[data-hero="${BRAN}"]`)).toBeVisible()
  expect(bot.directs).toHaveLength(3)
})

test('Heroes crafts a recipe the bag pays by one request, through the game’s own jobs tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const bot = bot_fixture()
  bot.bag = [...bot.bag, item('water', 1)]
  await ready(page, bot)
  await open_tab(page, 'heroes')
  const jobs = page.locator('[data-character-panel="jobs"]')
  // The game's own advice: the recipe this farmer levels on is marked.
  const flour = jobs.locator('.jobs__recipe[title="Wheat Flour"]')
  await expect(flour).toContainText('Best')
  await flour.click()
  const recipe = page.getByRole('dialog', { name: 'Wheat Flour', exact: true })
  const water = recipe.locator('.jobs__ingredient', { hasText: 'Water' })
  await expect(water).toContainText('1 / 1')
  const craft = recipe.getByRole('button', { name: 'Craft ×1', exact: true })
  await expect(craft).toBeEnabled()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: HEIGHTS[width]! })
    await jobs.scrollIntoViewIfNeeded()
    await expect(craft).toBeInViewport({ ratio: 1 })
    await shot(page, 'heroes-craft', false)
  }
  await craft.dblclick()
  await expect(direct(page)).toHaveAttribute('data-direct', 'done')
  const crafted = { character_id: MIRA, output_type: 'wheat_flour', attempts: 1 }
  expect(bot.directs).toEqual([{ kind: 'craft', action: crafted }])
  // The bag paid for it: the game's own check closes the Craft, and nothing else was asked.
  await expect(water).toContainText('0 / 1')
  await expect(craft).toBeDisabled()
  expect(bot.directs).toHaveLength(1)
})

test('the market lists and withdraws as the bot account, once each, and offers no collection', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await open_tab(page, 'market')
  await page.getByRole('button', { name: 'I understand' }).click()
  const market = page.locator('.dapp-market')
  await segment(page, 'Marketplace', 'Sell').click()
  await market.locator(`[data-marketplace-owned-item="${HOOD}-1"]`).click()
  const sale = page.getByRole('dialog', { name: 'List for sale', exact: true })
  await sale.getByLabel('Total price for the lot').fill('2.5')
  await sale.getByRole('button', { name: 'List for sale', exact: true }).dblclick()
  await expect(direct(page)).toHaveText(/Listed for sale: 1 × Molted Lorito Hood\./)
  expect(directs_of(bot, 'market_sell')).toHaveLength(1)
  expect(bot.directs[0]!.action).toMatchObject({ item_id: `${HOOD}-1`, amount: 1, price_mist: '2500000000' })
  const listed = market.locator(`[data-marketplace-own-listing="${HOOD}-1"]`)
  await expect(listed).toContainText('2.50')
  await listed.getByRole('button', { name: 'Delist', exact: true }).dblclick()
  await expect(direct(page)).toHaveText(/Listing withdrawn: 1 × Molted Lorito Hood is back in your bag\./)
  const withdrawn = { item_id: `${HOOD}-1`, kiosk: '0xkiosk' }
  expect(directs_of(bot, 'market_delist')).toEqual([{ kind: 'market_delist', action: withdrawn }])
  await expect(listed).toHaveCount(0)
  // The page cannot know what waits in the kiosks: the bot collects by itself, and nothing here asks it to.
  await expect(market.getByRole('button', { name: /collect/i })).toHaveCount(0)
  expect(directs_of(bot, 'market_collect')).toEqual([])
  expect(bot.watches).toBe(0)
})

test('a run the bot ends by itself finishes on the page from the pushed status, with no read', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await team_hunt(page)
  // Every answer to the two starts is read first: from here on the page asks the bot nothing.
  await page.waitForLoadState('networkidle')
  const calls = bot.calls.length
  const status = { ready: true, event_fence: 1, sampled_at: performance.now(), state: 'idle', direct: null, runs: [] }
  await page.evaluate(
    (pushed) => (window as unknown as { push_status: (s: unknown) => void }).push_status(pushed),
    status
  )
  await expect(run(page, BRAN)).toContainText('Finished')
  expect(bot.calls).toHaveLength(calls)
})

test('a reload shows every running hero again, named by the strategy the bot reports for its run', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await team_hunt(page)
  await page.reload()
  await expect(tab(page, 'quest').locator('[data-badge]')).toHaveText('2', { timeout: 45_000 })
  await open_tab(page, 'quest')
  await expect(run(page, MIRA)).toContainText('Train · Mira')
  await expect(run(page, BRAN)).toContainText('Working')
  expect(starts(bot)).toHaveLength(2)
  // The observation alone names the runs: no retained tree is read back.
  expect(calls_of(bot, 'bot_behavior_status')).toEqual([])
})

test('an expired grant that cannot refresh returns to Connect with an honest message', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  bot.token_ok = false
  bot.refresh_ok = false
  await open_tab(page, 'quest')
  await start(page).click()
  await expect(page.getByRole('alert')).toHaveText(/connection expired/, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(page.locator('.dapp-tabs')).toHaveCount(0)
})

test('disconnect revokes this page grant once and leaves the board', async ({ page }) => {
  const bot = bot_fixture()
  await ready(page, bot)
  await page.getByRole('button', { name: 'Disconnect this page' }).dblclick()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(page.locator('.dapp-tabs')).toHaveCount(0)
  await expect.poll(() => calls_of(bot, 'revoke').length).toBe(1)
})

for (const width of [1920, 1280, 390]) {
  const height = HEIGHTS[width]!
  const phone = width < 960

  test(`every tab, the create sheet and a blocked start fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const bot = bot_fixture(1)
    bot.balance = 12n * SUI
    await ready(page, bot)
    await shot(page, 'home')
    const [header, row, layout] = [
      await box(page.locator('.light-page-header')),
      await box(page.locator('.dapp-tabs')),
      await box(page.locator('.dapp-layout')),
    ]
    if (!phone) {
      // The bar keeps its own centred width; the tabs and the board take the window around it.
      expect(Math.abs(header.x - (width - right(header)))).toBeLessThanOrEqual(1)
      expect(header.width).toBeLessThanOrEqual(1120)
      expect(row.x).toBeLessThanOrEqual(header.x)
      expect(right(layout)).toBeGreaterThanOrEqual(right(header))
    }
    // The page ends above the tab bar: its last row is never under it.
    await scroll_to_end(page)
    if (phone) expect(bottom(await box(page.locator('.dapp-layout')))).toBeLessThanOrEqual(row.y)
    await page.locator('.dapp-create-tile').getByRole('button', { name: 'Create a hero' }).click()
    // The price and who pays it are read without scrolling the sheet.
    await expect(page.getByRole('dialog').getByText(PRICE_LINE)).toBeInViewport({ ratio: 1 })
    await shot(page, 'create-hero')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // A tab starts at its top, wherever the last one was left.
    if (phone) expect(await scroll_y(page)).toBeGreaterThan(0)
    await open_tab(page, 'quest')
    await expect.poll(() => scroll_y(page)).toBe(0)
    await shot(page, 'quest')
    // On one column the Start comes before the places; beside them it stays in view.
    const send = await box(start(page))
    if (phone) expect(bottom(send)).toBeLessThan((await box(page.locator('[data-place="here"]'))).y)
    const quest_fee = await box(fee(page))
    await blocked_work(page)
    await shot(page, 'quest-blocked-start')
    await open_tab(page, 'raid')
    await seat(page, 1, MIRA)
    await seat(page, 2, BRAN)
    // One fee field: the same size on every tab that starts something.
    const raid_fee = await box(fee(page))
    expect([raid_fee.height, raid_fee.width]).toEqual([quest_fee.height, quest_fee.width])
    expect(raid_fee.height).toBeGreaterThanOrEqual(44)
    await shot(page, 'raid')
    await enter(page).click()
    await expect(short_notice(page)).toBeVisible()
    await shot(page, 'raid-short-notice')
    await short_notice(page).getByRole('button', { name: 'Cancel' }).click()
    await open_tab(page, 'heroes')
    await expect(page.getByRole('button', { name: /^Level up spell/ }).first()).toBeVisible()
    await shot(page, 'heroes')
    for (const panel of ['equipment', 'stats', 'spells', 'jobs']) {
      await page.locator(`[data-character-panel="${panel}"]`).scrollIntoViewIfNeeded()
      await shot(page, `heroes-${panel}`, false)
    }
    await open_tab(page, 'market')
    await expect(page.getByRole('button', { name: 'I understand' })).toBeVisible()
    await shot(page, 'market-disclaimer')
    await page.getByRole('button', { name: 'I understand' }).click()
    await expect(segment(page, 'Marketplace', 'Sell')).toBeVisible()
    await shot(page, 'market')
    await segment(page, 'Marketplace', 'Sell').click()
    await expect(page.locator(`[data-marketplace-owned-item="${HOOD}-1"]`)).toBeVisible()
    await shot(page, 'market-sell')
    await scroll_to_end(page)
    if (phone) expect(bottom(await box(page.locator('.dapp-layout')))).toBeLessThanOrEqual(row.y)
    // An offer and its Buy are inside the window: nothing of the market is out of reach.
    await open_tab(page, 'raid')
    await page.getByRole('button', { name: `Find ${KEY_NAME} on the market` }).click()
    const buy = page.locator('[data-marketplace-cheapest-lot="1"]').getByRole('button', { name: 'Buy' })
    await buy.scrollIntoViewIfNeeded()
    await expect(buy).toBeInViewport({ ratio: 1 })
    expect(right(await box(buy))).toBeLessThanOrEqual(width)
    await shot(page, 'market-offers', false)
    bot.answers = 'failing'
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('We could not reach your bot.')
    await shot(page, 'home-bot-unreachable')
  })

  test(`live run cards and a live raid fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const bot = bot_fixture(1)
    await ready(page, bot)
    await open_tab(page, 'quest')
    await start(page).scrollIntoViewIfNeeded()
    await start(page).click()
    // The answer to a Start is on screen: the hero that is out heads the tab, above the setup.
    await expect(run(page, MIRA)).toBeInViewport({ timeout: 15_000 })
    expect(bottom(await box(run(page, MIRA)))).toBeLessThanOrEqual((await box(page.locator('[data-mode="fight"]'))).y)
    await expect(run(page, MIRA).locator('.dapp-run-drops')).toContainText('Wheat', { timeout: 15_000 })
    // A toast stands above the tab bar, never on it.
    const toasts = page.locator('[data-toasts]')
    await expect(toasts).toBeVisible({ timeout: 15_000 })
    if (phone) expect(bottom(await box(toasts))).toBeLessThanOrEqual((await box(page.locator('.dapp-tabs'))).y)
    await shot(page, 'quest-run')
    await open_tab(page, 'raid')
    await seat(page, 1, BRAN)
    await enter(page).click()
    await in_room(page, BRAN)
    await shot(page, 'raid-run')
    await open_tab(page, 'home')
    await expect(page.locator('.dapp-next')).toHaveAttribute('data-next', 'out')
    await shot(page, 'home-out')
  })
}
