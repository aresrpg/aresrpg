// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { claim_marketplace_royalties, read_marketplace_royalties } from '../src/marketplace_admin.ts'

import captured_policies from './fixtures/marketplace_policies.mainnet.json'

const package_id = `0x${'11'.repeat(32)}`
// the upgraded package object — types never live here, only move-call targets do
const latest_package_id = `0x${'77'.repeat(32)}`
const address = `0x${'22'.repeat(32)}`
const item_policy = `0x${'33'.repeat(32)}`
const character_policy = `0x${'44'.repeat(32)}`
const item_type = `${package_id}::item::Item`
const character_type = `${package_id}::character::Character`
const kares_package = `0x${'88'.repeat(32)}`
const caps = [
  { type: item_type, policyId: item_policy, policyCapId: `0x${'55'.repeat(32)}` },
  { type: character_type, policyId: character_policy, policyCapId: `0x${'66'.repeat(32)}` },
]

const sdk = (withdrawals: string[] = [], owned_caps = caps) => ({
  game_type_package: package_id,
  pins: {
    // pins.package follows the latest upgrade; royalty reads must not use it for types
    package: latest_package_id,
    item_policy: { id: item_policy, shared_version: '1' },
    character_policy: { id: character_policy, shared_version: '1' },
    kares_rewards_package: kares_package,
    kares_rewards_package_original: kares_package,
    kares_coin_type: `${kares_package}::kares::KARES`,
    kares_currency: { id: `0x${'90'.repeat(32)}`, shared_version: '1' },
    kares_economy: { id: `0x${'91'.repeat(32)}`, shared_version: '1' },
    kares_staking_pool: { id: `0x${'92'.repeat(32)}`, shared_version: '1' },
    kares_combat_pot: { id: `0x${'93'.repeat(32)}`, shared_version: '1' },
    kares_community_pool: { id: `0x${'94'.repeat(32)}`, shared_version: '1' },
  },
  get_owned_transfer_policies: async () => owned_caps,
  sui_client: {
    core: {
      getObjects: async () => ({
        objects: [
          {
            objectId: item_policy,
            type: `0x2::transfer_policy::TransferPolicy<${item_type}>`,
            json: { balance: '2500000000' },
          },
          {
            objectId: character_policy,
            type: `0x2::transfer_policy::TransferPolicy<${character_type}>`,
            json: { balance: '500000000' },
          },
        ],
      }),
    },
  },
  tx: () => new Transaction(),
  hydrate_unknown: async () => undefined,
  door_context: {
    obj: (transaction: Transaction, id: string) => transaction.object(id),
  },
  execute: async (transaction: Transaction) => {
    const { commands } = transaction.getData()
    const calls = commands.flatMap((command) => (command.$kind === 'MoveCall' ? [command.MoveCall] : []))
    withdrawals.push(
      ...calls
        .filter(({ module }) => module === 'transfer_policy')
        .map(({ typeArguments }) => (typeArguments[0] === item_type ? item_policy : character_policy))
    )
    expect(calls.map(({ function: name }) => name)).toEqual(['withdraw', 'withdraw', 'fund_royalties'])
    expect(commands.filter(({ $kind }) => $kind === 'MergeCoins')).toHaveLength(1)
    return {
      digest: 'royalty-digest',
      Transaction: {
        events: [
          {
            type: `${kares_package}::staking::RoyaltyFunded`,
            json: { amount: '5000000000', staking: '1000000000' },
          },
        ],
      },
    }
  },
})

describe('marketplace admin', () => {
  test('reads live pinned policies even when historical creation-event discovery is empty', async () => {
    const fixture = sdk()
    const reads: string[][] = []
    const rows = await read_marketplace_royalties(
      {
        ...fixture,
        get_transfer_policies: async () => [],
        sui_client: {
          core: {
            getObjects: async (input: { objectIds: string[]; include: { json: boolean } }) => {
              expect(input.include).toEqual({ json: true })
              reads.push(input.objectIds)
              return fixture.sui_client.core.getObjects()
            },
          },
        },
      } as never,
      address
    )
    expect(reads).toEqual([[item_policy, character_policy]])
    expect(rows.map(({ balance_mist }) => balance_mist)).toEqual([2500000000n, 500000000n])
  })

  test('decodes captured mainnet policy objects, including the zero-balance character policy', async () => {
    // Public gRPC capture: object IDs, versions and capture date are retained in the fixture.
    const [item, character] = captured_policies.objects
    const rows = await read_marketplace_royalties(
      {
        ...sdk([], []),
        game_type_package: '0x427af9b0d1cc5145a5112bd5b473dd615d48b5389de296eb7c512afdec160e1d',
        pins: { item_policy: { id: item!.objectId }, character_policy: { id: character!.objectId } },
        get_transfer_policies: async () => [],
        sui_client: { core: { getObjects: async () => ({ objects: [...captured_policies.objects].reverse() }) } },
      } as never,
      address
    )
    expect(rows.map(({ balance_mist }) => balance_mist)).toEqual([3600000000n, 0n])
    expect(rows.every(({ cap }) => cap === null)).toBe(true)
  })
  test('reads only the two pinned game policies and their owned caps', async () => {
    const rows = await read_marketplace_royalties(sdk() as never, address)
    expect(rows.map(({ kind, balance_mist }) => [kind, balance_mist])).toEqual([
      ['item', 2_500_000_000n],
      ['character', 500_000_000n],
    ])
    expect(rows.every(({ cap }) => cap !== null)).toBe(true)
  })

  test('missing policies and object read failures cannot become zero royalties', async () => {
    const fixture = sdk()
    const { objects } = await fixture.sui_client.core.getObjects()
    for (const result of [[objects[0]], [objects[0], new Error('Policy RPC unavailable')]]) {
      const reader = { ...fixture, sui_client: { core: { getObjects: async () => ({ objects: result }) } } }
      await expect(read_marketplace_royalties(reader as never, address)).rejects.toThrow(/unavailable/)
    }
  })

  test('rejects mismatched policy types and unreadable balances', async () => {
    const fixture = sdk()
    const { objects } = await fixture.sui_client.core.getObjects()
    for (const invalid of [
      { ...objects[1], type: objects[0]!.type },
      { ...objects[1], json: null },
      { ...objects[1], json: { balance: '-1' } },
      { ...objects[1], json: { balance: 0 } },
    ]) {
      const reader = {
        ...fixture,
        sui_client: { core: { getObjects: async () => ({ objects: [objects[0], invalid] }) } },
      }
      await expect(read_marketplace_royalties(reader as never, address)).rejects.toThrow(
        /unexpected type|invalid balance/
      )
    }
  })

  test('splits the combined live claim and reports certified amounts rather than stale pre-reads', async () => {
    const withdrawals: string[] = []
    const result = await claim_marketplace_royalties(sdk(withdrawals) as never, address)
    expect(withdrawals).toEqual([item_policy, character_policy])
    expect(result).toEqual({
      digest: 'royalty-digest',
      amount_mist: 5_000_000_000n,
      staking_mist: 1_000_000_000n,
      treasury_mist: 4_000_000_000n,
      policies: ['item', 'character'],
    })
  })

  test('refuses a partial claim when the connected wallet lacks either policy cap', async () => {
    const withdrawals: string[] = []
    await expect(claim_marketplace_royalties(sdk(withdrawals, caps.slice(0, 1)) as never, address)).rejects.toThrow(
      'character TransferPolicyCap'
    )
    expect(withdrawals).toEqual([])
  })
})
