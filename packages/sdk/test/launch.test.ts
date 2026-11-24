// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The currency launch: the atomic launch transaction gives each coin its own weight, locks every
// liquidity token and keeps authority with the treasury; the three receipts project the ids the
// next step needs and refuse a launch whose liquidity is not locked.

import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import { SDK } from '../src/client.ts'
import {
  AFTERMATH_MAINNET,
  LAUNCH_DAO_FEE_BPS,
  LAUNCH_KARES_WEIGHT,
  LAUNCH_POOL_FEE,
  LAUNCH_SUI_WEIGHT,
  LIQUIDITY_LOCK_ADDRESS,
  assert_launch_simulation,
  create_currency_launch_transaction,
  create_currency_publish_transaction,
  create_currency_registration_transaction,
  launch_pool_order,
  project_currency_launch,
  project_currency_publication,
  project_currency_registration,
  registered_currency_id,
  type CurrencyLaunch,
} from '../src/kares_launch.ts'

import { digest, fake_client, id, signer } from './helpers/transport.ts'

const coin_type = `${id(500)}::kares::KARES`
const liquidity_token = `${id(700)}::af_lp::AF_LP`
const treasury = normalizeSuiObjectId(id(9))
const terms: CurrencyLaunch = {
  currency_package: id(500),
  publication: { coin_type, liquidity_token_type: liquidity_token, genesis: id(105), pool_cap: id(104) },
  seed_sui: 1_000_000_000_000n,
  aftermath: AFTERMATH_MAINNET,
  rewards: {
    package: id(100),
    upgrade_cap: id(101),
    setup: id(103),
    economy: { id: id(107), shared_version: '1' },
    currency: { id: id(106), shared_version: '1' },
    coin_type,
    treasury,
    victory_type: `${id(600)}::fight_rewards::BossVictory`,
  },
}
const launch_sdk = () => {
  const sdk = SDK({ client: fake_client(), signer, network: 'testnet', pins: {}, transaction_storage: null })
  for (const object_id of [id(101), id(103), id(104), id(105)])
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
  return sdk
}

test('the launch gives each coin its own weight, locks all liquidity and keeps authority with the treasury', () => {
  const launch = create_currency_launch_transaction(launch_sdk(), terms).getData()
  const calls = launch.commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall] : []))
  expect(calls).toMatchObject([
    { package: id(500), module: 'kares', function: 'split' },
    { package: AFTERMATH_MAINNET.amm, module: 'pool_factory', function: 'create_pool_2_coins_v2' },
    { package: AFTERMATH_MAINNET.dao_fee, module: 'pool', function: 'new' },
    { module: 'transfer', function: 'public_share_object' },
    { package: id(100), module: 'economy', function: 'setup' },
  ])
  const pure = (argument: unknown) => {
    const input = launch.inputs[(argument as { Input: number }).Input]!
    return fromBase64((input as { Pure: { bytes: string } }).Pure.bytes)
  }
  const u64s = (argument: unknown) => bcs.vector(bcs.u64()).parse(pure(argument)).map(BigInt)
  const [split, pool, fee_pool, share] = calls as [
    (typeof calls)[0],
    (typeof calls)[0],
    (typeof calls)[0],
    (typeof calls)[0],
  ]
  // SUI sorts first, so it carries the 20% weight and the seed. A swapped vector would price KARES at 80% SUI.
  expect(pool.typeArguments.map((type) => normalizeStructTag(type))).toEqual(
    [liquidity_token, '0x2::sui::SUI', coin_type].map((type) => normalizeStructTag(type))
  )
  expect(u64s(pool.arguments[3])).toEqual([200_000_000_000_000_000n, 800_000_000_000_000_000n])
  expect(LAUNCH_SUI_WEIGHT + LAUNCH_KARES_WEIGHT).toBe(1_000_000_000_000_000_000n)
  expect(bcs.u64().parse(pure(pool.arguments[4]))).toBe('0')
  expect(u64s(pool.arguments[5])).toEqual([1_000_000_000_000_000n, LAUNCH_POOL_FEE])
  expect([6, 7, 8].flatMap((index) => u64s(pool.arguments[index]))).toEqual([0n, 0n, 0n, 0n, 0n, 0n])
  expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(pool.arguments[11]))).toEqual([9, 9])
  expect(bcs.bool().parse(pure(pool.arguments[12]))).toBe(false)
  // The seed comes from the gas coin; the liquidity share is the first result of the supply split.
  const split_index = launch.commands.findIndex(({ MoveCall }) => MoveCall === split)
  expect(pool.arguments.slice(9, 11)).toMatchObject([
    { $kind: 'NestedResult' },
    { $kind: 'NestedResult', NestedResult: [split_index, 0] },
  ])
  expect(launch.commands[(pool.arguments[9] as { NestedResult: [number, number] }).NestedResult[0]]?.$kind).toBe(
    'SplitCoins'
  )
  expect(bcs.u16().parse(pure(fee_pool.arguments[2]))).toBe(LAUNCH_DAO_FEE_BPS)
  expect(LAUNCH_DAO_FEE_BPS).toBe(200)
  expect(bcs.Address.parse(pure(fee_pool.arguments[3]))).toBe(treasury)
  expect(share.typeArguments).toEqual([`${AFTERMATH_MAINNET.dao_fee_types}::pool::DaoFeePool<${liquidity_token}>`])
  // The reserve share, never a wallet coin, funds the Economy.
  expect(calls[4]!.arguments[4]).toMatchObject({ $kind: 'NestedResult', NestedResult: [split_index, 1] })
  const transfers = launch.commands.flatMap(({ TransferObjects }) => (TransferObjects ? [TransferObjects] : []))
  expect(transfers.map(({ address }) => bcs.Address.parse(pure(address)))).toEqual([LIQUIDITY_LOCK_ADDRESS, treasury])
  expect(LIQUIDITY_LOCK_ADDRESS).toBe(normalizeSuiObjectId('0x0'))
  expect(transfers.map(({ objects }) => objects.length)).toEqual([1, 2])
  expect(transfers[1]!.objects[1]).toMatchObject({ $kind: 'NestedResult', NestedResult: [split_index, 2] })
})

test('a coin type that sorts before SUI swaps every per-coin vector together', () => {
  const early = `${id(0).slice(0, -1)}1::kares::KARES`
  expect([launch_pool_order(coin_type), launch_pool_order(early)]).toEqual([
    ['sui', 'kares'],
    ['kares', 'sui'],
  ])
  const publication = { ...terms.publication, coin_type: early }
  const launch = create_currency_launch_transaction(launch_sdk(), {
    ...terms,
    publication,
    rewards: { ...terms.rewards, coin_type: early },
  }).getData()
  const pool = launch.commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall] : []))[1]!
  const input = launch.inputs[(pool.arguments[3] as { Input: number }).Input] as { Pure: { bytes: string } }
  expect(pool.typeArguments.slice(1).map((type) => normalizeStructTag(type))).toEqual(
    [early, '0x2::sui::SUI'].map((type) => normalizeStructTag(type))
  )
  expect(bcs.vector(bcs.u64()).parse(fromBase64(input.Pure.bytes)).map(BigInt)).toEqual([
    LAUNCH_KARES_WEIGHT,
    LAUNCH_SUI_WEIGHT,
  ])
  expect(pool.arguments[9]).toMatchObject({ $kind: 'NestedResult', NestedResult: [0, 0] })
})

test('the launch refuses an empty seed or a reward setup for another currency', () => {
  const sdk = launch_sdk()
  expect(() => create_currency_launch_transaction(sdk, { ...terms, seed_sui: 0n })).toThrow('positive SUI seed')
  expect(() =>
    create_currency_launch_transaction(sdk, {
      ...terms,
      rewards: { ...terms.rewards, coin_type: `${id(501)}::kares::KARES` },
    })
  ).toThrow('another currency')
})

test('publication makes both packages immutable and registration names the currency', () => {
  const artifact = { package_name: 'aresrpg_currency', modules: ['AA=='], dependencies: [id(1)], digest: [1] } as const
  const publish = create_currency_publish_transaction({ currency: artifact, liquidity_token: artifact }).getData()
  expect(publish.commands.map((command) => command.$kind)).toEqual(['Publish', 'MoveCall', 'Publish', 'MoveCall'])
  expect(publish.commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall.function] : []))).toEqual([
    'make_immutable',
    'make_immutable',
  ])
  const registration = create_currency_registration_transaction({ coin_type, unregistered_currency: id(22) }).getData()
  expect(registration.commands[0]?.MoveCall).toMatchObject({
    module: 'coin_registry',
    function: 'finalize_registration',
    typeArguments: [coin_type],
  })
})

test('launch receipts project the next step and refuse liquidity that is not locked', () => {
  const coin = `${id(20)}::kares::KARES`
  const token = `${id(21)}::af_lp::AF_LP`
  const shared = (object_id: string, version: string) => ({
    objectId: object_id,
    outputOwner: { Shared: { initialSharedVersion: version } },
  })
  const owned = (object_id: string, owner: string) => ({ objectId: object_id, outputOwner: { AddressOwner: owner } })
  // Object types of the mainnet simulation of the publication, 2026-11-24 (simulated, never executed).
  const publication = {
    Transaction: {
      objectTypes: {
        [id(20)]: 'package',
        [id(21)]: 'package',
        [id(22)]: `0x2::coin_registry::Currency<${coin}>`,
        [id(23)]: `${id(20)}::kares::Genesis`,
        [id(24)]: `0x2::coin_registry::MetadataCap<${coin}>`,
        [id(25)]: '0xf948935b111990c2b604900c9b2eeb8f24dcf9868a45d1ea1653a5f282c10e29::pool::CreatePoolCapV2',
        [id(26)]: `0x2::coin::CoinMetadata<${token}>`,
        [id(27)]: `0x2::coin::TreasuryCap<${token}>`,
      },
      effects: { changedObjects: [] },
    },
  }
  expect(project_currency_publication(publication as never)).toEqual({
    coin_type: coin,
    liquidity_token_type: token,
    genesis: id(23),
    metadata_cap: id(24),
    unregistered_currency: id(22),
    pool_cap: id(25),
  })
  expect(() =>
    project_currency_publication({ Transaction: { ...publication.Transaction, objectTypes: {} } } as never)
  ).toThrow('created 0 Genesis')
  // Registration deletes the registry-owned currency and shares a new one: both carry the same type.
  const currency = `0x2::coin_registry::Currency<${coin}>`
  const registered = registered_currency_id(coin)
  const registration = {
    Transaction: {
      objectTypes: { [id(22)]: currency, [registered]: currency },
      effects: { changedObjects: [{ objectId: id(22), outputOwner: null }, shared(registered, '77')] },
    },
  }
  expect(project_currency_registration(registration as never, coin)).toEqual({ id: registered, shared_version: '77' })
  // A shared currency anywhere else is not this coin's registration.
  expect(() =>
    project_currency_registration(
      {
        Transaction: { objectTypes: { [id(28)]: currency }, effects: { changedObjects: [shared(id(28), '77')] } },
      } as never,
      coin
    )
  ).toThrow('derived address')
  expect(() =>
    project_currency_registration(
      { Transaction: { ...registration.Transaction, effects: { changedObjects: [] } } } as never,
      coin
    )
  ).toThrow('exactly one currency')
  // Captured: mainnet Currency 0x01d0718d…78e5 of coin 0x8a24551c…5047::kares::KARES, read 2026-11-24.
  expect(
    registered_currency_id('0x8a24551ca06b0688a1127ad0651a9dc89bce3a1899e492228169f083a84c5047::kares::KARES')
  ).toBe('0x01d0718dca6b53513bae919b59f90be5c56c8688c31c26c424144c13521f78e5')
  const launched = (lock: string, pool = shared(id(30), '90')) => ({
    Transaction: {
      objectTypes: {
        [id(30)]: `${AFTERMATH_MAINNET.dao_fee_types}::pool::DaoFeePool<${token}>`,
        [id(31)]: `${AFTERMATH_MAINNET.dao_fee_types}::pool::OwnerCap<${token}>`,
        [id(32)]: `0x2::coin::Coin<${token}>`,
      },
      effects: { changedObjects: [pool, owned(id(31), id(9)), owned(id(32), lock)] },
    },
  })
  expect(project_currency_launch(launched(LIQUIDITY_LOCK_ADDRESS) as never, AFTERMATH_MAINNET, token)).toEqual({
    market_pool: { id: id(30), shared_version: '90' },
    fee_owner: id(31),
    locked_liquidity_tokens: id(32),
  })
  expect(() => project_currency_launch(launched(id(9)) as never, AFTERMATH_MAINNET, token)).toThrow('not locked')
  expect(() =>
    project_currency_launch(
      launched(LIQUIDITY_LOCK_ADDRESS, owned(id(30), id(9)) as never) as never,
      AFTERMATH_MAINNET,
      token
    )
  ).toThrow('not shared')
})

test('the simulated launch is refused unsigned unless liquidity is locked and only the seed is spent', () => {
  const shared = { objectId: id(30), outputOwner: { Shared: { initialSharedVersion: '90' } } }
  const owned = (object_id: string, owner: string) => ({ objectId: object_id, outputOwner: { AddressOwner: owner } })
  const change = (coin: string, address: string, amount: bigint) => ({
    coinType: coin,
    address,
    amount: String(amount),
  })
  const good = [
    change('0x2::sui::SUI', treasury, -(terms.seed_sui + 40_000_000n)),
    change(coin_type, treasury, 50_000_000_000_000_000n),
    change(liquidity_token, LIQUIDITY_LOCK_ADDRESS, 7_000_000n),
  ]
  const simulation = (changes: readonly unknown[] = good, fee_owner = treasury, lock = LIQUIDITY_LOCK_ADDRESS) =>
    ({
      Transaction: {
        objectTypes: {
          [id(30)]: `${AFTERMATH_MAINNET.dao_fee_types}::pool::DaoFeePool<${liquidity_token}>`,
          [id(31)]: `${AFTERMATH_MAINNET.dao_fee_types}::pool::OwnerCap<${liquidity_token}>`,
          [id(32)]: `0x2::coin::Coin<${liquidity_token}>`,
        },
        effects: { status: { success: true }, changedObjects: [shared, owned(id(31), fee_owner), owned(id(32), lock)] },
        balanceChanges: changes,
      },
    }) as never
  expect(() => assert_launch_simulation(simulation(), terms)).not.toThrow()
  const replaced = (index: number, row: unknown) => good.map((original, at) => (at === index ? row : original))
  const refused: readonly (readonly [unknown, string])[] = [
    [simulation(good, id(8)), 'fee authority'],
    [simulation(good, treasury, treasury), 'not locked'],
    [simulation([]), 'no balance changes'],
    // One token short of the team share, or any KARES at another address.
    [simulation(replaced(1, change(coin_type, treasury, 49_999_999_000_000_000n))), 'leaves KARES outside'],
    [simulation([...good, change(coin_type, id(8), 1n)]), 'leaves KARES outside'],
    [simulation(replaced(2, change(liquidity_token, treasury, 7_000_000n))), 'lock every liquidity token'],
    [simulation([...good, change(liquidity_token, id(8), 1n)]), 'lock every liquidity token'],
    [simulation(good.slice(0, 2)), 'lock every liquidity token'],
    [simulation(replaced(0, change('0x2::sui::SUI', treasury, -(terms.seed_sui - 1n)))), 'other than the seed'],
    [
      simulation(replaced(0, change('0x2::sui::SUI', treasury, -(terms.seed_sui + 1_000_000_001n)))),
      'other than the seed',
    ],
    [simulation([...good, change('0x2::sui::SUI', id(8), 5n)]), 'other than the seed'],
    [{ FailedTransaction: {} }, 'simulation failed'],
    [{ Transaction: { effects: { status: { success: false } } } }, 'simulation failed'],
  ]
  for (const [receipt, reason] of refused)
    expect(() => assert_launch_simulation(receipt as never, terms)).toThrow(reason)
})
