// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { KioskClient, type KioskOwnerCap } from '@mysten/kiosk'
import { bcs } from '@mysten/sui/bcs'

import { compose_agent_assets, check_asset_reserve, is_asset_intent } from '../src/agent_asset_transfer.ts'
import { agent_transfer_actions } from '../src/agent_transfer_actions.ts'
import { with_personal_kiosk } from '../src/ptb.ts'
import { read_agent_inventory } from '../src/agent_inventory.ts'
import { STAKE_POSITION_BCS } from '../src/kares_decode.ts'

import { kares_test_pins } from './helpers/kares.ts'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const sender = id(1),
  owner = id(2),
  game = id(3),
  kiosk_id = id(4),
  item_id = id(5),
  cap_id = id(6),
  character_id = id(7)
const cap: KioskOwnerCap = {
  objectId: id(8),
  kioskId: kiosk_id,
  isPersonal: true,
  version: '1',
  digest: '11111111111111111111111111111111',
}
const kiosk_client = new KioskClient({ client: {} as never, network: 'mainnet' })
const cap_bcs = bcs.struct('PurchaseCap', {
  id: bcs.Address,
  kiosk_id: bcs.Address,
  item_id: bcs.Address,
  min_price: bcs.u64(),
})
const fixture = () => {
  const state = { balance: 1000n, executions: 0, listed: false, owned: true, present: true }
  const sdk = {
    network: 'mainnet',
    game_type_package: game,
    read_kares_balance: async () => 1000n,
    tx: () => new Transaction(),
    pins: {
      package: game,
      version: { id: id(9) },
      kiosk_package: id(10),
      item_policy: { id: id(11) },
      kares_coin_type: `${id(12)}::kares::KARES`,
    },
    sui_client: { core: { getBalance: async () => ({ balance: { balance: state.balance } }) } },
    get_owned_kiosks: async () => ({ kioskOwnerCaps: state.owned ? [cap] : [], hasNextPage: false }),
    get_kiosk: async () => ({
      items: [
        {
          objectId: item_id,
          kioskId: kiosk_id,
          type: `${game}::item::Item`,
          listing: state.listed ? { isExclusive: false } : undefined,
        },
      ],
    }),
    hydrate_unknown: async () => undefined,
    with_personal_kiosk: (
      tx: Transaction,
      cap: KioskOwnerCap | null,
      compose: Parameters<typeof with_personal_kiosk>[3]
    ) => with_personal_kiosk(tx, kiosk_client, cap, compose),
    simulate: async (tx: Transaction) => {
      tx.setGasBudget(100)
      return {
        Transaction: {
          effects: {
            status: { success: true },
            gasUsed: { computationCost: '10', storageCost: '0', storageRebate: '0' },
          },
        },
      }
    },
    execute: async () => {
      state.executions++
      return { Transaction: { digest: 'test-digest' } }
    },
  }
  const offer = { item_id, seller_kiosk: kiosk_id, purchase_cap: cap_id, recipient: owner, agent_address: sender }
  const client = {
    core: {
      getObject: async () => ({ object: { objectId: item_id, version: '1' } }),
      getObjects: async () => ({ objects: [{ objectId: item_id, version: '1' }] }),
      listOwnedObjects: async ({ type }: { type: string }) => ({
        objects:
          state.present && type.includes('::item::Item')
            ? [
                {
                  objectId: cap_id,
                  type,
                  owner: { $kind: 'AddressOwner', AddressOwner: owner },
                  content: cap_bcs.serialize({ id: cap_id, kiosk_id, item_id, min_price: 0 }).toBytes(),
                },
              ]
            : [],
        hasNextPage: false,
      }),
    },
  }
  return { state, sdk, client, offer }
}
const asset_offer = {
  kind: 'asset_offer' as const,
  recipient: owner,
  items: [{ item_id, kiosk: kiosk_id, version: '1' }],
  sui_mist: '400',
  kares_mist: '0',
  reserve_mist: '200',
}
const calls = (tx: Transaction) => tx.getData().commands.flatMap((c) => (c.MoveCall ? [c.MoveCall.function] : []))

test('selected item and amount use existing primitives, fixed owner and source kiosk; listed/foreign assets fail', async () => {
  const f = fixture()
  const tx = await compose_agent_assets(f.client as never, f.sdk as never, sender, asset_offer, owner)
  expect(tx.getData().sender).toBe(sender)
  expect(calls(tx)).toContain('list_with_purchase_cap')
  expect(tx.getData().commands.filter((c) => c.TransferObjects)).toHaveLength(2)
  await expect(
    compose_agent_assets(f.client as never, f.sdk as never, sender, { ...asset_offer, recipient: sender }, owner)
  ).rejects.toThrow('Google owner')
  f.state.listed = true
  await expect(compose_agent_assets(f.client as never, f.sdk as never, sender, asset_offer, owner)).rejects.toThrow(
    'listed'
  )
  f.state.listed = false
  f.state.owned = false
  await expect(compose_agent_assets(f.client as never, f.sdk as never, sender, asset_offer, owner)).rejects.toThrow(
    'no longer owned'
  )
})
test('prepared gas budget and explicit reserve use a fresh balance; failure blocks all signing and consumes review', async () => {
  const f = fixture()
  const actions = agent_transfer_actions(f.sdk as never, {
    address: sender,
    kiosk_cap: async () => cap,
    assets: { client: f.client as never, recipient: owner },
  })
  const review = await actions.prepare(asset_offer)
  if (!is_asset_intent(review.intent)) throw new Error('Expected asset review')
  expect(Object.isFrozen(review.intent.items)).toBe(true)
  f.state.balance = 650n
  await expect(review.confirm()).rejects.toThrow('retained reserve')
  expect(f.state.executions).toBe(0)
  await expect(review.confirm()).rejects.toThrow('Reconcile')
  const tx = new Transaction()
  tx.setGasBudget(100)
  await expect(check_asset_reserve(f.sdk as never, sender, asset_offer, tx)).rejects.toThrow('GasBalanceTooLow')
})
test('incoming selection is checked as a complete set before an atomic claim or cancel', async () => {
  const f = fixture()
  const intent = { kind: 'asset_claim' as const, agent_address: sender, items: [f.offer] }
  expect(calls(await compose_agent_assets(f.client as never, f.sdk as never, owner, intent))).toContain(
    'confirm_request'
  )
  expect(
    calls(await compose_agent_assets(f.client as never, f.sdk as never, owner, { ...intent, kind: 'asset_cancel' }))
  ).toEqual(['return_purchase_cap'])
  await expect(
    compose_agent_assets(f.client as never, f.sdk as never, owner, { ...intent, items: [f.offer, f.offer] })
  ).rejects.toThrow('once')
  f.state.present = false
  await expect(compose_agent_assets(f.client as never, f.sdk as never, owner, intent)).rejects.toThrow(
    'ownership or custody changed'
  )
})

test('inventory includes every kiosk/owned page, available/listed/current equipment, balances and staking positions', async () => {
  const f = fixture()
  const item_type = `${game}::item::Item`,
    character_type = `${game}::character::Character`
  const position_type = `${id(13)}::staking::StakePosition<${f.sdk.pins.kares_coin_type}>`
  const position = STAKE_POSITION_BCS.serialize({
    id: id(14),
    pool: id(15),
    amount: 25n,
    kares_index: 0n,
    sui_index: 0n,
    kares_accrued: 0n,
    sui_accrued: 0n,
  }).toBytes()
  const visited: string[] = []
  const sdk = {
    ...f.sdk,
    pins: { ...f.sdk.pins, kares_rewards_package_original: id(13) },
    get_owned_kiosks: async (_owner: string, page?: { cursor?: string }) =>
      page?.cursor
        ? { kioskOwnerCaps: [{ ...cap, kioskId: id(16) }], hasNextPage: false }
        : { kioskOwnerCaps: [cap], hasNextPage: true, nextCursor: 'second' },
    get_kiosk: async (kiosk: string) => ({
      kiosk: { profits: '37' },
      items:
        kiosk === kiosk_id
          ? [
              { objectId: item_id, type: item_type, kioskId: kiosk },
              { objectId: character_id, type: character_type, kioskId: kiosk },
            ]
          : [{ objectId: id(17), type: item_type, kioskId: kiosk, listing: {} }],
    }),
  }
  const client = {
    core: {
      getBalance: async ({ owner }: { owner: string }) => {
        expect(owner).toBe(sender)
        return { balance: { balance: '1000' } }
      },
      listOwnedObjects: async ({ cursor }: { cursor?: string }) => {
        visited.push(cursor ?? 'first')
        return cursor
          ? { objects: [{ objectId: id(14), type: position_type, content: position }], hasNextPage: false }
          : {
              objects: [{ objectId: id(18), type: '0x2::kiosk::KioskOwnerCap', content: new Uint8Array() }],
              hasNextPage: true,
              cursor: 'next',
            }
      },
      listDynamicFields: async ({ parentId }: { parentId: string }) => ({
        dynamicFields:
          parentId === character_id ? [{ fieldId: id(19), name: { type: `${game}::equipment::EquipmentKey` } }] : [],
        hasNextPage: false,
      }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: [
          {
            objectId: objectIds[0],
            version: '1',
            type: item_type,
            json:
              objectIds[0] === id(19)
                ? { value: { contents: [{ key: 'hat', value: { item: id(20) } }] } }
                : { name: 'Selected item', item_type: 'hat', category: 'hat', level: 1, amount: '2' },
          },
        ],
      }),
    },
  }
  const inventory = await read_agent_inventory(client as never, sdk as never, sender)
  expect(visited).toEqual(['first', 'next'])
  expect(inventory.items.map((row) => row.status).sort()).toEqual(['available', 'equipped', 'listed'])
  expect(inventory.items.every((row) => row.item.amount === 2)).toBe(true)
  expect(inventory.owned).toHaveLength(2)
  expect(inventory.proceeds.map((row) => row.sui_mist)).toEqual(['37', '37'])
  expect(inventory.positions).toEqual([{ id: id(14), amount: '25' }])
  const missing_kares = {
    ...sdk,
    pins: { ...sdk.pins, kares_coin_type: undefined },
    read_kares_balance: async () => null,
  }
  const partial = await read_agent_inventory(client as never, missing_kares as never, sender)
  expect(partial.kares_mist).toBeNull()
  expect(partial.items).toHaveLength(3)
  expect(partial.positions).toEqual([])
  const incomplete = {
    core: { ...client.core, listOwnedObjects: async () => ({ objects: [], hasNextPage: true, cursor: null }) },
  }
  await expect(read_agent_inventory(incomplete as never, sdk as never, sender)).rejects.toThrow('pagination')
})

test('public listings can be cancelled through the shared builder; exclusive transfers cannot be overridden', async () => {
  const f = fixture()
  f.state.listed = true
  const intent = { kind: 'asset_delist' as const, items: [{ item_id, kiosk: kiosk_id, version: '1' }] }
  const tx = await compose_agent_assets(f.client as never, f.sdk as never, sender, intent)
  expect(calls(tx)).toContain('delist')
  const sdk = {
    ...f.sdk,
    get_kiosk: async () => ({
      items: [{ objectId: item_id, type: `${game}::item::Item`, listing: { isExclusive: true } }],
    }),
  }
  await expect(compose_agent_assets(f.client as never, sdk as never, sender, intent)).rejects.toThrow('exclusive')
})
test('collecting kiosk proceeds reuses the canonical withdrawal builder and pays only its own address', async () => {
  const f = fixture()
  const sdk = { ...f.sdk, with_owner_kiosk: f.sdk.with_personal_kiosk }
  const tx = await compose_agent_assets(f.client as never, sdk as never, sender, {
    kind: 'asset_collect',
    items: [{ kiosk: kiosk_id }],
  })
  expect(calls(tx)).toContain('withdraw')
  f.state.owned = false
  await expect(
    compose_agent_assets(f.client as never, sdk as never, sender, {
      kind: 'asset_collect',
      items: [{ kiosk: kiosk_id }],
    })
  ).rejects.toThrow('Cap')
})
test('selected equipped items are checked against the current character map before unequip', async () => {
  const f = fixture()
  let current = item_id
  const sdk = {
    ...f.sdk,
    get_kiosk: async () => ({ items: [{ objectId: character_id, type: `${game}::character::Character` }] }),
    doors: { unequip_item: (tx: Transaction) => tx.moveCall({ target: `${game}::api::unequip_item` }) },
  }
  const client = {
    core: {
      getObject: async () => ({ object: { objectId: item_id, version: '1' } }),
      listDynamicFields: async () => ({
        dynamicFields: [{ fieldId: id(30), name: { type: `${game}::equipment::EquipmentKey` } }],
        hasNextPage: false,
      }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects:
          objectIds[0] === item_id
            ? [{ objectId: item_id, version: '1' }]
            : [{ objectId: id(30), json: { value: { contents: [{ key: 'hat', value: { item: current } }] } } }],
      }),
    },
  }
  const intent = {
    ...asset_offer,
    sui_mist: '0',
    items: [{ item_id, kiosk: kiosk_id, version: '1', character_id, slot: 'hat' }],
  }
  const tx = await compose_agent_assets(client as never, sdk as never, sender, intent, owner)
  const order = calls(tx)
  expect(order.indexOf('unequip_item')).toBeLessThan(order.indexOf('list_with_purchase_cap'))
  current = id(31)
  await expect(compose_agent_assets(client as never, sdk as never, sender, intent, owner)).rejects.toThrow(
    'equipment changed'
  )
})

test('directly owned game items use ordinary kiosk deposit and exclusive offers; foreign ownership is refused', async () => {
  const f = fixture()
  let actual_owner = sender
  const client = {
    core: {
      getObject: async () => ({
        object: {
          objectId: item_id,
          version: '1',
          type: `${game}::item::Item`,
          owner: { $kind: 'AddressOwner', AddressOwner: actual_owner },
        },
      }),
    },
  }
  const intent = { ...asset_offer, sui_mist: '0', items: [{ item_id, kiosk: '', version: '1', direct: true }] }
  const tx = await compose_agent_assets(client as never, f.sdk as never, sender, intent, owner)
  expect(calls(tx).indexOf('lock')).toBeLessThan(calls(tx).indexOf('list_with_purchase_cap'))
  actual_owner = owner
  await expect(compose_agent_assets(client as never, f.sdk as never, sender, intent, owner)).rejects.toThrow(
    'Direct item ownership changed'
  )
})
test('KARES amount selection uses the canonical payment helper; staking withdrawal returns to the multisig', async () => {
  const f = fixture()
  const transfer = await compose_agent_assets(
    f.client as never,
    f.sdk as never,
    sender,
    { ...asset_offer, items: [], sui_mist: '0', kares_mist: '5' },
    owner
  )
  expect(
    JSON.stringify(transfer.getData(), (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value))
  ).toContain(f.sdk.pins.kares_coin_type)
  const sdk = { ...f.sdk, pins: kares_test_pins, door_context: { obj: (tx: Transaction, id: string) => tx.object(id) } }
  const unstake = await compose_agent_assets(f.client as never, sdk as never, sender, {
    kind: 'asset_unstake',
    items: [{ id: id(40), amount: '5' }],
  })
  expect(calls(unstake)).toContain('withdraw')
  expect(unstake.getData().inputs.some((input) => input.Pure?.bytes === bcs.Address.serialize(sender).toBase64())).toBe(
    true
  )
})
test('a changed stack version and an incomplete incoming set abort before building any transfer', async () => {
  const f = fixture()
  const client = {
    core: { ...f.client.core, getObject: async () => ({ object: { objectId: item_id, version: '2' } }) },
  }
  await expect(compose_agent_assets(client as never, f.sdk as never, sender, asset_offer, owner)).rejects.toThrow(
    'version changed'
  )
  await expect(
    compose_agent_assets(f.client as never, f.sdk as never, owner, {
      kind: 'asset_claim',
      agent_address: sender,
      items: [f.offer, { ...f.offer, item_id: id(41), purchase_cap: id(42) }],
    })
  ).rejects.toThrow('ownership or custody changed')
})

test('an ordinary wallet without a pairing-bound recipient cannot prepare an outgoing asset offer', async () => {
  const f = fixture()
  const actions = agent_transfer_actions(f.sdk as never, {
    address: owner,
    kiosk_cap: async () => cap,
    assets: { client: f.client as never },
  })
  await expect(actions.prepare({ ...asset_offer, recipient: sender })).rejects.toThrow('Google owner')
  expect(f.state.executions).toBe(0)
})

test('confirming an item offer submits only the offer, never the separate recipient claim', async () => {
  const f = fixture()
  const submitted: Transaction[] = []
  const sdk = {
    ...f.sdk,
    execute: async (tx: Transaction) => {
      submitted.push(tx)
      return f.sdk.execute()
    },
  }
  const actions = agent_transfer_actions(sdk as never, {
    address: sender,
    kiosk_cap: async () => cap,
    assets: { client: f.client as never, recipient: owner },
  })
  const review = await actions.prepare({ ...asset_offer, sui_mist: '0' })
  expect(submitted).toHaveLength(0)
  await review.confirm()
  expect(submitted).toHaveLength(1)
  expect(calls(submitted[0]!)).toContain('list_with_purchase_cap')
  expect(calls(submitted[0]!)).not.toContain('purchase_with_cap')
  expect(calls(submitted[0]!)).not.toContain('confirm_request')
  expect(f.state.executions).toBe(1)
})

test('a changed member of a reviewed item group prevents the entire offer from submitting', async () => {
  const f = fixture()
  const second = id(43)
  let second_version = '1'
  const client = {
    core: {
      ...f.client.core,
      getObject: async ({ objectId }: { objectId: string }) => ({
        object: { objectId, version: objectId === second ? second_version : '1' },
      }),
    },
  }
  const sdk = {
    ...f.sdk,
    get_kiosk: async () => ({
      items: [item_id, second].map((object_id) => ({
        objectId: object_id,
        kioskId: kiosk_id,
        type: `${game}::item::Item`,
      })),
    }),
  }
  const actions = agent_transfer_actions(sdk as never, {
    address: sender,
    kiosk_cap: async () => cap,
    assets: { client: client as never, recipient: owner },
  })
  const review = await actions.prepare({
    ...asset_offer,
    sui_mist: '0',
    items: [...asset_offer.items, { item_id: second, kiosk: kiosk_id, version: '1' }],
  })
  second_version = '2'
  await expect(review.confirm()).rejects.toThrow('version changed')
  expect(f.state.executions).toBe(0)
  await expect(review.confirm()).rejects.toThrow('Reconcile')
})
