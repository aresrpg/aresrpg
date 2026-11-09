// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { expect, test } from 'bun:test'
import { fromBase64, normalizeStructTag } from '@mysten/sui/utils'

import {
  read_agent_item_returns,
  check_agent_return,
  decode_return_equipment,
  decode_agent_purchase_cap,
  read_agent_returns,
} from '../src/agent_returns.ts'

// Real mainnet object 0xb134...9d43, version 780663637, captured 2026-11-05 via
// https://graphql.mainnet.sui.io/graphql objects(filter:{type:"0x2::kiosk::PurchaseCap"}).
// Generic T was slush_wallet_og_badge::Nft; PurchaseCap's fields do not depend on phantom T.
const captured = fromBase64(
  'sTRjgw4y3MUkcH7ahKA9kReV5/L7KDMPA/cSGvepnUOHQZnxcjRktncZemVaBru4oBamuGR4vGoBDYaPcARAConqXAfP0LAPGhy2D+Kxzq9LNBih4EflDX2Gthcfq4wQAOQLVAIAAAA='
)
const cap_id = '0xb13463830e32dcc524707eda84a03d911795e7f2fb28330f03f7121af7a99d43'
const kiosk_id = '0x874199f1723464b677197a655a06bbb8a016a6b86478bc6a010d868f7004400a'
const character_id = '0x89ea5c07cfd0b00f1a1cb60fe2b1ceaf4b3418a1e047e50d7d86b6171fab8c10'
const owner = `0x${'1'.repeat(64)}`
const agent = `0x${'2'.repeat(64)}`
const game = `0x${'3'.repeat(64)}`
const type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${game}::character::Character>`)
// Synthetic zero-price scenario derived from the captured layout, not claimed as live custody.
const zero = captured.slice()
zero.fill(0, zero.length - 8)
const object = () => ({
  objectId: cap_id,
  type,
  version: '7',
  digest: 'object-digest',
  previousTransaction: 'offer-tx',
  owner: { $kind: 'AddressOwner', AddressOwner: owner },
  content: zero,
})
const sdk = {
  game_type_package: game,
  get_owned_kiosks: async (_address: string, pagination?: { cursor?: string }) =>
    pagination?.cursor
      ? { kioskOwnerCaps: [{ isPersonal: true, kioskId: kiosk_id }], hasNextPage: false, nextCursor: null }
      : { kioskOwnerCaps: [], hasNextPage: true, nextCursor: 'second' },
}
const change = (row: ReturnType<typeof object>) => ({
  objectId: row.objectId,
  idOperation: 'Created',
  outputVersion: row.version,
  outputDigest: row.digest,
  outputOwner: row.owner,
})
const receipt = (rows: ReturnType<typeof object>[], events: unknown[] = []) => ({
  $kind: 'Transaction',
  Transaction: {
    digest: 'offer-tx',
    status: { success: true },
    transaction: { sender: agent },
    events,
    effects: { changedObjects: rows.map(change) },
  },
})
const client = (row = object()) => ({
  core: {
    listOwnedObjects: async ({ type: requested }: { type: string }) => ({
      objects: requested === type ? [row] : [],
      hasNextPage: false,
      cursor: null,
    }),
    getTransaction: async () => receipt([row]),
  },
})

test('real captured PurchaseCap fields decode exactly', () => {
  expect(decode_agent_purchase_cap(captured)).toEqual({
    id: cap_id,
    kiosk_id,
    item_id: character_id,
    min_price: '10000000000',
  })
  expect(() => decode_agent_purchase_cap(captured.slice(0, 10))).toThrow()
})
test('incoming return verifies human ownership, agent personal kiosk and zero price across kiosk pages', async () => {
  expect(await read_agent_returns(client() as never, sdk as never, owner, agent)).toEqual([
    {
      purchase_cap: cap_id,
      character_id,
      seller_kiosk: kiosk_id,
      recipient: owner,
      agent_address: agent,
      equipment: [],
    },
  ])
})
test('paid offers and offers from foreign kiosks never become agent returns', async () => {
  expect(
    await read_agent_returns(client({ ...object(), content: captured }) as never, sdk as never, owner, agent)
  ).toEqual([])
  const foreign = { ...sdk, get_owned_kiosks: async () => ({ kioskOwnerCaps: [], hasNextPage: false }) }
  expect(await read_agent_returns(client() as never, foreign as never, owner, agent)).toEqual([])
})
test('substituted owner, type or capability identity fails closed', async () => {
  for (const row of [
    { ...object(), owner: { $kind: 'AddressOwner', AddressOwner: agent } },
    { ...object(), type: '0x2::sui::SUI' },
    { ...object(), objectId: agent },
  ])
    await expect(read_agent_returns(client(row) as never, sdk as never, owner, agent)).rejects.toThrow()
})
test('repeated capability or incomplete pagination rejects the whole snapshot', async () => {
  const duplicate = { core: { listOwnedObjects: async () => ({ objects: [object(), object()], hasNextPage: false }) } }
  await expect(read_agent_returns(duplicate as never, sdk as never, owner, agent)).rejects.toThrow('ownership changed')
  const incomplete = { core: { listOwnedObjects: async () => ({ objects: [], hasNextPage: true, cursor: null }) } }
  await expect(read_agent_returns(incomplete as never, sdk as never, owner, agent)).rejects.toThrow('pagination')
})

// Real mainnet ItemUnequipped, tx EFeRtwp5gEnutcAZmzmySPdLVcXDjY8nTJpkACnam4ht,
// captured 2026-11-05 via https://graphql.mainnet.sui.io/graphql (package pins.package_original).
const event_capture = fromBase64(
  'N/1GK340kl2GRxibVneQhzWqfF26Auj8HQz95aDY9twEdG9vbEgFPVxg9M22isVmK/eFwBW8jsVIgitHh7Au0SnYKrG0'
)
const equipped = decode_return_equipment(event_capture)
test('captured unequip event contains the current character, slot and item association', () => {
  expect(equipped).toEqual({
    character: '0x37fd462b7e34925d8647189b5677908735aa7c5dba02e8fc1d0cfde5a0d8f6dc',
    slot: 'tool',
    item: '0x48053d5c60f4cdb68ac5662bf785c015bc8ec548822b4787b02ed129d82ab1b4',
  })
  expect(() => decode_return_equipment(event_capture.slice(0, 10))).toThrow()
})
const cap_layout = bcs.struct('PurchaseCap', {
  id: bcs.Address,
  kiosk_id: bcs.Address,
  item_id: bcs.Address,
  min_price: bcs.u64(),
})
const gear_fixture = () => {
  const character = {
    ...object(),
    content: cap_layout.serialize({ id: cap_id, kiosk_id, item_id: equipped.character, min_price: 0 }).toBytes(),
  }
  const item_type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${game}::item::Item>`)
  const item = {
    ...object(),
    objectId: agent,
    type: item_type,
    content: cap_layout.serialize({ id: agent, kiosk_id, item_id: equipped.item, min_price: 0 }).toBytes(),
  }
  const event = { eventType: `${game}::equipment::ItemUnequipped`, bcs: event_capture }
  const state = { rows: [character, item], events: [event], result: receipt([character, item], [event]) }
  const rpc = {
    core: {
      listOwnedObjects: async ({ type: requested }: { type: string }) => ({
        objects: state.rows.filter((row) => row.type === requested),
        hasNextPage: false,
      }),
      getTransaction: async () => state.result,
    },
  }
  return { state, rpc, item, event }
}
test('current gear, including changes since delegation, links through the Recall receipt across kiosk pages, survives repeated reads, and excludes unrelated items', async () => {
  const f = gear_fixture()
  const unrelated = {
    ...f.item,
    objectId: game,
    previousTransaction: 'independent-offer',
    content: cap_layout.serialize({ id: game, kiosk_id, item_id: owner, min_price: 0 }).toBytes(),
  }
  f.state.rows.push(unrelated)
  const offers = await read_agent_returns(f.rpc as never, sdk as never, owner, agent)
  expect(offers[0]!.equipment).toEqual([{ slot: 'tool', item_id: equipped.item, purchase_cap: agent }])
  expect(await read_agent_returns(f.rpc as never, sdk as never, owner, agent)).toEqual(offers)
  const independent = await read_agent_item_returns(f.rpc as never, sdk as never, owner, agent)
  expect(independent.map((row) => row.purchase_cap)).toEqual([game])
  await check_agent_return(f.rpc as never, sdk as never, owner, { ...offers[0]!, kind: 'claim' } as never)
  f.state.rows = f.state.rows.filter((row) => row.objectId !== agent)
  await expect(check_agent_return(f.rpc as never, sdk as never, owner, offers[0]!)).rejects.toThrow('missing')
  expect(
    (await read_agent_item_returns(f.rpc as never, sdk as never, owner, agent)).map((row) => row.purchase_cap)
  ).toEqual([game])
})
test('missing, duplicate, foreign-transaction and changed capabilities or untrusted receipts fail closed', async () => {
  const mutations = [
    (f: ReturnType<typeof gear_fixture>) => {
      f.state.rows = [f.state.rows[0]!]
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.state.rows = [...f.state.rows, f.item]
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.item.previousTransaction = 'different'
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.item.version = '8'
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.state.result.Transaction.transaction.sender = owner
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.state.result.Transaction.events = [f.event, f.event]
    },
    (f: ReturnType<typeof gear_fixture>) => {
      f.state.rows[0]!.previousTransaction = ''
    },
  ]
  for (const mutate of mutations) {
    const f = gear_fixture()
    mutate(f)
    await expect(read_agent_returns(f.rpc as never, sdk as never, owner, agent)).rejects.toThrow()
  }
})

test('self-transferred associated gear remains excluded using its immutable character-offer event', async () => {
  const f = gear_fixture()
  const unrelated = {
    ...f.item,
    objectId: game,
    previousTransaction: 'independent-offer',
    content: cap_layout.serialize({ id: game, kiosk_id, item_id: owner, min_price: 0 }).toBytes(),
  }
  f.state.rows.push(unrelated)
  f.item.previousTransaction = 'recipient-self-transfer'
  f.item.version = '8'
  await expect(read_agent_returns(f.rpc as never, sdk as never, owner, agent)).rejects.toThrow()
  expect(
    (await read_agent_item_returns(f.rpc as never, sdk as never, owner, agent)).map((row) => row.purchase_cap)
  ).toEqual([game])
})

test('owner-to-bot offer is a bot-held capability from the owner kiosk, rechecked before claim', async () => {
  const row = { ...object(), owner: { $kind: 'AddressOwner', AddressOwner: agent } }
  const queried: string[] = []
  const source = {
    ...sdk,
    get_owned_kiosks: async (address: string) => {
      expect(address).toBe(owner)
      return { kioskOwnerCaps: [{ isPersonal: true, kioskId: kiosk_id }], hasNextPage: false }
    },
  }
  const chain = {
    core: {
      listOwnedObjects: async ({ owner: recipient, type: requested }: { owner: string; type: string }) => {
        queried.push(recipient)
        return { objects: requested === type ? [row] : [], hasNextPage: false }
      },
      getTransaction: async () => ({
        ...receipt([row]),
        Transaction: { ...receipt([row]).Transaction, transaction: { sender: owner } },
      }),
    },
  }
  const offers = await read_agent_returns(chain as never, source as never, agent, owner)
  expect(offers).toEqual([
    {
      purchase_cap: cap_id,
      character_id,
      seller_kiosk: kiosk_id,
      recipient: agent,
      agent_address: owner,
      equipment: [],
    },
  ])
  expect(queried.every((recipient) => recipient === agent)).toBe(true)
  await check_agent_return(chain as never, source as never, agent, offers[0]!)
  await expect(
    check_agent_return(chain as never, source as never, agent, { ...offers[0]!, seller_kiosk: owner })
  ).rejects.toThrow('ownership changed')
  await expect(read_agent_returns(chain as never, source as never, owner, owner)).rejects.toThrow()
})
