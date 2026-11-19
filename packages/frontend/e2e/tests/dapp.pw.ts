// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page, type Route } from '@playwright/test'

const BOT = 'https://bot.fixture.invalid'
const OWNER = '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'
const [MIRA, BRAN] = [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`]
const NAMES: Readonly<Record<string, string>> = { [MIRA]: 'Mira', [BRAN]: 'Bran' }
// Thebes city checkpoint from seed/content/worlds.json, in chain coordinates; its dungeon is the Gilded Lorito.
const THEBES = { world: 'nauvis', checkpoint_world: 'nauvis', x: 50_512, z: 50_000 }
const KEY = 'key_of_gilded_lorito'

type Bot = {
  offline: boolean
  refresh_ok: boolean
  token_ok: boolean
  heroes: readonly string[]
  revision: number
  /** One retained tree per hosted hero, exactly like the real bot's hero runs. */
  runs: Map<string, unknown>
  keys: number
  xp: number
  wheat: number
  balance: bigint
  calls: string[]
  stops: string[]
  /** Reads that asked the bot to watch market offers: the page never does. */
  watches: number
  /** The bot account's one direct command, as the real bot observes it. */
  buys: Record<string, unknown>[]
  buy_refusal: string | null
  direct: unknown
}
const bot_fixture = (): Bot => ({
  offline: false,
  refresh_ok: true,
  token_ok: true,
  heroes: [MIRA, BRAN],
  revision: 10,
  runs: new Map(),
  keys: 0,
  xp: 120,
  wheat: 2,
  balance: 2_000_000_000n,
  calls: [],
  stops: [],
  watches: 0,
  buys: [],
  buy_refusal: null,
  direct: null,
})
/** The one public key offer: 0.5 SUI asked, 0.55 SUI paid with the royalty. */
const OFFER = {
  kind: 'item',
  id: `0x${'7'.repeat(64)}`,
  version: '5',
  name: 'Key of the Gilded Lorito',
  item_type: KEY,
  category: 'key',
  level: 8,
  amount: 1,
  price_mist: '500000000',
  kiosk: `0x${'8'.repeat(64)}`,
  seller: `0x${'9'.repeat(64)}`,
  at_ms: 1,
  group_key: 'lot-1',
}

const leaf = (bot: Bot, hero: string, type: string) =>
  JSON.stringify(bot.runs.get(hero) ?? null).includes(`"type":"${type}"`)
/** Heroes whose trees hunt as a team share one fight; a raiding hero stands in its dungeon run. */
const character = (bot: Bot, id: string) => ({
  id,
  name: NAMES[id],
  classe: 'yogan',
  sex: 'male',
  level: 3,
  experience: String(bot.xp),
  color_1: 1,
  color_2: 2,
  color_3: 3,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 5,
  chance: 0,
  agility: 0,
  available_points: 5,
  spells: {},
  available_spell_points: 2,
  jobs: { farmer: '10' },
  kiosk: '0xkiosk',
  equipment: [],
  custody: 'kiosk',
  ...THEBES,
  ...(leaf(bot, id, 'join') ? { custody: 'fight', active_fight: { id: 'fight-1', seat: bot.heroes.indexOf(id) } } : {}),
  ...(leaf(bot, id, 'dungeon') ? { dungeon_run: { dungeon: 'gilded_lorito', room: 1 } } : {}),
})
const item = (item_type: string, name: string, category: string, amount: number) => ({
  id: `${item_type}-1`,
  version: '1',
  name,
  item_type,
  category,
  level: 1,
  amount,
  kiosk: '0xkiosk',
})
const observation = (bot: Bot) => ({
  ready: true,
  decision_revision: 3,
  observation_revision: bot.revision,
  event_fence: 1,
  sampled_at: performance.now(),
  characters: bot.heroes.map((id) => character(bot, id)),
  health: Object.fromEntries(bot.heroes.map((id) => [id, { current: 52, maximum: 65 }])),
  inventory: {
    loaded: true,
    items: [
      item('wheat', 'Wheat', 'resource', bot.wheat),
      ...(bot.keys ? [item(KEY, 'Key of the Gilded Lorito', 'key', bot.keys)] : []),
    ],
    listings: [],
    trades: [],
  },
  direct: bot.direct,
  balance: { address: '0xagent', balance_mist: String(bot.balance) },
  // Like the real bot, each run reports the catalogue entry its script declared.
  runs: [...bot.runs].map(([id, script]) => ({
    id: `run-${NAMES[id]}`,
    character_id: id,
    status: 'active',
    strategy: (script as { strategy?: string }).strategy,
  })),
})

/** The stand-in signs at once: the key lands in the bag, or the bot's own validation refuses the offer. */
const bought = (bot: Bot, action: Record<string, unknown>) => {
  bot.buys.push(action)
  bot.revision += 1
  const command = { id: `command-${bot.buys.length}`, kind: 'market_buy', payload: action }
  if (bot.buy_refusal) bot.direct = { ...command, status: 'failed', error: `Error: ${bot.buy_refusal}` }
  else {
    bot.direct = { ...command, status: 'completed' }
    bot.keys += 1
    bot.balance -= BigInt(String(action.max_total_mist))
  }
  return { command_id: command.id, status: 'accepted' }
}
const tool_result = (content: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: content, isError: false } }),
})
/** A tree acts for exactly one hero: the first one it names. */
const tree_hero = (script: unknown) => /"character_id":"(0x[0-9a-f]+)"/.exec(JSON.stringify(script))![1]!

const tools = (bot: Bot, name: string, args: Record<string, unknown>): unknown => {
  const hero = String(args.character_id)
  switch (name) {
    case 'bot_identity':
      return {
        owner: OWNER,
        bot_id: 'bot',
        address: '0xagent',
        descriptor: 'descriptor',
        generation: 1,
        grant_id: 'grant',
        network: 'mainnet',
        expires_at: 1,
      }
    case 'bot_observe':
      // Each observation of a running hero shows the bot progressing: experience, loot, fees.
      if (bot.runs.size) {
        bot.revision += 1
        bot.xp += 40
        bot.wheat += 3
        bot.balance -= 1_000_000n
      }
      bot.watches += Number('market' in args)
      return observation(bot)
    case 'bot_market_buy':
      return bought(bot, args.action as Record<string, unknown>)
    case 'bot_start_behavior':
      bot.runs.set(tree_hero(args.script), args.script)
      return { id: 'run', character_id: tree_hero(args.script), status: 'active' }
    case 'bot_stop_behavior':
      bot.runs.delete(hero)
      bot.stops.push(hero)
      return { id: 'run', character_id: hero, status: 'stopped' }
    case 'bot_behavior_status':
      return { id: 'run', character_id: hero, script: bot.runs.get(hero) }
    default:
      return { command_id: 'command-1', status: 'accepted' }
  }
}
type Handler = (bot: Bot, route: Route, body: Record<string, unknown>) => Promise<void>
const authorize: Handler = (_bot, route) => {
  // The real bot sends consent through `/world`; the shared consent modal is covered by agent_setup.
  const request = route.request()
  const base = request.headers().referer ?? String(test.info().project.use.baseURL)
  const back = new URL('/e2e/fixtures/dapp.html', new URL(base).origin)
  back.search = `signed_in&code=g.code&state=${new URL(request.url()).searchParams.get('state')}&iss=${encodeURIComponent(BOT)}`
  return route.fulfill({ status: 302, headers: { location: back.href } })
}
const token: Handler = (bot, route, body) => {
  if (body.grant_type === 'refresh_token' && !bot.refresh_ok)
    return route.fulfill({ status: 400, json: { error: 'invalid_grant' } })
  bot.token_ok = true
  return route.fulfill({
    json: {
      access_token: `g.a${bot.calls.length}`,
      refresh_token: 'g.r',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'bot:observe bot:play bot:pause',
    },
  })
}
type Seen = ReturnType<typeof observation>
/**
 * The dapp reads heroes, bag and balance from the game socket, never from the bot. The fixture page
 * stands in for the game server: each bot answer is preceded by the push of the same account.
 */
const push_account = (route: Route, { characters, inventory, balance }: Seen) =>
  route
    .request()
    .frame()
    .evaluate((account) => (window as unknown as { push_account: (rows: unknown) => void }).push_account(account), {
      characters,
      items: inventory.items,
      balance_mist: balance.balance_mist,
    })
const mcp: Handler = async (bot, route, body) => {
  if (!bot.token_ok) return route.fulfill({ status: 401, json: { error: 'invalid_token' } })
  const params = body.params as { name: string; arguments: Record<string, unknown> }
  bot.calls.push(params.name)
  const answer = tools(bot, params.name, params.arguments)
  if (params.name === 'bot_observe') await push_account(route, answer as Seen)
  return route.fulfill(tool_result(answer))
}
/** A deterministic stand-in for the hosted bot's OAuth and MCP surface, never a real service. */
const ROUTES: Readonly<Record<string, Handler>> = {
  '/oauth/register': (_bot, route) => route.fulfill({ status: 201, json: { client_id: 'fixture-client' } }),
  '/authorize': authorize,
  '/oauth/token': token,
  '/oauth/revoke': (bot, route) => {
    bot.calls.push('revoke')
    return route.fulfill({ json: {} })
  },
  '/mcp': mcp,
}
const serve = (bot: Bot) => async (route: Route) => {
  if (bot.offline) return route.abort('failed')
  const request = route.request()
  const handler = ROUTES[new URL(request.url()).pathname]
  if (!handler) return route.fulfill({ status: 404, json: { error: 'not_found' } })
  return handler(bot, route, request.postData() ? (JSON.parse(request.postData()!) as Record<string, unknown>) : {})
}

const open = async (page: Page, bot: Bot, query = 'signed_in') => {
  await page.route(`${BOT}/**`, serve(bot))
  // The public offers the stand-in game socket pushes for the item on screen.
  await page.addInitScript((offers) => Object.assign(window, { market_offers: offers }), [OFFER])
  await page.goto(`/e2e/fixtures/dapp.html?${query}`)
}
const connect = async (page: Page, bot: Bot) => {
  await open(page, bot)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  // The consent round trip reloads the page; a cold dev compile can take a while.
  await expect(page.getByRole('heading', { name: 'Your heroes' })).toBeVisible({ timeout: 45_000 })
}
const no_overflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)

/** Real entry checks stay on this machine: every request to another host is refused before it leaves. */
const local_only = (page: Page) =>
  page.route(
    (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient')
  )

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

test('signed out, the dapp asks for Google sign-in and offers no bot controls', async ({ page }) => {
  await open(page, bot_fixture(), '')
  await expect(page.getByRole('heading', { name: 'Send your heroes on expeditions' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start training/ })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Interface mode' })).toBeVisible()
})

test('an offline bot service leaves the connect step with a plain retryable message', async ({ page }) => {
  const bot = bot_fixture()
  bot.offline = true
  await open(page, bot)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(/not answering/)
})

test('a bot with no heroes explains how heroes arrive', async ({ page }) => {
  const bot = bot_fixture()
  bot.heroes = []
  await connect(page, bot).catch(() => undefined)
  await expect(page.getByRole('heading', { name: 'Your bot has no heroes yet' })).toBeVisible()
})

const card = (page: Page, activity: string) => page.locator(`[data-activity="${activity}"]`)
const position = (page: Page, title: string) => page.locator('.dapp-position', { hasText: title })
const starts = (bot: Bot) => bot.calls.filter((name) => name === 'bot_start_behavior')

/** Advanced acts on one hero at a time: two heroes run different activities, and one stops alone. */
const parallel = async (page: Page, bot: Bot) => {
  await page.getByRole('button', { name: 'Advanced' }).click()
  await page.locator('button.dapp-hero', { hasText: 'Mira' }).click()
  await card(page, 'train').getByRole('button', { name: 'Start training' }).dblclick()
  await expect(position(page, 'Train · Mira')).toContainText('Working')
  // A hosted hero shows its activity and a Stop, never a second Start.
  await expect(card(page, 'train').getByRole('button', { name: 'Start training' })).toHaveCount(0)
  await expect(card(page, 'gather')).toContainText('No hero is free for this right now.')
  await page.locator('button.dapp-hero', { hasText: 'Bran' }).click()
  await card(page, 'gather').getByRole('button', { name: 'Start gathering' }).click()
  await expect(position(page, 'Gather · Bran')).toContainText('Working')
  expect(starts(bot)).toHaveLength(2)
  // Each hero's card folds its own experience; the shared bag and the fees are told once.
  await expect(position(page, 'Train · Mira')).toContainText(/\+[1-9]/, { timeout: 15_000 })
  await expect(page.locator('.dapp-haul')).toContainText('SUI used')
  await expect(page.locator('.dapp-haul')).toContainText(/×[1-9]/, { timeout: 15_000 })
  await expect(page.getByText(/\+\d+ Wheat/).first()).toBeVisible({ timeout: 15_000 })
  await position(page, 'Train · Mira').getByRole('button', { name: 'Stop' }).click()
  await expect(position(page, 'Train · Mira')).toContainText('Finished')
  await expect(position(page, 'Gather · Bran')).toContainText('Working')
  expect(bot.stops).toEqual([MIRA])
}

/** Basic sends the whole free team: one tree per hero naming the other, and the fight they share. */
const team_hunt = async (page: Page, bot: Bot) => {
  // Basic says what it will do by itself for the seed's class before anything is sent.
  await expect(page.getByText(/Archer heroes also grow by themselves: stat points go to Intelligence/)).toBeVisible()
  await expect(card(page, 'train')).toContainText('Ready: Mira, Bran')
  await card(page, 'train').getByRole('button', { name: 'Start training' }).dblclick()
  await expect(position(page, 'Train · Mira')).toContainText('Fighting with Bran', { timeout: 15_000 })
  await expect(position(page, 'Train · Bran')).toContainText('Fighting with Mira')
  expect(starts(bot)).toHaveLength(2)
  expect(JSON.stringify(bot.runs.get(MIRA))).toContain(`{"type":"join","character_id":"${MIRA}","allies":["${BRAN}"]}`)
  await expect(card(page, 'train')).toContainText('Out now: Mira, Bran')
  await expect(card(page, 'gather')).toContainText('No hero is free for this right now.')
}

/** One key per hero: both raid trees are sent and each position shows its dungeon room. */
const raid = async (page: Page, bot: Bot) => {
  await card(page, 'raid').getByRole('button', { name: 'Start raid' }).click()
  await expect(position(page, 'Raid · Mira')).toContainText('Gilded Lorito · room 1', { timeout: 15_000 })
  await expect(position(page, 'Raid · Bran')).toContainText('Gilded Lorito · room 1')
  expect(starts(bot)).toHaveLength(2)
  expect(JSON.stringify(bot.runs.get(BRAN))).toContain(`"dungeon":"gilded_lorito"`)
  expect(JSON.stringify(bot.runs.get(BRAN))).toContain(`"allies":["${MIRA}"]`)
}

/** No key at all: the blocker and its single fix show, and no tree can be sent. */
const raid_blocked = async (page: Page, bot: Bot) => {
  await expect(card(page, 'raid')).toContainText('Mira, Bran: no key for this dungeon.')
  await expect(card(page, 'raid')).toContainText('Missing: 2 × Key of the Gilded Lorito')
  await expect(card(page, 'raid').getByRole('button', { name: 'Start raid' })).toBeDisabled()
  expect(starts(bot)).toEqual([])
}

/** One key for two heroes: the player reads who enters and how to get the missing key, then chooses. */
const raid_short = async (page: Page, bot: Bot) => {
  await expect(card(page, 'raid')).toContainText('Ready: Mira')
  await expect(card(page, 'raid')).toContainText('Bran: no key for this dungeon.')
  const notice = page.getByRole('dialog', { name: 'Not enough keys for the whole team' })
  await card(page, 'raid').getByRole('button', { name: 'Start raid' }).click()
  await expect(notice).toContainText('You have enough keys for 1 only, so only Mira will enter the dungeon.')
  await expect(notice).toContainText('find or buy the missing keys')
  await expect(notice).toContainText('Missing: 1 × Key of the Gilded Lorito')
  // The fix is the market listing, never a price or a purchase on this page.
  await expect(notice.getByRole('button', { name: 'Find Key of the Gilded Lorito on the market' })).toBeVisible()
  await expect(notice).not.toContainText('SUI')
  expect(starts(bot)).toEqual([])
  await no_overflow(page)
  await page.screenshot({ path: test.info().outputPath(`raid-notice-${page.viewportSize()!.width}.png`) })
  // Cancelling sends nothing; the card keeps its own fix.
  await notice.getByRole('button', { name: 'Cancel' }).click()
  await expect(notice).toHaveCount(0)
  await expect(card(page, 'raid')).toContainText('Missing: 1 × Key of the Gilded Lorito')
  expect(starts(bot)).toEqual([])
  await card(page, 'raid').getByRole('button', { name: 'Start raid' }).click()
  await notice.getByRole('button', { name: 'Start raid with 1' }).click()
  await expect(notice).toHaveCount(0)
  await expect(position(page, 'Raid · Mira')).toContainText('Gilded Lorito · room 1', { timeout: 15_000 })
  // Exactly the hero that holds a key was sent, alone: the bot's entry rule holds for its tree.
  expect(starts(bot)).toHaveLength(1)
  expect(JSON.stringify(bot.runs.get(MIRA))).toContain('"dungeon":"gilded_lorito"')
  expect(JSON.stringify(bot.runs.get(MIRA))).toContain('"allies":[]')
  expect(bot.runs.has(BRAN)).toBe(false)
}

/** From the short raid's fix to the key's offers in the market, which trades as the bot account. */
const open_key_market = async (page: Page) => {
  await expect(card(page, 'raid')).toContainText('Bran: no key for this dungeon.')
  await card(page, 'raid').getByRole('button', { name: 'Find Key of the Gilded Lorito on the market' }).click()
  await page.getByRole('button', { name: 'I understand' }).click()
  await expect(page.getByText(/This market trades as your bot/)).toBeVisible()
  // The price is shown here and only here, beside the bot's own balance.
  await expect(page.locator('.dapp-chip')).toContainText(/Bot: 2(\.00)? SUI/)
  const buy = page.locator('[data-marketplace-cheapest-lot="1"]').getByRole('button', { name: 'Buy' })
  await expect(buy).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('.dapp-market')).toContainText('0.55')
  // The bot account sells items and has no sales ledger here.
  const tabs = page.getByRole('group', { name: 'Marketplace' })
  await expect(tabs.getByRole('button', { name: 'Sell', exact: true })).toBeVisible()
  await expect(tabs.getByRole('button', { name: 'History', exact: true })).toHaveCount(0)
  await no_overflow(page)
  await page.screenshot({ path: test.info().outputPath(`market-${page.viewportSize()!.width}.png`), fullPage: true })
  return buy
}

/** One key for two heroes: the missing key is bought as the bot, lands in its bag, and both heroes enter. */
const buy_key_then_raid = async (page: Page, bot: Bot) => {
  const buy = await open_key_market(page)
  await buy.dblclick()
  const notice = page.locator('[data-order]')
  await expect(notice).toContainText("Bought: 1 × Key of the Gilded Lorito. It is in your heroes' bag.", {
    timeout: 15_000,
  })
  // One command, capped at the total the player saw.
  expect(bot.buys).toHaveLength(1)
  expect(bot.buys[0]).toMatchObject({ item_id: OFFER.id, price_mist: '500000000', max_total_mist: '550000000' })
  await expect(page.locator('.dapp-chip')).toContainText('Bot: 1.45 SUI')
  await no_overflow(page)
  await notice.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'raid')).toContainText('Ready: Mira, Bran')
  await raid(page, bot)
}

/** The bot refuses the offer when it takes its turn: one plain reason, nothing bought, the raid still short. */
const buy_refused = async (page: Page, bot: Bot) => {
  bot.buy_refusal = 'listing_changed_or_ineligible'
  const buy = await open_key_market(page)
  await buy.click()
  const notice = page.locator('[data-order="refused"]')
  await expect(notice.getByRole('alert')).toContainText(/This offer changed or is gone\. Check the current price/, {
    timeout: 15_000,
  })
  await expect(notice).not.toContainText('listing_changed')
  expect(bot.buys).toHaveLength(1)
  await expect(page.locator('.dapp-chip')).toContainText(/Bot: 2(\.00)? SUI/)
  await no_overflow(page)
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.locator('[data-order]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(card(page, 'raid')).toContainText('Missing: 1 × Key of the Gilded Lorito')
  expect(starts(bot)).toEqual([])
}

const SCENARIOS: readonly Readonly<{ name: string; keys: number; run: (page: Page, bot: Bot) => Promise<void> }>[] = [
  { name: 'two heroes run different activities in parallel', keys: 0, run: parallel },
  { name: 'a team hunt sends both heroes into one fight', keys: 0, run: team_hunt },
  { name: 'a raid starts with one key per hero', keys: 2, run: raid },
  { name: 'a raid short of keys asks first, then sends only the hero that holds one', keys: 1, run: raid_short },
  { name: 'a raid without any key is blocked before any tree is sent', keys: 0, run: raid_blocked },
  { name: 'a missing key is bought as the bot account and its hero joins the raid', keys: 1, run: buy_key_then_raid },
  { name: 'a refused purchase says why and buys nothing', keys: 1, run: buy_refused },
]
for (const width of [360, 400, 1280])
  for (const { name, keys, run } of SCENARIOS)
    test(`${name}, and fits ${width}px without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 })
      const bot = bot_fixture()
      bot.keys = keys
      await connect(page, bot)
      await run(page, bot)
      await no_overflow(page)
      await page.screenshot({ path: test.info().outputPath(`board-${width}.png`), fullPage: true })
    })

test('stopping the team from its card stops every hero once, and finished positions stay until dismissed', async ({
  page,
}) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await team_hunt(page, bot)
  await card(page, 'train').getByRole('button', { name: 'Stop' }).click()
  await expect(position(page, 'Train · Mira')).toContainText('Finished')
  await expect(position(page, 'Train · Bran')).toContainText('Finished')
  expect(bot.stops.toSorted()).toEqual([MIRA, BRAN])
  await page.getByRole('button', { name: 'Dismiss' }).first().click()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('Start an activity to follow its progress here.')).toBeVisible()
  await expect(page.locator('.dapp-haul')).toHaveCount(0)
})

test('a run the bot ends by itself finishes on the page from the pushed status, with no read', async ({ page }) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await team_hunt(page, bot)
  const calls = bot.calls.length
  const status = { ready: true, event_fence: 1, sampled_at: performance.now(), state: 'idle', direct: null, runs: [] }
  await page.evaluate(
    (pushed) => (window as unknown as { push_status: (s: unknown) => void }).push_status(pushed),
    status
  )
  await expect(position(page, 'Train · Bran')).toContainText('Finished')
  expect(bot.calls).toHaveLength(calls)
})

test('a reload shows every running hero again, named by the strategy the bot reports for its run', async ({ page }) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await team_hunt(page, bot)
  const reads = () => bot.calls.filter((name) => name === 'bot_behavior_status')
  await page.reload()
  await expect(position(page, 'Train · Mira')).toContainText('Working', { timeout: 45_000 })
  await expect(position(page, 'Train · Bran')).toContainText('Working')
  expect(starts(bot)).toHaveLength(2)
  // The observation alone names the runs: no retained tree is read back.
  expect(reads()).toEqual([])
})

test('the missing key links to its listing in the market, with no price and no purchase on the card', async ({
  page,
}) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await raid_blocked(page, bot)
  await expect(card(page, 'raid')).not.toContainText('SUI')
  await card(page, 'raid').getByRole('button', { name: 'Find Key of the Gilded Lorito on the market' }).click()
  await expect(page.getByRole('button', { name: 'Market', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The offers come from the page's own game socket; the bot is never asked to watch them.
  await page.getByRole('button', { name: 'I understand' }).click()
  await expect(page.locator('.dapp-market')).toContainText('0.55', { timeout: 15_000 })
  expect(bot.watches).toBe(0)
})

test('an expired grant that cannot refresh returns to Connect with an honest message', async ({ page }) => {
  const bot = bot_fixture()
  await connect(page, bot)
  bot.token_ok = false
  bot.refresh_ok = false
  await card(page, 'train').getByRole('button', { name: 'Start training' }).click()
  await expect(page.getByRole('alert')).toHaveText(/connection expired/, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
})

test('disconnect revokes this page grant once and forgets it on this device', async ({ page }) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await page.getByRole('button', { name: 'Disconnect this page' }).click()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect.poll(() => bot.calls.filter((name) => name === 'revoke').length).toBe(1)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
})

test('advanced mode opens the game character tabs and sends a spell rank through the bot', async ({ page }) => {
  const bot = bot_fixture()
  await connect(page, bot)
  await page.getByRole('button', { name: 'Advanced' }).click()
  await expect(page.getByRole('heading', { name: 'Mira in detail' })).toBeVisible()
  await page.getByRole('button', { name: 'Spells' }).click()
  await page
    .getByRole('button', { name: /Level up/ })
    .first()
    .click()
  await expect.poll(() => bot.calls.includes('bot_raise_spell')).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-pressed', 'true')
})
