// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A deterministic stand-in for the hosted bot's OAuth and MCP surface, for the game server's push of the
// bot account, and for the game server's socket of the page. It is never a real service: every request
// and every packet is answered inside the browser test.
import { test, type Page, type Route, type WebSocketRoute } from '@playwright/test'

export const BOT = 'https://bot.fixture.invalid'
const OWNER = '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'
const [AGENT, KIOSK] = ['0xagent', '0xkiosk']
export const [MIRA, BRAN, NOVA] = ['1', '2', '3'].map((digit) => `0x${digit.repeat(64)}`) as [string, string, string]
// Thebes city checkpoint from seed/content/worlds.json, in chain coordinates; its dungeon is the Gilded Lorito.
const THEBES = { world: 'nauvis', checkpoint_world: 'nauvis', x: 50_512, z: 50_000 }
export const KEY = 'key_of_gilded_lorito'
export const HOOD = 'lorito_hat__molted'
/** The price of a hero, in MIST: `CHARACTER_PRICE_MIST` of the SDK. */
const HERO_PRICE = 10_000_000_000n

type Row = Readonly<Record<string, unknown>>
type Item = Readonly<{
  id: string
  version: string
  name: string
  item_type: string
  category: string
  level: number
  amount: number
  kiosk: string
}>
type Listing = Item & Readonly<{ kind: 'item'; price_mist: string; seller: string; at_ms: number }>
/** A public offer: a listing of another account, in the lot the market groups it by. */
type Offer = Listing & Readonly<{ group_key: string }>
/** One packet of the game socket, either way. */
export type Packet = Readonly<Record<string, unknown> & { type: string }>
type Worn = Omit<Item, 'kiosk' | 'version'> & Readonly<{ slot: string }>
/** Seed facts of the items the stand-in bag can hold (seed/content/items.json). */
const ITEMS: Readonly<Record<string, Pick<Item, 'name' | 'category' | 'level'>>> = {
  wheat: { name: 'Wheat', category: 'resource', level: 1 },
  water: { name: 'Water', category: 'resource', level: 1 },
  wheat_flour: { name: 'Wheat Flour', category: 'resource', level: 1 },
  [KEY]: { name: 'Key of the Gilded Lorito', category: 'key', level: 8 },
  [HOOD]: { name: 'Molted Lorito Hood', category: 'hat', level: 3 },
}
/** One stack of the stand-in bag, in the heroes' kiosk. */
export const item = (item_type: string, amount: number): Item => ({
  id: `${item_type}-1`,
  version: '1',
  ...ITEMS[item_type]!,
  item_type,
  amount,
  kiosk: KIOSK,
})

export type Bot = {
  /** The whole service is down: nothing answers, so no connection can be made. */
  offline: boolean
  refresh_ok: boolean
  token_ok: boolean
  /** What a read of the bot answers: its state, a baseline still pending, or a failure. */
  answers: 'ready' | 'pending' | 'failing'
  /** A read waits for this before it answers; the game server's push never waits for the bot. */
  gate: Promise<void> | null
  heroes: { id: string; name: string }[]
  revision: number
  /** One retained tree per hosted hero, exactly like the real bot's hero runs. */
  runs: Map<string, { strategy?: string; objective?: unknown }>
  bag: Item[]
  listings: Listing[]
  worn: Record<string, Worn[]>
  xp: number
  balance: bigint
  fees: bigint
  calls: string[]
  stops: string[]
  /** Reads that asked the bot to watch market offers: the page never does. */
  watches: number
  /** Every direct command the bot was sent, in order: its kind and its typed action. */
  directs: { kind: string; action: Row }[]
  /** The bot's own validation refuses the next direct commands with this code. */
  refusal: string | null
  /** The bot account's one direct command, as the real bot observes it. */
  direct: unknown
  /** The public offers of the dungeon key: what the game socket answers a market that watches it. */
  offers: Offer[]
  /** Every packet the page sent on its game socket, in order. */
  packets: Packet[]
}
/** The one public key offer: 0.5 SUI asked, 0.55 SUI paid with the royalty. */
export const OFFER: Offer = {
  ...item(KEY, 1),
  kind: 'item',
  id: `0x${'7'.repeat(64)}`,
  version: '5',
  price_mist: '500000000',
  kiosk: `0x${'8'.repeat(64)}`,
  seller: `0x${'9'.repeat(64)}`,
  at_ms: 1,
  group_key: 'lot-1',
}
export const bot_fixture = (keys = 0): Bot => ({
  offline: false,
  refresh_ok: true,
  token_ok: true,
  answers: 'ready',
  gate: null,
  heroes: [
    { id: MIRA, name: 'Mira' },
    { id: BRAN, name: 'Bran' },
  ],
  revision: 10,
  runs: new Map(),
  bag: [item('wheat', 2), item(HOOD, 1), ...(keys ? [item(KEY, keys)] : [])],
  listings: [],
  worn: {},
  xp: 120,
  balance: 2_000_000_000n,
  fees: 0n,
  calls: [],
  stops: [],
  watches: 0,
  directs: [],
  refusal: null,
  direct: null,
  offers: [OFFER],
  packets: [],
})
/** Holds every read of the bot from now on; the returned function lets them answer. */
export const hold = (bot: Bot): (() => void) => {
  const gate = Promise.withResolvers<void>()
  bot.gate = gate.promise
  return () => {
    bot.gate = null
    gate.resolve()
  }
}
export const calls_of = (bot: Bot, name: string) => bot.calls.filter((call) => call === name)
export const directs_of = (bot: Bot, kind: string) => bot.directs.filter((direct) => direct.kind === kind)
/** The packets of one type the page sent on its game socket, in order. */
export const sent_of = (bot: Bot, type: string) => bot.packets.filter((packet) => packet.type === type)
/** The tree the bot retains for one hero, as text. */
export const tree_of = (bot: Bot, hero: string) => JSON.stringify(bot.runs.get(hero) ?? null)

const leaf = (bot: Bot, hero: string, type: string) => tree_of(bot, hero).includes(`"type":"${type}"`)
/** Heroes whose trees hunt as a team share one fight; a raiding hero stands in its dungeon run. */
const character = (bot: Bot, { id, name }: Bot['heroes'][number], seat: number) => ({
  id,
  name,
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
  jobs: { FARMER: '10' },
  kiosk: KIOSK,
  equipment: bot.worn[id] ?? [],
  custody: 'kiosk',
  ...THEBES,
  ...(leaf(bot, id, 'join') ? { custody: 'fight', active_fight: { id: 'fight-1', seat } } : {}),
  ...(leaf(bot, id, 'dungeon') ? { dungeon_run: { dungeon: 'gilded_lorito', room: 1 } } : {}),
})
/** The fight each running hero last won, with its loot: the game server lists it until it is settled. */
const resolution = (bot: Bot, hero: string, fighter: number) => ({
  fight: `fight-${bot.revision}`,
  world: 'nauvis',
  dungeon: leaf(bot, hero, 'dungeon') ? 'gilded_lorito' : null,
  dungeon_room: leaf(bot, hero, 'dungeon') ? 1 : null,
  kolizeum: null,
  fighter,
  character: hero,
  team: 0,
  winner: 0,
  dead: false,
  settled: false,
  boss_weight: 0,
  kares: '0',
  loot_types: ['wheat'],
  drops: [{ item_type: 'wheat', qty: 3 }],
})
const observation = (bot: Bot) => ({
  ready: true,
  decision_revision: 3,
  observation_revision: bot.revision,
  event_fence: 1,
  sampled_at: performance.now(),
  characters: bot.heroes.map((hero, seat) => character(bot, hero, seat)),
  inventory: { loaded: true, items: bot.bag, listings: bot.listings, trades: [] },
  resolutions: [...bot.runs.keys()].map((hero, fighter) => resolution(bot, hero, fighter)),
  direct: bot.direct,
  balance: { address: AGENT, balance_mist: String(bot.balance) },
  fees_mist: String(bot.fees),
  // Like the real bot, each run reports the catalogue entry and the objective its script declared.
  runs: [...bot.runs].map(([id, script]) => ({
    id: `run-${id.slice(2, 4)}`,
    character_id: id,
    status: 'active',
    strategy: script.strategy,
    objective: script.objective,
    fees_mist: String(bot.fees),
  })),
})
type Seen = ReturnType<typeof observation>

const gain = (bot: Bot, item_type: string, amount: number) => {
  const held = bot.bag.find((row) => row.item_type === item_type)
  bot.bag = held
    ? bot.bag.map((row) =>
        row === held ? { ...row, amount: row.amount + amount, version: String(bot.revision) } : row
      )
    : [...bot.bag, { ...item(item_type, amount), version: String(bot.revision) }]
}
/** A stack gives units up; an emptied stack leaves the bag. */
const spend = (bot: Bot, item_type: string, amount: number) => {
  bot.bag = bot.bag.flatMap((row) => {
    if (row.item_type !== item_type) return [row]
    return row.amount > amount ? [{ ...row, amount: row.amount - amount, version: String(bot.revision) }] : []
  })
}
/** The one recipe the stand-in knows, per try (seed/content/recipes.json, wheat_flour). Every try succeeds here. */
const FLOUR = { wheat: 2, water: 1 }
/** What a direct command the bot signed changed in its account, by kind; any other kind changes nothing here. */
const EFFECTS: Readonly<Record<string, (bot: Bot, action: Row) => void>> = {
  market_buy: (bot, action) => {
    gain(bot, String(action.item_type), Number(action.amount))
    bot.balance -= BigInt(String(action.max_total_mist))
  },
  market_sell: (bot, action) => {
    const sold = bot.bag.find(({ id }) => id === action.item_id)!
    bot.bag = bot.bag.filter((row) => row !== sold)
    const lot = { kind: 'item', price_mist: String(action.price_mist), seller: AGENT, at_ms: 1 } as const
    bot.listings = [...bot.listings, { ...sold, ...lot, version: String(bot.revision) }]
  },
  market_delist: (bot, action) => {
    const {
      kind: _kind,
      price_mist: _price,
      seller: _seller,
      at_ms: _at,
      ...back
    } = bot.listings.find(({ id }) => id === action.item_id)!
    bot.listings = bot.listings.filter(({ id }) => id !== action.item_id)
    bot.bag = [...bot.bag, { ...back, version: String(bot.revision) }]
  },
  create_character: (bot, action) => {
    bot.heroes = [...bot.heroes, { id: NOVA, name: String(action.name) }]
    bot.balance -= HERO_PRICE
  },
  craft: (bot, action) => {
    const tries = Number(action.attempts)
    for (const [input, units] of Object.entries(FLOUR)) spend(bot, input, units * tries)
    gain(bot, String(action.output_type), tries)
  },
  equip_item: (bot, action) => {
    const hero = String(action.character_id)
    const { kiosk: _kiosk, version: _version, ...gear } = bot.bag.find(({ id }) => id === action.item_id)!
    bot.bag = bot.bag.filter(({ id }) => id !== action.item_id)
    bot.worn = { ...bot.worn, [hero]: [...(bot.worn[hero] ?? []), { ...gear, slot: String(action.slot) }] }
  },
}
/** The stand-in signs at once: the account changes, or the bot's own validation refuses the command. */
const direct = (bot: Bot, kind: string, action: Row) => {
  bot.directs.push({ kind, action })
  bot.revision += 1
  const command = { id: `command-${bot.directs.length}`, kind, payload: action }
  if (bot.refusal) bot.direct = { ...command, status: 'failed', error: `Error: ${bot.refusal}` }
  else {
    bot.direct = { ...command, status: 'completed' }
    EFFECTS[kind]?.(bot, action)
  }
  return { command_id: command.id, status: 'accepted' }
}

const IDENTITY = {
  owner: OWNER,
  bot_id: 'bot',
  address: AGENT,
  descriptor: 'descriptor',
  generation: 1,
  grant_id: 'grant',
  network: 'mainnet',
  expires_at: 1,
}
/** A tree acts for exactly one hero: the first one it names. */
const tree_hero = (script: unknown) => /"character_id":"(0x[0-9a-f]+)"/.exec(JSON.stringify(script))![1]!
/** Each observation of a running hero shows the bot progressing: experience, loot, fees. */
const progress = (bot: Bot) => {
  if (!bot.runs.size) return
  bot.revision += 1
  bot.xp += 40
  gain(bot, 'wheat', 3)
  bot.balance -= 1_000_000n
  bot.fees += 1_000_000n
}
type Tool = (bot: Bot, args: Record<string, unknown>) => unknown
const TOOLS: Readonly<Record<string, Tool>> = {
  bot_identity: () => IDENTITY,
  bot_observe: (bot, args) => {
    progress(bot)
    bot.watches += Number('market' in args)
    return bot.answers === 'pending' ? { status: 'pending' } : observation(bot)
  },
  bot_start_behavior: (bot, { script }) => {
    bot.runs.set(tree_hero(script), script as { strategy?: string })
    return { id: 'run', character_id: tree_hero(script), status: 'active' }
  },
  bot_stop_behavior: (bot, { character_id }) => {
    bot.runs.delete(String(character_id))
    bot.stops.push(String(character_id))
    return { id: 'run', character_id, status: 'stopped' }
  },
  bot_behavior_status: (bot, { character_id }) => ({
    id: 'run',
    character_id,
    script: bot.runs.get(String(character_id)),
  }),
}
/** Every other tool is a direct command of the bot's gameplay catalogue: `bot_<kind>` with its typed action. */
const tool = (bot: Bot, name: string, args: Record<string, unknown>): unknown =>
  TOOLS[name]?.(bot, args) ?? direct(bot, name.replace(/^bot_/, ''), args.action as Row)

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
/**
 * The dapp reads heroes, bag, listings, fight results and balance from the game socket, never from the
 * bot. The fixture page stands in for the game server: each read of the bot is preceded by the push of
 * the same account, whether the bot then answers or not.
 */
const push_account = (route: Route, bot: Bot) => {
  const { characters, inventory, resolutions, balance }: Seen = observation(bot)
  const account = {
    characters,
    items: inventory.items,
    listings: inventory.listings,
    resolutions,
    kiosk_versions: { [KIOSK]: String(bot.revision) },
    balance_mist: balance.balance_mist,
  }
  return route
    .request()
    .frame()
    .evaluate(
      (pushed) => (window as unknown as { push_account: (rows: unknown) => void }).push_account(pushed),
      account
    )
}
const tool_result = (content: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: content, isError: false } }),
})
const mcp: Handler = async (bot, route, body) => {
  if (!bot.token_ok) return route.fulfill({ status: 401, json: { error: 'invalid_token' } })
  const params = body.params as { name: string; arguments: Record<string, unknown> }
  bot.calls.push(params.name)
  const answer = tool(bot, params.name, params.arguments)
  if (params.name !== 'bot_observe') return route.fulfill(tool_result(answer))
  // A page that reloads abandons its read: no account can be pushed to it and nobody waits for the answer.
  const reached = await push_account(route, bot).then(
    () => true,
    () => false
  )
  if (!reached) return route.abort().catch(() => undefined)
  if (bot.gate) await bot.gate
  return bot.answers === 'failing' ? route.abort('failed') : route.fulfill(tool_result(answer))
}
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

/** What the game server says first on this socket: the owner is in, and its own account holds no hero. */
const GREETING: readonly Packet[] = [
  { type: 'packet/connection_accepted', address: OWNER },
  { type: 'packet/characters', characters: [] },
  {
    type: 'packet/server_info',
    online: 1,
    online_characters: 0,
    indexing_lag: 0,
    current_epoch: null,
    chain_timestamp_ms: null,
    chain_sample_age_ms: null,
    market_volume: { day_mist: '93540000000', month_mist: '2853420000000', history_days: 30 },
  },
]
type Watch = Readonly<{ kind: string; category?: string; item_type?: string; request: number }>
const KEY_TYPE = { item_type: KEY, ...ITEMS[KEY]! }
/**
 * The public market holds the dungeon key and nothing else: the counts say so, its category lists it,
 * and its offers are the ones the test names. A market nobody watches is told nothing.
 */
const market_packets = (bot: Bot, watch: Watch | null): Packet[] => {
  if (!watch) return []
  const counts = { type: 'packet/market_counts', observation: watch, counts: { [KEY_TYPE.category]: 1 } }
  if (!['types', 'offers'].includes(watch.kind)) return [counts]
  const items = watch.category === KEY_TYPE.category ? [KEY_TYPE] : []
  const types = { type: 'packet/market_types', observation: watch, items }
  if (watch.kind !== 'offers') return [counts, types]
  const listings = watch.item_type === KEY ? bot.offers : []
  return [
    counts,
    types,
    { type: 'packet/market_slice', observation: watch, listings, kiosk_versions: {}, next_cursor: null },
  ]
}
/** The lowest price asked for each lot size, in MIST: what one floor read answers. */
const floor_prices = (offers: readonly Offer[]): Record<string, string> =>
  Object.fromEntries(
    offers
      .toSorted((one, other) => Number(BigInt(other.price_mist) - BigInt(one.price_mist)))
      .map(({ amount, price_mist }) => [String(amount), price_mist])
  )
/** What the game server answers to a packet of the page; any other packet is kept and not answered. */
const ANSWERS: Readonly<Record<string, (bot: Bot, packet: Packet) => Packet[]>> = {
  'packet/ping': (_bot, { id }) => [{ type: 'packet/pong', id }],
  'packet/market_observe': (bot, { observation }) => market_packets(bot, observation as Watch | null),
  'packet/market_floor_request': (bot, { id, item_type }) => [
    { type: 'packet/market_floor', id, prices: item_type === KEY ? floor_prices(bot.offers) : {} },
  ],
  // No sale was ever made here: the history of any item is read and empty. The units of an item that
  // exist are the ones on offer and the ones in the bot's bag.
  'packet/market_prices_observe': (bot, { observation }) => {
    if (!observation) return []
    const { item_type } = observation as { item_type: string }
    const stacks = [...bot.offers, ...bot.bag].filter((stack) => stack.item_type === item_type)
    const total_units = String(stacks.reduce((units, { amount }) => units + amount, 0))
    const history = { first_timestamp_ms: 0, sampled_at_ms: 1, buckets: [] }
    return [{ type: 'packet/market_prices', observation, history, total_units }]
  },
}
/**
 * The page's own socket to the game server: the owner is accepted with no proof, every packet the page
 * sends is kept in order, and the public market is answered. The bot account itself still arrives by
 * `push_account`, before each answer of the bot.
 */
const game_socket = (bot: Bot) => (socket: WebSocketRoute) => {
  const send = (packet: Packet) => socket.send(JSON.stringify(packet))
  GREETING.forEach(send)
  socket.onMessage((frame) => {
    const packet = JSON.parse(String(frame)) as Packet
    bot.packets.push(packet)
    ANSWERS[packet.type]?.(bot, packet).forEach(send)
  })
}

/**
 * The tab that started a bot consent keeps its request until the bot sends the player back: this is that
 * request, as the page stored it, for the visit that returns with `claimed`.
 */
export const pending_consent = (page: Page) =>
  page.addInitScript((issuer) => {
    if (!location.search.includes('claimed')) return
    const request = { issuer, owner: '0xowner', client_id: 'c', state: 's', verifier: 'v' }
    const grant = { redirect_uri: `${location.origin}/dapp`, scope: 'bot:observe bot:play bot:pause' }
    const pending = { ...request, ...grant, expires_at: Date.now() + 60_000 }
    sessionStorage.setItem('aresrpg:dapp:authorization', JSON.stringify(pending))
  }, BOT)
/** Real entry checks stay on this machine: every request to another host is refused before it leaves. */
export const local_only = (page: Page) =>
  page.route(
    (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient')
  )
/** Opens the dapp fixture page against the stand-in bot; `signed_in` signs the synthetic Google owner in. */
export const open_dapp = async (page: Page, bot: Bot, query = 'signed_in') => {
  // The sign-in code the session loads asks its providers for metadata: nothing leaves this machine.
  await local_only(page)
  await page.route(`${BOT}/**`, serve(bot))
  // The game server's socket is the one that names the address it serves.
  await page.routeWebSocket(/[?&]address=0x/, game_socket(bot))
  await page.goto(`/e2e/fixtures/dapp.html?${query}`)
}
