// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One socket, three stages, through the real player harness: what each stage reads, the per-socket
// budgets and parse door, the account streams and their ready barrier, and the paired bot.

import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { LEADERBOARD_METRICS, POSITION_INTERVAL_MS, type AgentObservation, type ServerPacket } from '@aresrpg/protocol'
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'

import { create_game_state } from '../src/game_state.ts'
import { MAX_BUFFERED_BYTES } from '../src/player_output.ts'
import { channels, mesh } from '../src/protocol.ts'

import { create_player, settle, types_of, wire } from './harness.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const owner = google.toSuiAddress()
const bot = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(4)),
  zklogin_public_identifier: google,
})
const bot_character = `0x${'b'.repeat(64)}`
const observation: AgentObservation = {
  public_identifier: google.toBase64(),
  character_id: bot_character,
  pairing: { address: bot.address, multisig_public_key: bot.public_key.toBase64(), signer_mode: 'disposable' },
}
const foreign: AgentObservation = {
  ...observation,
  pairing: { ...observation.pairing, address: `0x${'9'.repeat(64)}` },
}
const target = `0x${'c'.repeat(64)}`
const position = (character_id = '0xabc', checkpoint = 'c', x = 1) =>
  JSON.stringify({ type: 'packet/position', character_id, checkpoint, x, y: 0, z: 100, riding: false, gliding: false })
const ignored = (type: string) => ['packet/server_info', 'packet/game_state'].includes(type)
const sale = {
  ckpt: 1,
  tx: 2,
  evt: 3,
  ts_ms: 4,
  type: 'MarketPurchased',
  data: {
    seller: owner,
    object: '0xi',
    buyer: '0xother',
    kind: 'item',
    name: 'Hat',
    item_type: 'hat',
    amount: 1,
    price_mist: '5',
  },
}

test('an open socket reads the market, rankings and profiles anonymously; account and gameplay packets change nothing', async () => {
  const f = wire({ owns: false })
  const player = create_player({ ...f, claim: { stage: 'open' } })
  try {
    for (const packet of [
      { type: 'packet/market_observe', observation: { kind: 'offers', category: 'hat', item_type: 'hat', request: 1 } },
      { type: 'packet/market_prices_observe', observation: { item_type: 'hat', id: 2 } },
      { type: 'packet/leaderboard_observe', observation: { metric: LEADERBOARD_METRICS[0], id: 4 } },
      { type: 'packet/inspection_request', id: 5, query: { kind: 'profile', address: target, after: null } },
      { type: 'packet/character_owner_request', id: 6, character_id: target },
    ])
      player.on_message(JSON.stringify(packet))
    await settle()
    for (const type of ['packet/game_state', 'packet/market_types', 'packet/market_slice', 'packet/market_prices'])
      expect(types_of(f.sent)).toContain(type)
    expect(f.sent.find(({ type }) => type === 'packet/server_info')).toMatchObject({
      online: 7,
      indexing_lag: 42,
      market_volume: { day_mist: '7', month_mist: '9', history_days: 1 },
    })
    expect(f.sent.find(({ type }) => type === 'packet/leaderboard')).toMatchObject({ snapshot: { self: null } })
    expect(f.sent.some((packet) => 'id' in packet && packet.id === 5)).toBe(true)
    expect(f.sent).toContainEqual({
      type: 'packet/character_owner_response',
      id: 6,
      character_id: '0xabc',
      name: 'nox',
      owner: '0xowner',
    })
    // No viewer: the page keeps every offer and no personal rank is read.
    expect(f.reads.find(({ query }) => query.includes('AS groups'))?.params?.address).toBeNull()
    expect(f.leaderboard_readers).toEqual([])
    for (const type of ['packet/characters', 'packet/inventory', 'packet/listings', 'packet/market_history'])
      expect(types_of(f.sent)).not.toContain(type)
    const reads = f.reads.length
    f.sent.length = 0
    for (const packet of [
      position(),
      { type: 'packet/chat', character_id: '0xabc', parts: [{ kind: 'text', text: 'hello' }] },
      { type: 'packet/fight_resync', fight: '0xf1' },
      { type: 'packet/spectate', character_id: '0xabc', fight: '0xf1' },
      { type: 'packet/agent_observe', id: 1, observation },
      { type: 'packet/inventory_observe', id: 2, observation },
      { type: 'packet/allocation_request', id: 3, request: { action: 'status' } },
      { type: 'packet/admin_request', id: 4, kind: 'overview_section', section: 'revenue', days: 1 },
      {
        type: 'packet/agent_status',
        status: { ready: true, event_fence: 1, sampled_at: 1, state: 'idle', runs: [], direct: null },
      },
    ])
      player.on_message(typeof packet === 'string' ? packet : JSON.stringify(packet))
    await settle()
    expect(f.sent.filter(({ type }) => !ignored(type))).toEqual([])
    expect([f.reads.length, f.published, player.online_characters(), player.is_agent()]).toEqual([reads, [], [], false])
  } finally {
    player.on_close()
  }
})

test('a signed socket loads what a site page reads, its sales and its paired bot, and never plays', async () => {
  const f = wire({
    respond: (query, params) =>
      params?.address === bot.address && query.includes('[:HOLDS]->(c:Character)')
        ? [{ character: { properties: { id: bot_character, name: 'bot', world: 'overworld' } }, equipment: [] }]
        : undefined,
  })
  const player = create_player({ ...f, claim: { stage: 'signed', address: owner } })
  try {
    await settle()
    const ready = types_of(f.sent).indexOf('packet/characters')
    expect(ready).toBeGreaterThan(-1)
    for (const type of ['packet/inventory', 'packet/giftcards', 'packet/listings', 'packet/mastery'])
      expect(types_of(f.sent).indexOf(type)).toBeLessThan(ready)
    expect(types_of(f.sent)).toContain('packet/market_history')
    for (const type of ['packet/claims', 'packet/fight_resolutions', 'packet/closable_fights', 'packet/trades'])
      expect(types_of(f.sent)).not.toContain(type)
    // Money arriving: a sale of my listing always forwards, then listings and history are re-read.
    const listings = types_of(f.sent).filter((type) => type === 'packet/listings').length
    f.pubsub.emitter.emit(channels.economy, sale)
    f.pubsub.emitter.emit(channels.economy, { ...sale, data: { ...sale.data, seller: '0xother' } })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/listing_sold')).toEqual([
      {
        type: 'packet/listing_sold',
        sale: {
          id: '1:2:3',
          object: '0xi',
          kind: 'item',
          name: 'Hat',
          item_type: 'hat',
          amount: 1,
          price_mist: '5',
          counterparty: '0xother',
          ts_ms: 4,
        },
      },
    ])
    expect(types_of(f.sent).filter((type) => type === 'packet/listings')).toHaveLength(listings + 1)
    // A hero changing in the game re-reads the roster on this page too.
    const rosters = types_of(f.sent).filter((type) => type === 'packet/characters').length
    f.pubsub.emitter.emit(channels.character('0xabc'), { type: 'CharacterChanged', data: { character: '0xabc' } })
    await settle()
    expect(types_of(f.sent).filter((type) => type === 'packet/characters').length).toBeGreaterThan(rosters)
    player.on_message(JSON.stringify({ type: 'packet/agent_observe', id: 7, observation }))
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/agent_observed').at(-1)).toMatchObject({
      id: 7,
      selected_character_id: bot_character,
      characters: [{ id: bot_character }],
      failed: false,
    })
    // No presence, no world, no chat door, no bot status.
    player.on_message(position())
    player.on_message(
      JSON.stringify({
        type: 'packet/agent_status',
        status: { ready: true, event_fence: 1, sampled_at: 1, state: 'idle', runs: [], direct: null },
      })
    )
    await settle()
    expect([f.published, player.online_characters(), player.is_agent()]).toEqual([[], [], false])
    expect(types_of(f.sent).filter((type) => ['packet/tracked_zones', 'packet/zones'].includes(type))).toEqual([])
  } finally {
    player.on_close()
  }
})

test('the seat adds what only the game reads, beside two signed sockets of the same address', async () => {
  const shared = wire()
  const mount = (stage: 'signed' | 'seated') => {
    const f = wire({ shared_pubsub: shared.pubsub })
    return { f, player: create_player({ ...f, graph: shared.graph, claim: { stage, address: owner } }) }
  }
  const sockets = [mount('seated'), mount('signed'), mount('signed')]
  try {
    await settle()
    for (const type of [
      'packet/claims',
      'packet/fight_resolutions',
      'packet/closable_fights',
      'packet/trades',
      'packet/friends',
      'packet/kolizeums',
      'packet/tournaments',
    ])
      expect(types_of(sockets[0]!.f.sent)).toContain(type)
    for (const { f } of sockets) expect([types_of(f.sent).includes('packet/characters'), f.dropped]).toEqual([true, []])
    // Only the seat embodies the roster.
    expect(sockets.map(({ player }) => player.online_characters().length)).toEqual([2, 0, 0])
  } finally {
    sockets.forEach(({ player }) => player.on_close())
  }
})

test('an admin packet from a non-admin is refused without a graph read; an admin gets the section', async () => {
  for (const admin of [false, true]) {
    const f = wire()
    const player = create_player({ ...f, address: '0xboss', admin })
    try {
      await settle()
      const reads = f.reads.length
      player.on_message(
        JSON.stringify({ type: 'packet/admin_request', id: 3, kind: 'overview_section', section: 'online', days: 1 })
      )
      await settle()
      const answer = f.sent.find((packet) => 'id' in packet && packet.id === 3)
      if (admin)
        expect(answer).toMatchObject({
          type: 'packet/admin_response',
          kind: 'overview_section',
          result: { section: 'online' },
        })
      else expect([answer, f.reads.length]).toEqual([{ type: 'packet/error', id: 3, reason: 'not an admin' }, reads])
    } finally {
      player.on_close()
    }
  }
})

test('a graph read past the socket allowance is refused before the graph; only a declared cancellation passes', async () => {
  const request = (id: number) => JSON.stringify({ type: 'packet/character_owner_request', id, character_id: target })
  const sockets = [wire({ owns: false }), wire({ owns: false })].map((f) => ({
    f,
    player: create_player({ ...f, address: owner }),
  }))
  const [{ f, player }, other] = sockets as [(typeof sockets)[number], (typeof sockets)[number]]
  try {
    await settle()
    for (let id = 0; id <= 60; id++) player.on_message(request(id))
    other.player.on_message(request(1))
    await settle()
    const refused = (sent: typeof f.sent) =>
      sent.filter((packet) => packet.type === 'packet/error' && packet.reason === 'rate limited')
    expect([refused(f.sent).length, refused(other.f.sent).length]).toEqual([1, 0])
    const reads = f.reads.length
    f.sent.length = 0
    // Extra null fields never turn a read into a free cancellation.
    for (const packet of [
      { type: 'packet/market_observe', observation: { kind: 'characters', request: 5 }, fight: null },
      { type: 'packet/leaderboard_observe', observation: { metric: LEADERBOARD_METRICS[0], id: 7 }, query: null },
      {
        type: 'packet/inspection_request',
        id: 8,
        query: { kind: 'profile', address: target, after: null },
        observation: null,
      },
      { type: 'packet/spectate', character_id: '0xabc', fight: '0xf1', observation: null },
      { type: 'packet/fight_resync', fight: '0xf1', query: null },
    ])
      player.on_message(JSON.stringify(packet))
    const limited = { type: 'packet/error', reason: 'rate limited' } as const
    expect(f.sent).toEqual([limited, limited, { type: 'packet/inspection_error', id: 8 }, limited, limited])
    for (const type of ['packet/market_observe', 'packet/market_prices_observe', 'packet/leaderboard_observe'])
      player.on_message(JSON.stringify({ type, observation: null }))
    for (const type of ['packet/spectate', 'packet/fight_preview', 'packet/fight_nearby'])
      player.on_message(JSON.stringify({ type, fight: null, character_id: '0xabc' }))
    player.on_message(JSON.stringify({ type: 'packet/inspection_request', id: 9, query: null }))
    await settle()
    expect([refused(f.sent).length, f.reads.length]).toEqual([4, reads])
  } finally {
    sockets.forEach((socket) => socket.player.on_close())
  }
})

test('the parse door answers malformed packets, a flood drops with RATE_LIMIT and a cool-off, and a stalled socket closes', async () => {
  const penalized: string[] = []
  const f = wire({ character_ids: ['0xowned'] })
  const player = create_player({ ...f, address: owner, penalize: () => void penalized.push(owner) })
  try {
    await settle()
    const reads = f.reads.length
    for (const raw of [
      'not json at all',
      JSON.stringify({ type: 'query', kind: 'characters' }),
      JSON.stringify({ type: 'packet/market_prices_observe', observation: { id: 1, item_type: "wheat' RETURN 1" } }),
      JSON.stringify({ type: 'packet/market_types', items: [] }),
      JSON.stringify({ type: 'packet/list_requested', kind: 'character', id: target, price_mist: '1' }),
    ])
      player.on_message(raw)
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/error')).toHaveLength(5)
    expect([f.reads.length, f.dropped]).toEqual([reads, []])
    // The six-character floor holds for one tracked hero; one packet past it drops the socket once.
    const floor = Math.ceil(1000 / POSITION_INTERVAL_MS) * 6 + 30 - 5
    for (let id = 0; id < floor; id++) player.on_message(JSON.stringify({ type: 'packet/ping', id }))
    expect([f.dropped, penalized]).toEqual([[], []])
    player.on_message(JSON.stringify({ type: 'packet/ping', id: floor }))
    expect([f.dropped, penalized]).toEqual([['RATE_LIMIT'], [owner]])
  } finally {
    player.on_close()
  }
  expect(penalized).toEqual([owner])
  const stalled = wire()
  const socket = create_player({
    ...stalled,
    ws: { ...stalled.ws, getBufferedAmount: () => MAX_BUFFERED_BYTES },
    address: owner,
  })
  socket.on_message(JSON.stringify({ type: 'packet/ping', id: 1 }))
  expect(stalled.dropped).toContain('SLOW_CONSUMER')
  socket.on_close()
})

test('the account snapshot is scoped to the address, refreshes on its events, and a live roster never crosses an unread barrier', async () => {
  const gates = { roster: Promise.withResolvers<void>(), inventory: Promise.withResolvers<void>() }
  let roster_reads = 0
  const f = wire({
    friends: ['0xpal'],
    respond: async (query) => {
      if (query.includes('[:HOLDS]->(i:Item)')) await gates.inventory.promise
      if (!query.includes('[:HOLDS]->(c:Character)')) return undefined
      if (++roster_reads === 1) {
        await gates.roster.promise
        return []
      }
      return [
        {
          character: { properties: { id: '0xnew', name: 'new' } },
          kiosk_node: { properties: { id: '0xk' } },
          equipment: [],
        },
      ]
    },
  })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    f.pubsub.emitter.emit(channels.social('0xme'), { type: 'CharacterCreated', data: {} })
    await settle()
    expect(types_of(f.sent)).not.toContain('packet/characters')
    gates.inventory.resolve()
    await settle()
    gates.roster.resolve()
    await settle()
    const rosters = f.sent.filter((packet) => packet.type === 'packet/characters')
    expect(rosters.length).toBeGreaterThan(0)
    expect(rosters.every((packet) => packet.characters.map(({ id }) => id).join() === '0xnew')).toBe(true)
    expect(f.reads.filter(({ params }) => 'address' in (params ?? {}) && params?.address !== '0xme')).toEqual([])
    expect(f.sent.find(({ type }) => type === 'packet/giftcards')).toEqual({
      type: 'packet/giftcards',
      giftcards: [{ id: '0xgift', template: '0xtemplate', amount: 1 }],
    })
    const count = (type: string) => types_of(f.sent).filter((sent) => sent === type).length
    const before = ['packet/giftcards', 'packet/friends', 'packet/trades', 'packet/claims'].map(count)
    for (const [channel, type, data] of [
      [channels.social('0xme'), 'GiftcardsChanged', {}],
      [channels.social('0xme'), 'FriendListChanged', {}],
      [channels.social('0xme'), 'TradeDestroyed', { trade: '0xt1' }],
      [channels.economy, 'LootClaimed', { opener: '0xme' }],
      [channels.economy, 'GearCrushed', { crusher: '0xsomeone' }],
    ] as const)
      f.pubsub.emitter.emit(channel, { type, data })
    await settle()
    expect(['packet/giftcards', 'packet/friends', 'packet/trades', 'packet/claims'].map(count)).toEqual(
      before.map((n) => n + 1)
    )
    expect(f.sent).toContainEqual({ type: 'packet/trade_destroyed', trade: '0xt1' })
    expect(f.sent).toContainEqual({ type: 'packet/friends', friends: [{ address: '0xpal', characters: [] }] })
  } finally {
    player.on_close()
  }
  const sent = f.sent.length
  f.pubsub.emitter.emit(channels.social('0xme'), { type: 'FriendListChanged', data: {} })
  await settle()
  expect(f.sent).toHaveLength(sent)
})

test('a socket closed before its baseline lands sends nothing and leaves no listener', async () => {
  const gate = Promise.withResolvers<void>()
  const f = wire({
    respond: async () => {
      await gate.promise
      return undefined
    },
  })
  const player = create_player({ ...f, address: '0xme' })
  player.on_close()
  const sent = f.sent.length
  gate.resolve()
  await settle()
  player.on_message(JSON.stringify({ type: 'packet/ping', id: 99 }))
  expect([f.sent.length, f.published, f.pubsub.emitter.eventNames()]).toEqual([sent, [], []])
})

test('trade rows keep each seller kiosk and never leak retired balances onto the wire', async () => {
  const trade = (properties: Record<string, unknown>) => ({
    trade: {
      properties: {
        id: '0xtrade',
        a: '0xme',
        b: '0xb',
        phase: 'settling',
        offer_revision: 1,
        accept_a: true,
        accept_b: true,
        sui_a: '0',
        sui_b: '0',
        kares_a: '999',
        kares_b: '888',
        caps_a: JSON.stringify(['0xitem']),
        caps_b: '[]',
        ...properties,
      },
    },
  })
  let current = trade({ token_a: '123000000000', token_b: '0' })
  const f = wire({
    respond: (query) => {
      if (query.includes('AND NOT')) return []
      if (query.includes('MATCH (t:Trade')) return [current]
      if (query.includes('asset.id IN'))
        return [
          {
            asset: {
              properties: {
                id: '0xitem',
                name: 'Wool',
                level: 1,
                amount: 100,
                item_type: 'wool',
                category: 'resource',
              },
            },
            kiosk: '0xka',
          },
        ]
      return undefined
    },
  })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    expect(f.sent.find(({ type }) => type === 'packet/trades')).toMatchObject({
      trades: [
        { kares_a: '123000000000', kares_b: '0', caps_a: [{ object: '0xitem', amount: 100, level: 1, kiosk: '0xka' }] },
      ],
    })
    current = trade({})
    f.pubsub.emitter.emit(channels.social('0xme'), { type: 'TradeChanged', data: { trade: '0xtrade' } })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/trades').at(-1)).toMatchObject({
      trades: [{ kares_a: '0', kares_b: '0' }],
    })
  } finally {
    player.on_close()
  }
})

test('a foreign pairing is refused before any read; the verified owner streams the bot account and its own-socket status', async () => {
  const shared = wire({ owns: false })
  const status = { ready: true, event_fence: 3, sampled_at: 10, state: 'idle' as const, runs: [], direct: null }
  const item = {
    id: 'item',
    version: '1',
    item_type: 'wheat',
    category: 'resource',
    name: 'Wheat',
    amount: 2,
    level: 1,
  }
  const viewer = wire({
    shared_pubsub: shared.pubsub,
    owns: false,
    respond: (query, params) =>
      params?.address === bot.address && query.includes('[:HOLDS]->(i:Item)')
        ? [{ item: { properties: item }, kiosk: 'kiosk' }]
        : undefined,
  })
  const owner_socket = create_player({ ...viewer, claim: { stage: 'signed', address: owner } })
  const bot_wire = wire({ shared_pubsub: shared.pubsub, owns: false })
  const bot_socket = create_player({ ...bot_wire, address: bot.address })
  const impostor = create_player({
    ...wire({ shared_pubsub: shared.pubsub, owns: false }),
    address: `0x${'9'.repeat(64)}`,
  })
  const observed = () =>
    viewer.sent.filter(
      (packet): packet is Extract<ServerPacket, { type: 'packet/inventory_observed' }> =>
        packet.type === 'packet/inventory_observed'
    )
  try {
    await settle()
    const reads = viewer.reads.length
    owner_socket.on_message(JSON.stringify({ type: 'packet/inventory_observe', id: 1, observation: foreign }))
    await settle()
    expect([observed(), viewer.reads.length]).toEqual([
      [{ type: 'packet/inventory_observed', id: 1, packet: null }],
      reads,
    ])
    owner_socket.on_message(JSON.stringify({ type: 'packet/inventory_observe', id: 2, observation }))
    await settle()
    expect(viewer.reads.slice(reads).every(({ params }) => !params?.address || params.address === bot.address)).toBe(
      true
    )
    expect(observed()).toContainEqual({
      type: 'packet/inventory_observed',
      id: 2,
      packet: { type: 'packet/inventory', items: [{ ...item, kiosk: 'kiosk' }] },
    })
    expect(shared.published).toContainEqual({ channel: mesh.agent_status_wanted(bot.address), payload: null })
    const delta = { type: 'packet/item_removed' as const, item: item.id, version: '2' }
    shared.pubsub.emitter.emit(channels.social(bot.address), { type: 'ItemProjected', data: { packet: delta } })
    expect(observed().at(-1)).toEqual({ type: 'packet/inventory_observed', id: 2, packet: delta })
    // A status speaks only for the address of its own seat.
    impostor.on_message(JSON.stringify({ type: 'packet/agent_status', status }))
    bot_socket.on_message(JSON.stringify({ type: 'packet/agent_status', status }))
    await settle()
    expect(observed().filter(({ packet }) => packet?.type === 'packet/agent_status')).toEqual([
      { type: 'packet/inventory_observed', id: 2, packet: { type: 'packet/agent_status', status } },
    ])
    expect(bot_socket.is_agent()).toBe(true)
    owner_socket.on_message(JSON.stringify({ type: 'packet/inventory_observe', id: 3, observation }))
    await settle()
    expect(bot_wire.sent).toContainEqual({ type: 'packet/agent_status_wanted' })
    bot_socket.on_close()
    await settle()
    expect(observed().at(-1)).toEqual({
      type: 'packet/inventory_observed',
      id: 3,
      packet: { type: 'packet/agent_status', status: null },
    })
    owner_socket.on_message(JSON.stringify({ type: 'packet/inventory_observe', id: 4, observation: null }))
    const before = observed().length
    shared.pubsub.emitter.emit(channels.social(bot.address), { type: 'ItemProjected', data: { packet: delta } })
    await settle()
    expect(observed()).toHaveLength(before)
  } finally {
    ;[owner_socket, bot_socket, impostor].forEach((socket) => socket.on_close())
  }
})

test('the game freeze state reaches a socket at connect and on each indexed transition', async () => {
  const f = wire()
  const game_state = create_game_state({
    graph: { read: async () => [{ version: 1 }], close: async () => {} },
    pubsub: f.pubsub.graph,
  })
  await game_state.start()
  const player = create_player({ ...f, address: '0xme', game_state })
  try {
    f.pubsub.emitter.emit(channels.game, { type: 'GameStateChanged', data: { frozen: true } })
    f.pubsub.emitter.emit(channels.game, { type: 'GameStateChanged', data: { frozen: 'yes' } })
    expect(f.sent.filter(({ type }) => type === 'packet/game_state')).toEqual([
      { type: 'packet/game_state', frozen: false },
      { type: 'packet/game_state', frozen: true },
    ])
  } finally {
    player.on_close()
  }
})
