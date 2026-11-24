// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The bot collects its own sale proceeds and recovers its certified market receipts.
import { expect, test, describe } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'
import type { Receipt } from '@aresrpg/sdk/cache'

import { empty_inventory, type ActorInventory } from '../src/actor_inventory.ts'
import type { ControlStore } from '../src/store.ts'
import { fold_actor_market } from '../src/actor_market.ts'
import { id } from '../../sdk/test/helpers/transport.ts'
import { type Command, type Lane, lane_key_for, empty_lane } from '../src/control.ts'
import {
  AUTO_COLLECT_MIN_MIST,
  collection_due,
  create_market_collector,
  empty_proceeds,
  fold_proceeds,
} from '../src/market_collection.ts'
import { settled_market_receipts, read_market_receipts, fold_market_receipts } from '../src/market_recovery.ts'

import { character, profession_context, resource, hero_runs as fixture } from './fixture_game.ts'
import { put, runtime_fixture, fixture_bot, memory_store } from './fixture.ts'

describe('market collection', () => {
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
})

describe('market recovery', () => {
  const restore_market_receipts = async (store: ControlStore, lane: Lane, inventory: ActorInventory) =>
    fold_market_receipts(await read_market_receipts(store, lane), inventory)
  const proof = (version: string) => {
    const digest = `receipt-${version}`
    const command: Command = {
      ...profession_context().command,
      id: `command-${version}`,
      lane_key: lane_key_for(fixture_bot),
      kind: 'market_buy',
      status: 'completed',
      payload: { item_id: 'item', seller_kiosk: 'seller' },
      result: { digest },
    }
    const receipt: Receipt = {
      Transaction: {
        digest,
        effects: { status: { success: true }, lamportVersion: version, changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    }
    return { command, receipt, digest }
  }
  const retained = async () => {
    const store = memory_store()
    const { command, receipt, digest } = proof('9')
    const base = empty_lane(fixture_bot)
    const lane = { ...base, catalogue_receipts: settled_market_receipts(base, command, receipt) }
    await put(store, `command:${command.id}`, { ...command, receipt })
    return { store, lane, command, receipt, digest }
  }
  test('session reconnect restores certified catalogue floor before accepting stale pages', async () => {
    const { store, lane } = await retained()
    const restored = await restore_market_receipts(store, lane, empty_inventory())
    expect(restored.catalogues.seller?.version).toBe('9')
    const stale = fold_actor_market(restored, {
      type: 'packet/market_slice',
      observation: { kind: 'offers', category: 'resource', item_type: resource.item_type, request: 1 },
      listings: [],
      next_cursor: null,
      kiosk_versions: { seller: '8' },
    })
    expect(stale).toBe(restored)
    expect(await restore_market_receipts(store, lane, restored)).toEqual(restored)
  })
  test('a proof released by a newer settlement for its kiosk is skipped, not treated as corruption', async () => {
    const { store, lane } = await retained()
    const newer = proof('10')
    // Between this read of the lane and its proofs, a newer settlement replaced and released the pointer.
    await put(store, lane_key_for(fixture_bot), {
      ...lane,
      catalogue_receipts: settled_market_receipts(lane, newer.command, newer.receipt),
    })
    await put(store, `command:${newer.command.id}`, { ...newer.command, receipt: newer.receipt })
    await put(store, `command:command-9`, null)
    expect((await restore_market_receipts(store, lane, empty_inventory())).catalogues.seller).toBeUndefined()
  })
  for (const corruption of ['lane', 'digest', 'version', 'kiosk', 'missing'] as const) {
    test(`session reconnect rejects ${corruption} proof corruption`, async () => {
      const { store, lane, command, receipt } = await retained()
      if (corruption === 'lane') await put(store, `command:${command.id}`, { ...command, receipt, lane_key: 'other' })
      if (corruption === 'digest')
        await put(store, `command:${command.id}`, {
          ...command,
          receipt: { Transaction: { ...receipt.Transaction!, digest: 'other' } },
        })
      const pointer = lane.catalogue_receipts!.seller!
      const pointers = {
        seller: {
          ...pointer,
          ...(corruption === 'version' ? { version: '10' } : {}),
          ...(corruption === 'missing' ? { command_id: 'missing' } : {}),
        },
      }
      const bad = { ...lane, catalogue_receipts: corruption === 'kiosk' ? { other: pointer } : pointers }
      await expect(restore_market_receipts(store, bad, empty_inventory())).rejects.toThrow(
        'market_receipt_proof_invalid'
      )
    })
  }
})
