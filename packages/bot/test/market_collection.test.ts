// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import type { Command, Lane } from '../src/control.ts'
import { lane_key_for } from '../src/control.ts'
import {
  AUTO_COLLECT_MIN_MIST,
  collection_due,
  create_market_collector,
  empty_proceeds,
  fold_proceeds,
} from '../src/market_collection.ts'
import { id } from '../../sdk/test/helpers/transport.ts'

import { put } from './helpers/control_fixture.ts'
import { character } from './helpers/profession_fixture.ts'
import { fixture } from './helpers/hero_runs_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'

type Profit = Readonly<{ kiosk: string; amount_mist: string }>
const KIOSK = id(12)
const history = (profits: readonly Profit[]): ServerPacket => ({
  type: 'packet/market_history',
  sales: [],
  revenue_30d_mist: '0',
  total: 0,
  profits: [...profits],
})
const sold = (n: number): ServerPacket => ({
  type: 'packet/listing_sold',
  sale: {
    id: `7:${n}:0`,
    object: id(40),
    kind: 'item',
    name: null,
    item_type: 'wood',
    amount: 1,
    price_mist: '5',
    counterparty: id(7),
    ts_ms: 1,
  },
})
// Amounts are whole SUI tenths: the automatic collection ignores less than 0.1 SUI.
const held = (amount_mist = '500000000', kiosk = KIOSK) => history([{ kiosk, amount_mist }])
const fold = (...packets: readonly (ServerPacket | null)[]) => packets.reduce(fold_proceeds, empty_proceeds())

/** The collector of one wallet session over the hero fixture's store, control service and grant. */
const collecting = async (grants?: readonly string[]) => {
  const f = await fixture()
  const shared: (string | null | undefined)[] = []
  const collect = create_market_collector(
    f.store,
    f.control,
    f.bot,
    new Set(grants ?? [f.grant.id]),
    async () => {
      shared[shared.length] = (await f.lane()).direct
    },
    f.options.report_failure
  )
  const commands = async () => {
    const keys = await f.store.scan_keys('command:', 100)
    const rows = await Promise.all(keys.map((key) => f.store.read<Command>(key)))
    return rows.filter((row) => row?.kind === 'market_collect')
  }
  const direct = async () => (await f.store.read<Command>(`command:${(await f.lane()).direct}`))!
  const finish = async (command: Command, status: Command['status']) => {
    await put(f.store, `command:${command.id}`, { ...command, status, result: { digest: 'fixture' } })
    await put(f.store, f.key, { ...(await f.lane()), active_command: null })
  }
  return { ...f, collect, commands, direct, finish, shared }
}
const buy = async (f: Awaited<ReturnType<typeof collecting>>) => {
  const { decision_revision, observation_revision } = await f.lane()
  return f.control.accept(f.grant, {
    idempotency_key: 'buy',
    kind: 'market_buy',
    payload: {
      character_id: character.id,
      item_id: id(31),
      seller_kiosk: id(32),
      listing_version: '4',
      item_type: 'lorito_key',
      amount: 1,
      price_mist: '1000',
      max_total_mist: '1100',
    },
    decision_revision,
    observation_revision,
  })
}

test('a balance push is one change, the same state seen twice is none, and a sale alone asks nothing', () => {
  expect(collection_due(empty_proceeds())).toBe(false)
  const first = fold(held())
  expect(first.kiosks).toEqual([KIOSK])
  expect(collection_due(first)).toBe(true)
  // The same push again is the same value: no new change.
  expect(fold_proceeds(first, held())).toBe(first)
  const issued = { ...first, issued: first.change }
  expect(collection_due(issued)).toBe(false)
  expect(collection_due(fold_proceeds(issued, held()))).toBe(false)
  // A sale enriches the slice and triggers nothing; the balance push after it is the new change,
  // even when the kiosk holds the same amount as before the last collection.
  const after_sale = fold_proceeds(issued, sold(1))
  expect(collection_due(after_sale)).toBe(false)
  expect(collection_due(fold_proceeds(after_sale, held()))).toBe(true)
  // A redelivered sale is the same sale; another amount without a sale is still a change.
  expect(fold_proceeds(after_sale, sold(1))).toEqual(after_sale)
  expect(collection_due(fold_proceeds(issued, held('900000000')))).toBe(true)
})

test('only kiosks that hold proceeds are named, in one order, and other packets change nothing', () => {
  const state = fold(
    history([
      { kiosk: id(14), amount_mist: '300000000' },
      { kiosk: KIOSK, amount_mist: '500000000' },
      { kiosk: id(15), amount_mist: '0' },
      { kiosk: 'not-a-kiosk', amount_mist: '800000000' },
      { kiosk: id(16), amount_mist: '-4' },
    ])
  )
  expect(state.kiosks).toEqual([KIOSK, id(14)])
  // Nothing held is a no-op: no kiosk, nothing due.
  expect(collection_due(fold(history([])))).toBe(false)
  expect(collection_due(fold(history([{ kiosk: KIOSK, amount_mist: '0' }])))).toBe(false)
  for (const packet of [null, { type: 'packet/game_state', frozen: false } as ServerPacket])
    expect(fold_proceeds(state, packet)).toBe(state)
})

test('one collection per observed change, to the observed kiosks, and none for a state already served', async () => {
  const f = await collecting()
  for (const packet of [null, sold(1), history([])]) await f.collect(packet)
  expect(await f.commands()).toEqual([])
  await f.collect(held())
  const first = await f.direct()
  expect(first).toMatchObject({ kind: 'market_collect', status: 'accepted', payload: { kiosks: [KIOSK] } })
  // The owner's clients were told the wallet status before the slot changed hands.
  expect(f.shared).toEqual([null])
  for (const packet of [held(), null, held(), sold(1)]) await f.collect(packet)
  expect(await f.commands()).toHaveLength(1)
  // Completed: the same balance pushed again without a sale since is the state already served.
  await f.finish(first, 'completed')
  await f.collect(held())
  expect(await f.commands()).toHaveLength(1)
  // A new sale and its balance push are a new change.
  await f.collect(sold(2))
  await f.collect(held())
  const second = await f.direct()
  expect(second.id).not.toBe(first.id)
  expect(second).toMatchObject({ kind: 'market_collect', status: 'accepted', payload: { kiosks: [KIOSK] } })
  expect(f.errors).toEqual([])
  await f.runtime.stop()
})

test('an automatic collection waits its turn behind a signing hero and signs through the same queue', async () => {
  const f = await collecting()
  const hero = await f.start(character.id)
  await f.pass()
  const signing = await f.command_of(hero.id)
  await f.collect(held())
  const collection = await f.direct()
  expect(await f.lane()).toMatchObject({ active_command: signing.id, direct: collection.id, decision_revision: 0 })
  // The hero's transaction is in flight: the collection takes nothing and replaces nothing.
  expect(await f.pass()).toBeNull()
  expect((await f.store.read<Command>(`command:${signing.id}`))?.status).toBe('accepted')
  await f.settle(hero.id)
  expect(await f.pass()).toMatchObject({ id: collection.id, kind: 'market_collect' })
  expect(await f.lane()).toMatchObject({ active_command: collection.id, latest_command: collection.id })
  expect(['active', 'waiting']).toContain((await f.run(hero.id)).status)
  expect(f.errors).toEqual([])
  await f.runtime.stop()
})

test('an uncertain or failed collection is never sent again for the same observed state', async () => {
  for (const status of ['uncertain', 'failed'] as const) {
    const f = await collecting()
    await f.collect(held())
    const collection = await f.direct()
    expect(await f.pass()).toMatchObject({ id: collection.id })
    await f.finish(collection, status)
    for (const packet of [held(), null, held()]) await f.collect(packet)
    for (const _ of [1, 2]) expect(await f.pass()).toBeNull()
    expect(await f.commands()).toHaveLength(1)
    expect((await f.direct()).status).toBe(status)
    await f.runtime.stop()
  }
})

test('a player command that is not final is never replaced; the collection follows it', async () => {
  const f = await collecting()
  const order = await buy(f)
  await f.collect(held())
  expect((await f.lane()).direct).toBe(order.id)
  // An unknown outcome stays the wallet's visible direct command.
  await put(f.store, `command:${order.id}`, { ...order, status: 'uncertain' })
  await f.collect(null)
  expect((await f.lane()).direct).toBe(order.id)
  expect(await f.commands()).toEqual([])
  expect(f.shared).toEqual([])
  await put(f.store, `command:${order.id}`, { ...order, status: 'completed', result: { digest: 'fixture' } })
  await f.collect(null)
  expect(await f.direct()).toMatchObject({ kind: 'market_collect', status: 'accepted' })
  // The status shared before the slot changed hands still named the player's command.
  expect(f.shared).toEqual([order.id])
  // While the collection is held, a player command is refused like behind any held direct command.
  await expect(buy(f)).rejects.toThrow('bot_busy_or_paused')
  expect(f.errors).toEqual([])
  await f.runtime.stop()
})

test('a pause, a wallet without a play grant and a stale wallet collect nothing until that changes', async () => {
  const paused = await collecting()
  await put(paused.store, paused.key, { ...(await paused.lane()), paused: true })
  await paused.collect(held())
  expect(await paused.commands()).toEqual([])
  await put(paused.store, paused.key, { ...(await paused.lane()), paused: false })
  await paused.collect(null)
  expect(await paused.commands()).toHaveLength(1)
  await paused.runtime.stop()

  const unauthorized = await collecting()
  await put(unauthorized.store, 'grant:grant', { ...unauthorized.grant, scopes: ['bot:observe'] })
  await unauthorized.collect(held())
  await put(unauthorized.store, 'grant:grant', { ...unauthorized.grant, revoked: true })
  await unauthorized.collect(null)
  expect(await unauthorized.commands()).toEqual([])
  await put(unauthorized.store, 'grant:grant', unauthorized.grant)
  await unauthorized.collect(null)
  expect(await unauthorized.commands()).toHaveLength(1)
  expect(unauthorized.errors).toEqual([])
  await unauthorized.runtime.stop()

  const stale = await collecting()
  stale.clock.now += 120_000
  await stale.collect(held())
  expect(await stale.commands()).toEqual([])
  expect(stale.errors).toEqual([])
  await stale.runtime.stop()

  const nobody = await collecting([])
  await nobody.collect(held())
  expect(await nobody.commands()).toEqual([])
  await nobody.runtime.stop()
})

test('an unexpected failure is reported once, never thrown, and gives up that change only', async () => {
  const f = await collecting()
  const failing = create_market_collector(
    f.store,
    {
      accept: async () => {
        throw new Error('store_unreachable')
      },
    },
    f.bot,
    new Set([f.grant.id]),
    async () => {},
    f.options.report_failure
  )
  for (const packet of [held(), held(), null]) await failing(packet)
  expect(f.errors.map(String)).toEqual(['Error: store_unreachable'])
  await failing(held('900000000'))
  expect(f.errors).toHaveLength(2)
  await f.runtime.stop()
})

test('the live runtime sends the collection itself when its own socket shows proceeds', async () => {
  const f = await runtime_fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const lane_key = lane_key_for(f.bot)
  expect((await f.store.read<Lane>(lane_key))?.direct ?? null).toBeNull()
  await f.send(sold(1))
  await f.send(held('700000000'))
  await f.runtime.settle()
  const lane = (await f.store.read<Lane>(lane_key))!
  const collection = await f.store.read<Command>(`command:${lane.direct}`)
  expect(collection).toMatchObject({ kind: 'market_collect', payload: { kiosks: [KIOSK] }, grant_id: f.grant.id })
  // The same push again changes nothing: still that one command.
  await f.send(held('700000000'))
  await f.runtime.settle()
  expect((await f.store.read<Lane>(lane_key))!.direct).toBe(lane.direct!)
  const keys = await f.store.scan_keys('command:', 100)
  expect(keys).toEqual([`command:${lane.direct}`])
  await f.runtime.stop()
})

// Owner, 2026-11-21: "auto collect from 0.1 SUI". Dust costs more gas to collect than it brings.
test('proceeds under 0.1 SUI are left in the kiosk; the push that reaches it is collected', () => {
  const dust = fold(held('99999999'))
  expect(collection_due(dust)).toBe(false)
  expect(dust.kiosks).toEqual([])
  const reached = fold_proceeds(dust, held(AUTO_COLLECT_MIN_MIST.toString()))
  expect(collection_due(reached)).toBe(true)
  expect(reached.kiosks).toEqual([KIOSK])
  // Two kiosks count together.
  const together = fold(
    history([
      { kiosk: id(14), amount_mist: '60000000' },
      { kiosk: KIOSK, amount_mist: '40000000' },
    ])
  )
  expect(collection_due(together)).toBe(true)
})
