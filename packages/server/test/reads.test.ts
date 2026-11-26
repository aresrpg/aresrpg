// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The cluster buses over a fake Redis, and the exact money reads behind them: every read that turns
// stored rows into money, standings or counts keeps them exact or fails loudly.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { MARKET_PRICE_DAY_MS, tournament_coin_claims, type AllocationResult } from '@aresrpg/protocol'

import { blast_leaf, blast_proof_root } from '../src/allocation/blast_allowlist.ts'
import { verify_wallet_message } from '../src/auth.ts'
import type { Graph } from '../src/graph.ts'
import { channels } from '../src/protocol.ts'
import {
  cluster_online_count,
  create_graph_bus,
  create_mesh_bus,
  create_watcher,
  type BusRedis,
} from '../src/pubsub_bus.ts'
import { get_admin_overview_section } from '../src/reads/get_admin_overview.ts'
import { parse_analytics_totals, ZERO_TOTALS } from '../src/reads/get_analytics_totals.ts'
import { rank_member } from '../src/reads/get_leaderboard.ts'
import { get_market_history } from '../src/reads/get_market_history.ts'
import { get_market_prices, parse_price_bucket } from '../src/reads/get_market_prices.ts'
import { get_tournaments } from '../src/reads/get_tournaments.ts'
import { allocation_preview, hero_preview } from '../src/share_preview.ts'
import { create_suins_resolver } from '../src/suins.ts'
import { portrait_poster_url } from '../../frontend/src/components/portrait_share.ts'

import { create_player, settle, wire } from './harness.ts'

const DAY = 86_400_000
const address = (id: number): string => `0x${id.toString(16).padStart(64, '0')}`

/** One fake ioredis connection: subscriptions and publications are recorded, reads come from `store`. */
const fake_redis = (store: Partial<Record<keyof BusRedis, unknown>> = {}) => {
  const emitter = new EventEmitter()
  const calls: string[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.map(String)])
    }
  const redis = {
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    subscribe: record('subscribe'),
    unsubscribe: record('unsubscribe'),
    publish: record('publish'),
    setex: record('setex'),
    zadd: record('zadd'),
    expireat: record('expireat'),
    get: async () => null,
    scan: async () => ['0', []],
    mget: async () => [],
    zrange: async () => [],
    disconnect: () => void calls.push(['disconnect']),
    ...store,
  } as unknown as BusRedis
  return { redis, emitter, calls }
}
const pod = (
  addresses: readonly string[],
  characters: readonly string[] = [],
  agents: readonly string[] = [],
  sockets?: number
) => JSON.stringify({ addresses, characters, agents, sockets })

test('losing the graph connection kills the pod; a deliberate close does not', () => {
  const deaths: string[] = []
  for (const deliberate of [false, true]) {
    const subscriber = fake_redis()
    const bus = create_graph_bus({
      subscriber: subscriber.redis,
      publisher: fake_redis().redis,
      on_lost: (reason) => void deaths.push(reason),
    })
    if (deliberate) bus.close()
    subscriber.emitter.emit('end')
  }
  expect(deaths).toEqual(['graph connection ended'])
})

test('subscriptions are refcounted with a delayed release; a refused watch rolls back; a failed publish never rejects', async () => {
  const subscriber = fake_redis()
  const mesh = create_mesh_bus({ subscriber: subscriber.redis, publisher: fake_redis().redis, unsubscribe_grace_ms: 0 })
  for (const action of ['subscribe', 'subscribe', 'unsubscribe', 'unsubscribe', 'subscribe', 'unsubscribe'] as const)
    await mesh[action]('pos:w:0:0')
  await settle(1)
  expect(subscriber.calls.map(([name]) => name)).toEqual(['subscribe', 'unsubscribe'])
  let attempts = 0
  const flaky = fake_redis({
    subscribe: async () => {
      if (++attempts === 1) throw new Error('offline')
    },
  })
  const offline = fake_redis({ publish: async () => Promise.reject(new Error('max retries')) })
  const graph = create_graph_bus({ subscriber: flaky.redis, publisher: fake_redis().redis, on_lost: () => {} })
  const flaky_mesh = create_mesh_bus({ subscriber: flaky.redis, publisher: offline.redis })
  const watcher = create_watcher({ graph, mesh: flaky_mesh })
  const unhandled: unknown[] = []
  const record = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', record)
  try {
    void watcher.watch('pos:w:0:0', () => {})
    await settle(2)
    expect([watcher.has('pos:w:0:0'), unhandled]).toEqual([false, []])
    await watcher.watch('pos:w:0:0', () => {})
    expect([attempts, watcher.has('pos:w:0:0')]).toEqual([2, true])
    expect(await flaky_mesh.publish('pos:w:0:0', { kind: 'leave' })).toBeUndefined()
  } finally {
    process.off('unhandledRejection', record)
  }
  // An aborted watcher acquires and retains nothing.
  const controller = new AbortController()
  const aborted = create_watcher({ graph, mesh: flaky_mesh }, controller.signal)
  controller.abort()
  await aborted.watch('pos:w:1:0', () => {})
  expect(aborted.watched()).toEqual([])
})

test('the online count unions pod snapshots: one address on two pods counts once, a bot once, an expired pod not at all', async () => {
  const keys = ['pod:a', 'pod:b', 'pod:gone']
  let scans = 0
  const publisher = fake_redis({
    scan: async () => {
      scans++
      return ['0', keys]
    },
    // Each pod holds its signed-in players and its visitors: sockets add up, addresses are a union.
    mget: async () => [pod(['0xa', '0xb'], ['c1'], ['0xb'], 9), pod(['0xb', '0xc'], ['c1', 'c2'], ['0xb'], 5), null],
    zrange: async () => ['1787990400000', '1', '1787986800000', '2'],
  })
  const mesh = create_mesh_bus({ subscriber: fake_redis().redis, publisher: publisher.redis })
  const counts = await Promise.all(Array.from({ length: 20 }, () => mesh.cluster_online()))
  expect([counts[0], scans]).toEqual([{ online: 3, online_characters: 2, online_agents: 1, online_sockets: 14 }, 1])
  // A pod of an older build does not say how many sockets it holds: the total is then unknown, never a part.
  expect(cluster_online_count([pod(['0xa'], [], [], 4), pod(['0xb'])]).online_sockets).toBeNull()
  await mesh.heartbeat('pod-1', { addresses: ['0xa'], characters: ['c1'], agents: [] })
  await mesh.record_online({ online: 3, online_agents: 1 }, 1_800_000)
  await mesh.record_online({ online: 3, online_agents: null }, 1_800_000)
  expect(publisher.calls.filter(([name]) => name === 'setex')).toEqual([
    ['setex', 'pod:pod-1', '20', pod(['0xa'], ['c1'])],
  ])
  const sampled = publisher.calls.filter(([name]) => name === 'zadd').map(([, key]) => String(key).split(':')[1])
  expect([
    sampled.filter((name) => name === 'online').length,
    sampled.filter((name) => name === 'online_agents').length,
    sampled.filter((name) => name === 'online_players').length,
  ]).toEqual([10, 5, 5])
  expect(await mesh.online_samples(['analytics:online:day:0'])).toEqual([[1, 2]])
  const broken = create_mesh_bus({
    subscriber: fake_redis().redis,
    publisher: fake_redis({
      scan: async () => ['0', ['pod:x']],
      mget: async () => ['{}'],
      zrange: async () => ['1', 'broken'],
    }).redis,
  })
  await expect(broken.cluster_online()).rejects.toThrow('invalid shape')
  await expect(broken.online_samples(['analytics:online:day:0'])).rejects.toThrow('invalid sample')
})

test('one item write is read once per bus and reaches only its custodians, as a packet to the owning socket', async () => {
  const queries: string[] = []
  const item_graph = {
    close: async () => {},
    read: async (query: string, params?: Record<string, unknown>) => {
      queries.push(query)
      if (query.includes('WHERE k.id IN')) return [{ address: '0xold' }]
      return params?.id === '0xcape'
        ? [
            {
              item: { properties: { id: '0xcape', name: 'Cloak', item_type: 'cape', version: '9007199254740993' } },
              kiosk: '0xk',
              address: '0xme',
            },
          ]
        : []
    },
  }
  const subscriber = fake_redis()
  const bus = create_graph_bus({
    subscriber: subscriber.redis,
    publisher: fake_redis().redis,
    item_graph,
    on_lost: () => {},
  })
  const f = wire({ owns: false })
  const player = create_player({ ...f, pubsub: { ...f.pubsub, graph: bus, emitter: bus.emitter }, address: '0xme' })
  const received: string[] = []
  for (let index = 0; index < 1000; index++)
    bus.emitter.on(channels.social(`0xother${index}`), () => received.push(String(index)))
  try {
    await settle()
    const write = (item: string, version: string) =>
      subscriber.emitter.emit(
        'message',
        channels.economy,
        JSON.stringify({ type: 'ItemWritten', data: { item, holder: '0xk', previous_holder: '0xoldk', version } })
      )
    queries.length = 0
    write('0xcape', '11')
    write('0xgone', '12')
    await settle()
    expect([queries.length, received]).toEqual([4, []])
    expect(f.sent).toContainEqual({
      type: 'packet/item_updated',
      item: expect.objectContaining({ id: '0xcape', kiosk: '0xk', version: '9007199254740993' }),
    })
    expect(f.sent.some((packet) => packet.type === 'packet/item_removed')).toBe(false)
  } finally {
    player.on_close()
    bus.close()
  }
})

test('leaderboard money orders exactly beyond Number; a read during pending writes is unavailable, never partial', async () => {
  const scores = ['9007199254740993', '9007199254740992', '17']
  const members = scores.map((score, index) => rank_member(score, address(index)))
  const state = { pending: null as string | null, checkpoint: 50, mgets: 0 }
  // A Redis client's commands are methods: one taken off its client loses the client and throws.
  async function call(this: unknown, command: string, ...args: readonly (string | number)[]): Promise<unknown> {
    if (this === undefined) throw new TypeError('the command was called without its client')
    if (command === 'MGET') {
      state.mgets++
      return [JSON.stringify({ reset_at_ms: 2, timestamp_ms: 1, checkpoint: state.checkpoint }), state.pending]
    }
    if (command === 'ZRANGE') return [...members].sort()
    if (command === 'HGET') return scores[address_index(String(args[1]))] ?? null
    if (command === 'ZRANK') return [...members].sort().indexOf(String(args[1]))
    throw new Error(`unexpected ${command}`)
  }
  const address_index = (value: string) => [0, 1, 2].findIndex((index) => address(index) === value)
  const bus = create_graph_bus({
    subscriber: fake_redis().redis,
    publisher: fake_redis({ call }).redis,
    on_lost: () => {},
  })
  const snapshot = await bus.leaderboard({ metric: 'xp', id: 7 })
  expect(snapshot.entries.map(({ address: who, score }) => [who, score])).toEqual([
    [address(0), '9007199254740993'],
    [address(1), '9007199254740992'],
    [address(2), '17'],
  ])
  expect(await bus.leaderboard_rank('xp', address(1))).toMatchObject({ rank: 2, score: '9007199254740992' })
  expect(await bus.leaderboard_rank('xp', address(9))).toBeNull()
  state.pending = 'unacknowledged write'
  await expect(bus.leaderboard({ metric: 'xp', id: 8 })).rejects.toThrow('updating')
})

test('market volume windows and price buckets stay exact; a corrupt or partial price read cannot look like no trading', async () => {
  const now = 40 * DAY + 12_345
  const rows = [
    `${now - 30 * DAY - 1}:1000`,
    `${now - 30 * DAY}:2000`,
    `${now - 2 * DAY}:13`,
    `${now - DAY + 1}:9007199254740993`,
    `${now}:2`,
    `${now + 1}:500`,
  ]
  const publisher = fake_redis({
    get: async () => '0',
    hvals: async (key: string) =>
      rows.filter((row) => Math.floor(Number(row.split(':')[0]) / DAY) === Number(key.split(':').at(-1))),
  })
  const bus = create_graph_bus({ subscriber: fake_redis().redis, publisher: publisher.redis, on_lost: () => {} })
  expect(await bus.market_volume(now)).toEqual({
    history_days: 40,
    day_mist: '9007199254740995',
    month_mist: '9007199254741008',
  })
  const total = { total_mist: '9007199254740993', units: '1000', sales: '1', checkpoint: 10 }
  const reader = (first: string | null, results: unknown) =>
    fake_redis({ get: async () => first, pipeline: () => ({ hget: () => {}, exec: async () => results }) }).redis
  expect(await get_market_prices(reader(null, []), 'quartz', 1000)).toBeNull()
  const history = await get_market_prices(
    reader(String(500 * MARKET_PRICE_DAY_MS), [
      [null, JSON.stringify(total)],
      [null, null],
    ]),
    'quartz',
    501 * MARKET_PRICE_DAY_MS
  )
  expect(history?.buckets).toEqual([{ at_ms: 500 * MARKET_PRICE_DAY_MS, ...total }])
  for (const results of [null, [], [[new Error('redis unavailable'), null]]])
    await expect(get_market_prices(reader('0', results), 'quartz', 1000)).rejects.toThrow()
  for (const first of ['-1', 'bad', '1001'])
    await expect(get_market_prices(reader(first, []), 'quartz', 1000)).rejects.toThrow()
  for (const value of [
    'invalid',
    JSON.stringify({ ...total, units: '0' }),
    JSON.stringify({ ...total, total_mist: 9007199254740992 }),
  ])
    expect(() => parse_price_bucket(value, 0)).toThrow()
  const price = (mist: string) => ({ mist, units: '1000' })
  const ohlc = { open: price('3'), high: price('4'), low: price('1'), close: price('2') }
  expect(parse_price_bucket(JSON.stringify({ ...total, ohlc }), 0)?.ohlc).toEqual(ohlc)
  expect(() => parse_price_bucket(JSON.stringify({ ...total, ohlc: { ...ohlc, open: price('5') } }), 0)).toThrow()
})

test('tournament recovery: a missing pool never becomes a false zero; token claims are independent of settled SUI', async () => {
  const row = {
    id: 'cup',
    version: '10',
    name: 'Cup',
    status: 'finished',
    organizer: 'owner',
    format: 1,
    start_before_ms: 1,
    sui_bps: [10000, 0, 0, 0, 0],
    token_bps: [10000, 0, 0, 0, 0],
    sui_pool: '0',
    sui_total: '9007199254740993',
    kares_pool: 'pool',
    rewards: [],
    matches: [],
    teams: [
      {
        name: 'A',
        revision: '0',
        allowed: [],
        place: 1,
        seats: [{ character: 'hero', owner: 'owner', sui_claimed: true, items_claimed: '0' }],
      },
    ],
  }
  const graph_for = (pool: Record<string, unknown> | null) =>
    ({
      read: async (query: string) => {
        if (query.startsWith('MATCH (t:Tournament)'))
          return [{ tournament: { properties: { created_ckpt: 1, data: JSON.stringify(row) } } }]
        if (query.startsWith('MATCH (p:TournamentKaresPool)')) return pool ? [{ pool: { properties: pool } }] : []
        return [{ id: 'hero', name: 'Hero' }]
      },
    }) as unknown as Graph
  await expect(get_tournaments(graph_for(null), 'owner')).rejects.toThrow('not available yet')
  const [funded] = await get_tournaments(
    graph_for({ id: 'pool', balance: '99', total: '101', version: '20', refunded: true, claimed: [] }),
    'owner'
  )
  expect(funded!.teams[0]!.seats[0]).toMatchObject({ sui_claimed: true, token_claimed: false })
  expect([funded!.sui_total, tournament_coin_claims(funded!, 0, 0)]).toEqual([
    '9007199254740993',
    { sui: 0n, kares: 101n },
  ])
})

test('admin analytics keep large signed values exactly, default only the missing tournament field, and refuse malformed rows', async () => {
  const value = { ...ZERO_TOTALS, checkpoint: 10, transactions: '9007199254740993', gas_mist: '-9007199254740993' }
  expect(parse_analytics_totals(JSON.stringify(value))).toEqual(value)
  const {
    tournament_mist: _tournament_mist,
    market_fee_mist: _market_fee_mist,
    market_fee_kares: _market_fee_kares,
    ...legacy
  } = ZERO_TOTALS
  expect(parse_analytics_totals(JSON.stringify(legacy))).toEqual(ZERO_TOTALS)
  for (const broken of [
    {},
    { ...value, gas_mist: 2 },
    { ...value, transactions: '-1' },
    { ...value, gas_mist: String(1n << 127n) },
  ])
    expect(() => parse_analytics_totals(JSON.stringify(broken))).toThrow()
  // The market fee paid in SUI is SUI revenue; the fee paid in KARES is reported apart and never converted.
  const totals = {
    ...ZERO_TOTALS,
    item_royalty_mist: '9007199254740993',
    character_creation_mist: '1000',
    market_fee_mist: '500',
    market_fee_kares: '44365847332125',
  }
  const publisher = fake_redis({
    get: async () => 'compact-v1',
    mget: async (...keys: string[]) => keys.flat().map(() => JSON.stringify(totals)),
  })
  const bus = create_graph_bus({ subscriber: fake_redis().redis, publisher: publisher.redis, on_lost: () => {} })
  const graph = { read: async () => [{ total: 4 }], close: async () => {} }
  const revenue = await get_admin_overview_section(
    graph,
    bus,
    create_mesh_bus({ subscriber: fake_redis().redis, publisher: fake_redis().redis }),
    'revenue',
    1
  )
  expect(revenue).toMatchObject({
    section: 'revenue',
    data: { all_time_revenue_mist: '9007199254742493', all_time_market_fee_kares: '44365847332125' },
  })
  const uninitialized = create_graph_bus({
    subscriber: fake_redis().redis,
    publisher: fake_redis({ mget: async () => [] }).redis,
    on_lost: () => {},
  })
  await expect(uninitialized.analytics_totals(['analytics:totals:all'])).rejects.toThrow('not initialized')
})

test('market history keeps seller rows and exact 30-day revenue, and a corrupt retained row fails loudly', async () => {
  const now_ms = 4_000_000_000
  const sale = (side: string, ts_ms: number, price_mist: string) =>
    `1:2:3|${JSON.stringify({ object: '0xitem', kind: 'item', name: 'Edge', item_type: 'edge', amount: 1, price_mist, exclusive: false, ts_ms, side, counterparty: '0xother' })}`
  const graph = { read: async () => [{ kiosk: '0xkiosk', amount_mist: '77' }], close: async () => {} }
  const bus = (rows: string[]) => ({ sales_history: async () => rows }) as never
  const history = await get_market_history(
    graph,
    bus([sale('sold', now_ms - 10, '9007199254740993'), sale('bought', now_ms - 5, '99')]),
    { address: '0xme', now_ms }
  )
  expect(history).toMatchObject({
    total: 1,
    revenue_30d_mist: '9007199254740993',
    profits: [{ kiosk: '0xkiosk', amount_mist: '77' }],
  })
  await expect(get_market_history(graph, bus(['broken']), { address: '0xme' })).rejects.toThrow('coordinate separator')
})

test('SuiNS shows a reverse name only when it resolves forward to the same address, and caches both answers', async () => {
  const state = { now: 0, calls: 0, mismatch: false }
  const client = {
    defaultNameServiceName: async ({ address: who }: Readonly<{ address: string }>) => {
      state.calls++
      return { data: { name: `${who}.sui` } }
    },
    resolveNameServiceAddress: async ({ name }: Readonly<{ name: string }>) => ({
      address: state.mismatch ? '0xwrong' : name.slice(0, -4),
    }),
  }
  const resolve = create_suins_resolver({ client: client as never, now: () => state.now })
  expect(await resolve(address(0))).toBe(`${address(0)}.sui`)
  state.now = 299_999
  await resolve(address(0))
  expect(state.calls).toBe(1)
  state.now++
  state.mismatch = true
  expect(await resolve(address(0))).toBeNull()
})

test('the campaign uses the admitted identity, binds wallet and intent, and folds a Blast proof to the Move root', async () => {
  const requests: string[] = []
  const pending = Promise.withResolvers<AllocationResult>()
  const f = wire({ owns: false })
  const allocation = {
    request: async (owner: string) => {
      requests.push(owner)
      return pending.promise
    },
  } as never
  const player = create_player({ ...f, claim: { stage: 'signed', address: '0xadmitted' }, allocation })
  const ask = (id: number) =>
    JSON.stringify({
      type: 'packet/allocation_request',
      id,
      request: { action: 'wallet_remove', address: '0x1', owner: 'forged' },
    })
  player.on_message(ask(1))
  player.on_message(ask(2))
  expect(f.sent).toContainEqual({
    type: 'packet/allocation_response',
    id: 2,
    result: { action: 'error', error: 'rate_limited' },
  })
  pending.resolve({ action: 'wallet_remove' })
  await settle()
  expect(requests).toEqual(['0xadmitted'])
  expect(f.sent).toContainEqual({ type: 'packet/allocation_response', id: 1, result: { action: 'wallet_remove' } })
  player.on_close()
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const message = JSON.stringify({
    domain: 'https://aresrpg.world',
    action: 'submit_posts',
    nonce: 'one-use',
    posts: ['1'],
  })
  const { signature } = await signer.signPersonalMessage(new TextEncoder().encode(message))
  expect(await verify_wallet_message(message, signature, signer.toSuiAddress())).toBe(true)
  expect(
    await verify_wallet_message(
      message,
      signature,
      Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)).toSuiAddress()
    )
  ).toBe(false)
  await expect(verify_wallet_message(`${message}changed`, signature, signer.toSuiAddress())).rejects.toThrow()
  // Provenance: `sui move test` (sui 1.82.3, 2026-10-29) accepted these digests with Blast's
  // allowlist_leaf/node/verify; the same fold reproduced the KARES sale's on-chain root on 2026-11-21.
  const rows = [
    { address: `0x${'a1'.repeat(32)}`, cap_mist: 125_000_000_000n },
    { address: `0x${'c3'.repeat(32)}`, cap_mist: 70_000_000_000n },
  ]
  const ROOT = '988d8aad84154dcbbc19e6d239cfe1e752fc19c37936ade66cf04aed92ab6630'
  const first = {
    index: '0',
    cap_mist: '125000000000',
    siblings: [
      'af90e4171e97990b4cac6b346fb43baead82ef402f8c01ac21560a68fa9cb46d',
      '42d86783f8ead225d19a0c8c09a65a32c3eae317787ac8d0a85fca28046e0172',
    ],
  }
  const last = {
    index: '2',
    cap_mist: '70000000000',
    siblings: [
      '43b770ab1ae0caab611e596e1b613c16051b70aa73af6dfcf323ed58581a2e6e',
      '90c46005628b318a489371dad9fb8cc652b3382f655cc32fa6ea543243abb4c3',
    ],
  }
  expect(Buffer.from(blast_leaf(0, rows[0]!)).toString('hex')).toBe(
    '675cbf0651a61089a3389243351a70e2c3f03143b93f908cd575cb3449d73bc0'
  )
  expect([blast_proof_root(rows[0]!.address, first), blast_proof_root(rows[1]!.address, last)]).toEqual([ROOT, ROOT])
  for (const forged of [
    { ...last, cap_mist: '125000000000' },
    { ...first, index: '1' },
    { ...first, siblings: [...first.siblings].reverse() },
  ])
    expect(blast_proof_root(rows[0]!.address, forged)).not.toBe(ROOT)
  // Shared posts: one preview page for both subjects, built from what the index holds; any other subject is a
  // plain 404 that never reaches a read.
  const SITE = 'https://aresrpg.world'
  const token = 'ab'.repeat(32)
  const campaign_store = {
    get: async (name: string) => (name.endsWith(`:share:${token}`) ? address(9) : null),
  } as never
  const campaign_page = await allocation_preview(
    new Request(`${SITE}/api/allocation?action=preview&token=${token}&locale=fr`),
    campaign_store,
    SITE
  )
  expect(campaign_page.status).toBe(200)
  const campaign_html = await campaign_page.text()
  expect(campaign_html).toContain('<html lang="fr">')
  expect(campaign_html).toContain(
    `<meta property="og:image" content="${SITE}/api/allocation?action=image&amp;token=${token}`
  )
  const unknown_token = await allocation_preview(
    new Request(`${SITE}/api/allocation?action=preview&token=${'cd'.repeat(32)}`),
    campaign_store,
    SITE
  )
  expect([unknown_token.status, await unknown_token.text()]).toEqual([404, 'not found'])
  const hero_id = address(42)
  const reads: unknown[] = []
  const hero_row = {
    name: 'a"><b>',
    classe: 'senshi',
    sex: 'male',
    level: 42,
    color_1: 0xffffff,
    color_2: 0xd9af57,
    color_3: 0x8b6539,
    items: [{ properties: { item_type: 'gravebrand' } }, null],
  }
  const index = {
    read: async (_cypher: string, params: Readonly<{ character_id: string }>) => {
      reads.push(params.character_id)
      return params.character_id === hero_id ? [hero_row] : []
    },
  } as never
  const hero_page = (id: string, init?: RequestInit) =>
    hero_preview(new Request(`${SITE}/api/share?hero=${encodeURIComponent(id)}&locale=en`, init), index, SITE)
  const shown = await hero_page(hero_id)
  expect(shown.status).toBe(200)
  const html = await shown.text()
  const poster = portrait_poster_url(hero_row, { name: hero_row.name, level: 42, power: 0, gear: ['gravebrand'] })!
  const escaped_poster = `${SITE}${poster}`.replaceAll('&', '&amp;')
  expect(html).toContain(`<meta property="og:image" content="${escaped_poster}">`)
  expect(html).toContain(`<meta name="twitter:image" content="${escaped_poster}">`)
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  expect(html).toContain('<meta name="robots" content="noindex">')
  expect(html).toContain('<title>a&quot;&gt;&lt;b&gt; · AresRPG</title>')
  expect(html).toContain('My Senshi, level 42, has a power of 0 in @AresRPG.')
  expect(html).not.toContain('"><b>')
  expect(html).toContain(`<a href="${SITE}">AresRPG</a>`)
  for (const id of [address(43), '0x123', '', `${hero_id}"><script>alert(1)</script>`, hero_id.toUpperCase()]) {
    const refused = await hero_page(id)
    expect([refused.status, await refused.text()]).toEqual([404, 'not found'])
  }
  expect(reads).toEqual([hero_id, address(43)])
  expect((await hero_page(hero_id, { method: 'POST' })).status).toBe(405)
  const broken = { read: async () => Promise.reject(new Error('graph down at 10.0.0.3')) } as never
  const unavailable = await hero_preview(new Request(`${SITE}/api/share?hero=${hero_id}`), broken, SITE)
  expect([unavailable.status, await unavailable.text()]).toEqual([503, 'unavailable'])
})
