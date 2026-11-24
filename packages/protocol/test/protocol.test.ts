// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The wire contract and the shared folds every client and the server read, through the public door.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { RUN_ENDINGS, run_ending, valid_agent_observation } from '../src/agent_identity.ts'
import { fold_inventory, fold_item_packet, reconcile_trade_row } from '../src/inventory_projection.ts'
import { has_market_page } from '../src/marketplace.ts'
import {
  expand_chat_message,
  live_mob_groups,
  live_resource_packs,
  parse_client_packet,
  parse_server_packet,
  travel_proof_ready,
  LEADERBOARD_METRICS,
  ZONE_RESEARCH_TTL_MS,
  type ItemRow,
  type MobGroupRow,
  type ResourcePackRow,
  type ServerPacket,
  type TradeCapRow,
  type TradeRow,
} from '../src/packets.ts'
import { create_request_limiter } from '../src/request_limiter.ts'
import { tournament_coin_claims, type TournamentRow, type TournamentTeam } from '../src/tournament.ts'
import { merge_zone_population, merge_zone_rows, retain_zone_keys, tracked_zone_keys } from '../src/world_projection.ts'

import inspection_capture from './fixtures/inspection.testnet.json'

const parse = (packet: unknown) => parse_client_packet(JSON.stringify(packet))
const refused = (packet: unknown, reason?: RegExp | string) => expect(() => parse(packet)).toThrow(reason)
const address = `0x${'a'.repeat(64)}`

test('declared intents parse to their exact shape', () => {
  const position = {
    type: 'packet/position',
    character_id: '0xabc',
    checkpoint: 'nauvis:0:0:1',
    x: 1,
    y: 2,
    z: 3,
    riding: false,
    gliding: false,
  }
  for (const packet of [
    position,
    { type: 'packet/character_owner_request', id: 7, character_id: '0xabc' },
    { type: 'packet/ping', id: 8 },
    { type: 'packet/fight_resync', fight: '0xf1' },
    { type: 'packet/admin_request', id: 2, kind: 'overview_section', section: 'characters', days: 90 },
    {
      type: 'packet/admin_request',
      id: 1,
      kind: 'overview',
      revenue_days: 30,
      players_days: 7,
      transactions_days: 30,
      online_days: 1,
      addresses_days: 30,
      characters_days: 90,
    },
    { type: 'packet/fight_action', fight: '0xf', action: { type: 'move_to', fighter: '1', path: ['2', '3'] } },
    { type: 'packet/allocation_request', id: 1, request: { action: 'status' } },
  ])
    expect(parse(packet)).toEqual(packet as never)
  // the server stream is trusted: the client decodes JSON syntax only
  expect(parse_server_packet('{"type":"packet/pong","id":3}')).toEqual({ type: 'packet/pong', id: 3 })
})

test('malformed intents throw, never coerce', () => {
  const position = { type: 'packet/position', character_id: '0xabc', x: 50_000, y: 0, z: 50_000, riding: false }
  refused({ ...position, checkpoint: 'nauvis:0:0:1' }, /gliding/)
  for (const checkpoint of [undefined, null, '', 'x'.repeat(257), 20])
    refused({ ...position, gliding: false, checkpoint }, /checkpoint/)
  refused({ ...position, gliding: false, checkpoint: 'c', character_id: 'nope' }, /character_id/)
  refused({ type: 'packet/admin_request', kind: 'overview', days: 30 }, /integer id/)
  refused({ type: 'packet/admin_request', id: 1, kind: 'overview', revenue_days: '30' }, /overview ranges/)
  refused({ type: 'packet/admin_request', id: 1, kind: 'drop_db', days: 30 }, /unknown admin kind/)
  refused({ type: 'packet/fight_resync', fight: 'nope' }, /fight id/)
  refused({ type: 'packet/spectate', character_id: '0xc', fight: 'nope' }, /fight id/)
  refused({ type: 'packet/fight_action', fight: '0xf', action: [1] }, /action object/)
  refused(
    { type: 'packet/fight_action', fight: '0xf', action: { type: 'move_to', fighter: '1', path: [2] } },
    /decimal/
  )
  const nested = Array.from({ length: 7 }).reduce<Record<string, unknown>>((inner) => ({ inner }), {})
  refused({ type: 'packet/fight_action', fight: '0xf', action: nested }, /nested too deeply/)
})

test('undeclared surfaces are refused and the campaign request stays bounded', () => {
  for (const type of ['packet/duel', 'packet/agent_setup_request', 'request', 'subscribe'])
    refused({ type, id: 1, channel: 'evt:fight:0x1' }, /unknown packet type/)
  const allocation = (request: unknown) => ({ type: 'packet/allocation_request', id: 1, request })
  refused(allocation({ action: 'wallet_remove', address: 'a'.repeat(67) }))
  refused(allocation({ action: 'wallet_verify', nonce: 'a'.repeat(64), signature: 's'.repeat(12001) }))
  for (const action of ['submit', 'link_x', '__proto__', 'constructor']) refused(allocation({ action, address: '0x1' }))
  refused(allocation(null))
})

test('the chat door bounds parts and length, refuses emptiness, and macros become structured parts', () => {
  const parts = [
    { kind: 'text', text: 'gg ' },
    { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
  ] as const
  expect(parse({ type: 'packet/chat', character_id: '0xc', parts })).toEqual({
    type: 'packet/chat',
    character_id: '0xc',
    parts,
  })
  refused({ type: 'packet/chat', character_id: '0xc', parts: [{ kind: 'text', text: '   ' }] }, /empty/)
  refused({ type: 'packet/chat', character_id: '0xc', parts: [{ kind: 'text', text: 'x'.repeat(241) }] }, /exceeds 240/)
  refused({ type: 'packet/chat_party', character_id: '0xc', parts: [{ kind: 'position', world: '', x: 1, z: 1 }] })
  refused(
    { type: 'packet/chat_whisper', character_id: '0xc', to: 'bob', parts: [{ kind: 'text', text: 'hi' }] },
    /address/
  )
  expect(
    expand_chat_message(
      { text: 'Meet %pos% %xp% [Fuwa Hat]', items: [{ id: '0xhat', name: 'Fuwa Hat' }] },
      { classe: 'shugo', level: 2, experience: '380', world: 'nauvis', x: 50_010, z: 49_990 }
    )
  ).toEqual([
    { kind: 'text', text: 'Meet ' },
    { kind: 'position', world: 'nauvis', x: 50_010, z: 49_990 },
    { kind: 'text', text: ' Shugo Lvl 2 (50%) ' },
    { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
  ])
})

test('market and leaderboard observations fold a bounded value or null and refuse anything else', () => {
  const accepted = {
    'packet/market_observe': [
      { kind: 'types', request: 5 },
      { kind: 'offers', category: 'resource', item_type: 'wood', request: 2 },
    ],
    'packet/market_prices_observe': [{ item_type: 'quartz', id: 1 }],
    'packet/leaderboard_observe': LEADERBOARD_METRICS.map((metric) => ({ metric, id: 1 })),
  }
  for (const [type, observations] of Object.entries(accepted))
    for (const observation of [null, ...observations])
      expect(parse({ type, observation })).toEqual({ type, observation } as never)
  const rejected = {
    'packet/market_observe': [7, { kind: 'offers', item_type: 'wood', request: 4 }, { kind: 'catalogue', request: 3 }],
    'packet/market_prices_observe': [
      { item_type: 'x'.repeat(129), id: 1 },
      { item_type: '*', id: 1 },
      { item_type: 'quartz', id: 1.5 },
      { item_type: 'quartz', id: 1, arbitrary: true },
    ],
    'packet/leaderboard_observe': [
      { metric: 'unknown', id: 1 },
      { metric: 'xp', id: 1, season: 0 },
      { metric: 'xp', id: 1, season: '1' },
      { metric: 'xp', id: 1e20 },
    ],
  }
  for (const [type, observations] of Object.entries(rejected))
    for (const observation of [undefined, [], {}, ...observations]) refused({ type, observation })
  expect(has_market_page({ kind: 'types', request: 1 })).toBe(false)
  expect(has_market_page({ kind: 'characters', request: 1 })).toBe(true)
})

test('inspection and paired-bot observations accept their bounded shapes and null, and refuse the rest', () => {
  const inspection = (query: unknown, id: unknown = 1) => ({ type: 'packet/inspection_request', id, query })
  for (const query of [
    null,
    { kind: 'profile', address, after: null },
    { kind: 'profile', address, after: address },
    { kind: 'equipment', address, character_id: address },
  ])
    expect(parse(inspection(query))).toEqual(inspection(query) as never)
  for (const query of [
    undefined,
    { kind: 'profile', address: 'anything', after: null },
    { kind: 'profile', address },
    { kind: 'equipment', address, character_id: '0x1' },
    { kind: 'inventory', address },
  ])
    refused(inspection(query))
  for (const id of [-1, 1.5, 1e20, '1', null]) refused(inspection(null, id))
  for (const type of ['packet/agent_observe', 'packet/inventory_observe']) {
    const observation = {
      public_identifier: 'public-google-identifier',
      character_id: null,
      pairing: { address, multisig_public_key: 'public-key', signer_mode: 'host-persistent' },
    }
    expect(parse({ type, id: 1, observation })).toEqual({ type, id: 1, observation } as never)
    expect(
      valid_agent_observation({ ...observation, pairing: { ...observation.pairing, signer_mode: 'disposable' } })
    ).toBe(true)
    refused({ type, id: 1, observation: { ...observation, character_id: 'invalid' } })
    refused({ type, id: -1, observation: null })
  }
})

test('captured position payloads: the pre-glide client is refused, a gliding capture keeps flight and checkpoint', async () => {
  // Captured from the real browser publisher over a local WebSocket on 2026-09-09: character
  // 0x79ebc67c18575a6b20f7d69faecfd318c6136a23e687aae6cb92caa89db32e2c, testnet object version 1009255742.
  const recall = await Bun.file(new URL('./fixtures/recall-position.json', import.meta.url)).text()
  expect(() => parse_client_packet(recall)).toThrow(/gliding/)
  // Captured on 2026-10-12 from create_position_publisher over a real local WebSocket (glide_relay
  // fixture v1, checkpoint nauvis:50000:50000:1791720000000): a transport capture over fixture facts.
  const gliding = await Bun.file(new URL('./fixtures/gliding-position.json', import.meta.url)).text()
  expect(parse_client_packet(gliding)).toEqual({
    type: 'packet/position',
    character_id: '0xabc',
    checkpoint: 'nauvis:50000:50000:1791720000000',
    x: 50000,
    y: 24.141309434921983,
    z: 49997.17800053436,
    riding: true,
    gliding: true,
  })
})

test('the captured testnet inspection payload keeps identity, progression and rolls', () => {
  // Source object, version, checkpoint and capture date are recorded beside the websocket bytes.
  const [profile, equipment] = inspection_capture.messages.map(parse_server_packet)
  expect(profile).toMatchObject({
    type: 'packet/inspection_result',
    result: {
      kind: 'profile',
      profile: {
        character_count: 1,
        next: null,
        characters: [{ id: inspection_capture.provenance.character, classe: 'senshi', level: 30 }],
        jobs: expect.arrayContaining([{ job: 'FARMER', level: 1 }]),
      },
    },
  })
  expect(equipment).toMatchObject({
    result: {
      kind: 'equipment',
      equipment: [
        {
          id: inspection_capture.provenance.equipped_item,
          version: inspection_capture.provenance.item_version,
          slot: 'relic_1',
          stats: { vitality: 33768, action: 32778, movement: 32778 },
        },
      ],
    },
  })
})

test('a bot status passes the door with fees and endings and is refused when malformed', () => {
  const run = { id: 'r', character_id: '0x1', status: 'active', objective: { title: 'Gather' } }
  const status = { ready: true, event_fence: 3, sampled_at: 12.5, state: 'active', runs: [run], direct: null }
  const agent_status = (value: unknown) => ({ type: 'packet/agent_status', status: value })
  expect(parse({ ...agent_status(status), extra: 1 })).toEqual(agent_status(status) as never)
  const paid = { ...status, fees_mist: '-75', runs: [{ ...run, fees_mist: '46', dungeon_runs: 2 }] }
  expect(parse(agent_status(paid))).toEqual(agent_status(paid) as never)
  const ended = (reason: unknown) => ({ ...status, runs: [{ ...run, status: 'completed', ended: reason }] })
  for (const reason of [...RUN_ENDINGS, 'a_code_added_tomorrow'])
    expect(parse(agent_status(ended(reason)))).toEqual(agent_status(ended(reason)) as never)
  expect(RUN_ENDINGS.map(run_ending)).toEqual([...RUN_ENDINGS])
  for (const code of ['a_code_added_tomorrow', '', undefined, 3]) expect(run_ending(code)).toBeUndefined()
  for (const broken of [
    { ...status, ready: 'yes' },
    { ...status, state: undefined },
    { ...status, runs: ['r'] },
    { ...status, runs: [{ ...run, objective: { title: 'Gather', steps: 'one' } }] },
    { ...status, runs: [{ id: 'r', character_id: '0x1' }] },
    { ...status, direct: 'c' },
    { ...status, direct: { id: 'c', kind: 'gather', status: 'accepted' } },
    ...[69, '6.9', '', '1e9', null].flatMap((fees_mist) => [
      { ...status, fees_mist },
      { ...status, runs: [{ ...run, fees_mist }] },
    ]),
    ...[-1, 1.5, '2', null].map((dungeon_runs) => ({ ...status, runs: [{ ...run, dungeon_runs }] })),
    ...[1, true, null, {}, ['objective_reached']].map(ended),
    null,
  ])
    refused(agent_status(broken), 'Invalid agent status')
})

test("a listed type's per-lot floors stay exact past Number precision on the wire", () => {
  const raw =
    '{"type":"packet/market_types","items":[' +
    '{"item_type":"wood","name":"Wood","level":1,"category":"resource",' +
    '"quote":{"lots":{"10":"9007199254740993","100":"80000"},"units":1210,"change_bps":-250}},' +
    '{"item_type":"mokan","name":"Mokan Hat","level":12,"category":"hat",' +
    '"quote":{"lots":{},"units":3,"change_bps":null}}]}'
  const packet = parse_server_packet(raw) as Extract<ServerPacket, { type: 'packet/market_types' }>
  expect(packet.items.map(({ quote }) => quote)).toEqual([
    { lots: { 10: '9007199254740993', 100: '80000' }, units: 1210, change_bps: -250 },
    { lots: {}, units: 3, change_bps: null },
  ])
})

test('zone liveness: a set bit retires its group, u128 high bit included; packs report what remains', () => {
  const group = (index: number): MobGroupRow => ({ index, x: 0, z: 0, members: [] })
  const pack = (index: number, nodes: number): ResourcePackRow => ({ index, x: 0, z: 0, item_type: 'wheat', nodes })
  const groups = [group(0), group(1), group(2), group(3), group(127)]
  const live = live_mob_groups(groups, { mob_taken: String(0b1010n | (1n << 127n)), res_taken: [] })
  expect(live.map(({ index }) => index)).toEqual([0, 2])
  expect(live[0]).toBe(groups[0]!)
  const packs = [pack(0, 5), pack(1, 3), pack(2, 4), pack(9, 6)]
  const snapshot = structuredClone(packs)
  // res_taken grows lazily on chain: an index past its end was never touched
  expect(
    live_resource_packs(packs, { mob_taken: '0', res_taken: [2, 3] }).map(({ index, nodes }) => [index, nodes])
  ).toEqual([
    [0, 3],
    [2, 4],
    [9, 6],
  ])
  expect(packs).toEqual(snapshot)
  const zone_move = readFileSync(new URL('../../move/sources/zone.move', import.meta.url), 'utf8')
  const ttl = /const RESEARCH_TTL_MS: u64 = ([\d_]+);/.exec(zone_move)?.[1]
  expect(Number(ttl?.replaceAll('_', ''))).toBe(ZONE_RESEARCH_TTL_MS)
})

test('the travel proof twin: floored Euclidean budget as Move, pet speed only with a pet at both ends', () => {
  const proof = (overrides: Partial<Parameters<typeof travel_proof_ready>[0]> = {}) =>
    travel_proof_ready({
      from_x: 0,
      from_z: 0,
      from_ms: 0,
      pet_at_start: false,
      to_x: 0,
      to_z: 0,
      now_ms: 1_000,
      pet_now: false,
      ...overrides,
    })
  expect([proof({ to_x: 11 }), proof({ to_x: 12 }), proof({ to_x: 7, to_z: 8 }), proof({ to_x: 8, to_z: 8 })]).toEqual([
    true,
    false,
    true,
    false,
  ])
  expect(proof({ pet_at_start: true, pet_now: true, to_x: 17 })).toBeTrue()
  expect(proof({ pet_at_start: true, pet_now: true, to_x: 18 })).toBeFalse()
  expect(proof({ pet_at_start: false, pet_now: true, to_x: 17 })).toBeFalse()
  expect(proof({ pet_at_start: true, pet_now: false, to_x: 17 })).toBeFalse()
  expect(proof({ from_ms: 1_001 })).toBeFalse()
  expect(proof({ from_x: Number.NaN })).toBeFalse()
})

test('the request limiter: 60 a minute per caller, swept at its size cap, never resetting a survivor', () => {
  let now_ms = 0
  const now = () => now_ms
  const door = create_request_limiter({ now })
  for (let request = 0; request < 60; request += 1) expect(door.take('0xA')).toBeTrue()
  expect([door.take('0xa'), door.take('0xB')]).toEqual([false, true])
  now_ms = 60_000
  expect(door.take('0xa')).toBeTrue()
  now_ms = 0
  const swept = create_request_limiter({ capacity: 1, window_ms: 1_000, max_entries: 4, now })
  for (const key of ['0x1', '0x2', '0x3']) swept.take(key)
  now_ms = 2_000
  swept.take('0x4')
  swept.take('0x5')
  expect(swept.size()).toBe(2)
  const saturated = create_request_limiter({ capacity: 1, window_ms: 1_000, max_entries: 2, now })
  saturated.take('0x1')
  now_ms = 2_010
  saturated.take('0x2')
  now_ms = 2_020
  saturated.take('0x3')
  expect([saturated.size(), saturated.take('0x2')]).toEqual([2, false])
  let capacity = 2
  const dynamic = create_request_limiter({ capacity: () => capacity, now: () => 0 })
  expect([dynamic.take('o'), dynamic.take('o'), dynamic.take('o')]).toEqual([true, true, false])
  capacity = 3
  expect([dynamic.take('o'), dynamic.take('o')]).toEqual([true, false])
})

test('tournament coin claims split joint places in Move remainder order on exact u64 totals', () => {
  const team = (place: number, count: number): TournamentTeam => ({
    name: 'Team',
    revision: '0',
    allowed: [],
    place,
    seats: Array.from({ length: count }, (_, index) => ({
      character: String(index),
      owner: 'owner',
      sui_claimed: false,
      token_claimed: false,
      items_claimed: '0',
    })),
  })
  const row: TournamentRow = {
    id: 'cup',
    version: '1',
    name: 'Cup',
    status: 'finished',
    organizer: 'owner',
    format: 3,
    start_before_ms: 1,
    entry_fee_mist: '0',
    max_level: null,
    sui_bps: [9500, 0, 0, 0, 500],
    token_bps: [10000, 0, 0, 0, 0],
    sui_pool: '20020',
    sui_total: '20020',
    kares_pool: null,
    token_pool: '0',
    token_total: '0',
    token_version: '0',
    token_refunded: true,
    rewards: [],
    matches: [],
    teams: [team(5, 3), team(1, 1), team(5, 3), team(5, 3), team(5, 3)],
  }
  const fifth = [0, 2, 3, 4].flatMap((index) => [0, 1, 2].map((seat) => tournament_coin_claims(row, index, seat).sui))
  expect(fifth).toEqual([84n, 84n, 84n, 84n, 84n, 83n, 83n, 83n, 83n, 83n, 83n, 83n])
  expect(tournament_coin_claims(row, 1, 0).sui).toBe(19019n)
  const exact = {
    ...row,
    sui_bps: [10000, 0, 0, 0, 0],
    sui_total: '18446744073709551615',
    kares_pool: 'pool',
    token_total: '2',
    teams: [team(1, 3)],
  }
  expect(tournament_coin_claims(exact, 0, 0)).toEqual({ sui: 6148914691236517205n, kares: 1n })
  expect(tournament_coin_claims(exact, 0, 2)).toEqual({ sui: 6148914691236517205n, kares: 0n })
  const paid = {
    ...exact,
    teams: [{ ...exact.teams[0]!, seats: exact.teams[0]!.seats.map((seat) => ({ ...seat, sui_claimed: true })) }],
  }
  expect(tournament_coin_claims(paid, 0, 0)).toEqual({ sui: 0n, kares: 1n })
  expect(tournament_coin_claims({ ...row, status: 'open' }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
  expect(tournament_coin_claims({ ...row, teams: [team(0, 1)] }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
})

test('the inventory fold keeps newer rows, honours departures, and terminal trade replay cannot restore value', () => {
  const item = (version: string, id = 'item'): ItemRow => ({ id, version, amount: Number(version) }) as ItemRow
  const snapshot = { inventory: [item('8'), item('3', 'absent')], removed_item_versions: { removed: '7' } }
  expect(fold_inventory(snapshot, [item('5'), item('7', 'removed')])).toEqual([item('8')])
  expect(fold_inventory(snapshot, [item('8', 'removed')])).toEqual([item('8', 'removed')])
  const current = { inventory: [item('8')], removed_item_versions: {} }
  expect(fold_item_packet(current, { type: 'packet/item_removed', item: 'item', version: '7' })).toBe(current)
  expect(fold_item_packet(current, { type: 'packet/item_updated', item: item('7') }).inventory).toEqual([item('8')])
  const removed = fold_item_packet(current, { type: 'packet/item_removed', item: 'item', version: '8' })
  expect(fold_item_packet(removed, { type: 'packet/item_updated', item: item('8') })).toBe(removed)
  const restored = fold_item_packet(removed, { type: 'packet/item_updated', item: item('9') })
  expect(fold_item_packet(restored, { type: 'packet/item_removed', item: 'item', version: '8' })).toBe(restored)
  const trade = (values: Partial<TradeRow> = {}): TradeRow =>
    ({
      id: 'trade',
      a: 'alice',
      b: 'bob',
      offer_revision: 2,
      phase: 'settling',
      caps_a: [],
      caps_b: [],
      sui_a: '0',
      sui_b: '0',
      kares_a: '0',
      kares_b: '0',
      accept_a: false,
      accept_b: false,
      ...values,
    }) as TradeRow
  const stale = trade({ caps_a: [{ object: 'spent' } as TradeCapRow], sui_a: '100', kares_b: '200' })
  expect(reconcile_trade_row(trade(), stale)).toEqual(trade())
  expect(
    reconcile_trade_row(trade({ phase: 'negotiating', accept_a: true }), trade({ phase: 'negotiating' })).accept_a
  ).toBe(true)
})

test('the world projection: a population needs its baseline, a reroll invalidates it, shared windows retain zones', () => {
  const zone = { world: 'world', zx: 1, zz: 2, seed: '1', searched_at_ms: 1000, mob_taken: '0', res_taken: [] }
  const key = 'world:1:2'
  const population = { mobs: [], resources: [] }
  expect(merge_zone_population({}, {}, key, population)).toEqual({})
  const initial = merge_zone_rows({}, {}, [zone])
  const spawns = merge_zone_population(initial.zones, initial.spawns, key, population)
  const consumed = merge_zone_rows(initial.zones, spawns, [{ ...zone, mob_taken: '1' }])
  expect(consumed.spawns[key]).toBe(population)
  expect(merge_zone_rows(consumed.zones, consumed.spawns, [{ ...zone, seed: '2' }]).spawns).toEqual({})
  const window = { world: 'world', zones: [{ zx: 1, zz: 2 }] }
  expect(tracked_zone_keys([window, window]).size).toBe(1)
  expect(retain_zone_keys({ [key]: zone, 'other:1:2': zone }, tracked_zone_keys([window]))).toEqual({ [key]: zone })
})
