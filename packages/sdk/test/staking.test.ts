// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KARES money rules: accrual follows the Move schedule without compounding, every claim is one bounded
// PTB, community vesting releases linearly, and a reading older than a certified write fails closed.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { SDK, create_cache } from '../src/client.ts'
import { create_kares_transaction, kares_actions } from '../src/kares_actions.ts'
import {
  CLOCK_BCS,
  COMBAT_POT_BCS,
  COMMUNITY_POOL_BCS,
  INITIAL_DURATION_MS,
  INITIAL_REWARDS,
  KARES_CURRENCY_BCS,
  REWARD_DAY_MS,
  REWARD_SCALE,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
  SUPPLEMENTARY_DURATION_MS,
  project_community_claimable,
  project_kares_pool,
  project_kares_position,
  type KaresPoolState,
} from '../src/kares_decode.ts'
import {
  COMMUNITY_VESTING_MS,
  KARES_ALLOCATION,
  KARES_RESERVE_SUPPLY,
  KARES_SUPPLY,
  KARES_UNIT,
} from '../src/kares_economics.ts'
import { create_kares_community_claim_transaction, kares_pins } from '../src/kares_ptb.ts'
import { create_kares_snapshot_reader } from '../src/kares_snapshot.ts'

import { digest, fake_client, id, signer } from './helpers/transport.ts'

// Synthetic transport scenario: decoders are pinned to captured bytes in projection.test.ts.
const kares_test_pins = {
  kares_rewards_package: id(100),
  kares_rewards_package_original: id(100),
  kares_coin_type: `${id(99)}::token::TOKEN`,
  kares_currency: { id: id(101), shared_version: '1' },
  kares_economy: { id: id(102), shared_version: '1' },
  kares_staking_pool: { id: id(103), shared_version: '1' },
  kares_combat_pot: { id: id(109), shared_version: '1' },
  kares_community_pool: { id: id(110), shared_version: '1' },
}
const empty_bucket = { start_ms: 0n, kares: 0n, sui: 0n, released_kares: 0n, released_sui: 0n }
const pool = (overrides: Partial<KaresPoolState> = {}): KaresPoolState => ({
  id: id(103),
  active: true,
  principal: 100n * KARES_UNIT,
  kares_rewards: INITIAL_REWARDS,
  sui_rewards: 0n,
  last_wall_ms: 0n,
  active_ms: 0n,
  initial_released: 0n,
  kares_index: 0n,
  sui_index: 0n,
  kares_remainder: 0n,
  sui_remainder: 0n,
  buckets: Array.from({ length: 31 }, () => ({ ...empty_bucket })),
  ...overrides,
})
const stake = (amount: bigint) => ({
  id: id(201),
  pool: id(103),
  amount,
  kares_index: 0n,
  sui_index: 0n,
  kares_accrued: 0n,
  sui_accrued: 0n,
})

test('every KARES mirror constant equals its Move owner', () => {
  const move = (file: string) => readFileSync(new URL(`../../rewards/sources/${file}.move`, import.meta.url), 'utf8')
  const amounts = move('amounts')
  const allocations = {
    staking_tokens: 'rewards',
    combat_tokens: 'combat',
    community_tokens: 'community',
  } as const
  for (const [name, allocation] of Object.entries(allocations)) {
    const units = new RegExp(`fun ${name}\\(\\): u64 \\{ ([\\d_]+) \\* UNIT`).exec(amounts)![1]!
    expect(BigInt(units.replaceAll('_', '')) * KARES_UNIT).toBe(KARES_ALLOCATION[allocation])
  }
  // The currency package issues the supply and owns its three-way split.
  const currency = readFileSync(new URL('../../currency/sources/kares.move', import.meta.url), 'utf8')
  const share = (name: string) =>
    BigInt(new RegExp(`const ${name}: u64 = ([\\d_]+) \\* UNIT;`).exec(currency)![1]!.replaceAll('_', '')) * KARES_UNIT
  expect([share('LIQUIDITY_TOKENS'), share('RESERVE_TOKENS'), share('TEAM_TOKENS')]).toEqual([
    KARES_ALLOCATION.liquidity,
    KARES_RESERVE_SUPPLY,
    KARES_ALLOCATION.team,
  ])
  expect([KARES_SUPPLY, Object.values(KARES_ALLOCATION).reduce((sum, value) => sum + value, 0n)]).toEqual([
    1_000_000_000n * KARES_UNIT,
    KARES_SUPPLY,
  ])
  expect(amounts).toContain('1_825 * 86_400_000')
  const staking = move('staking')
  const constants = {
    DAY_MS: REWARD_DAY_MS,
    SCALE: REWARD_SCALE,
    MONTH_MS: SUPPLEMENTARY_DURATION_MS,
    INITIAL_DURATION_MS,
  }
  for (const [name, value] of Object.entries(constants)) {
    const match = new RegExp(`const\\s+${name}:\\s*u\\d+\\s*=\\s*([\\d_]+)(\\s*\\*\\s*DAY_MS)?;`).exec(staking)!
    expect(BigInt(match[1]!.replaceAll('_', '')) * (match[2] ? REWARD_DAY_MS : 1n)).toBe(value)
  }
})

test('accrual pauses while empty, stops at five years, keeps donation deadlines and never back-pays', () => {
  const idle = project_kares_pool(pool({ principal: 0n }), 100n * REWARD_DAY_MS)
  expect([idle.active_ms, idle.initial_remaining, idle.kares_index]).toEqual([0n, INITIAL_REWARDS, 0n])
  expect(project_kares_pool(pool({ last_wall_ms: 100n * REWARD_DAY_MS }), 101n * REWARD_DAY_MS).active_ms).toBe(
    REWARD_DAY_MS
  )
  const five_years = project_kares_pool(pool(), 1_825n * REWARD_DAY_MS)
  expect(project_kares_position(five_years, stake(25n * KARES_UNIT))).toEqual({
    pending_kares: 50_000_000n * KARES_UNIT,
    pending_sui: 0n,
  })
  expect(five_years.initial_remaining).toBe(0n)
  expect(project_kares_pool(pool(), 9_000n * REWARD_DAY_MS).kares_index).toBe(five_years.kares_index)
  const donations = pool({
    buckets: [
      { ...empty_bucket, start_ms: REWARD_DAY_MS, sui: 300n * KARES_UNIT },
      { ...empty_bucket, start_ms: 11n * REWARD_DAY_MS, sui: 600n * KARES_UNIT },
    ],
  })
  const earned = (days: bigint) =>
    project_kares_position(project_kares_pool(donations, days * REWARD_DAY_MS), stake(100n * KARES_UNIT)).pending_sui
  expect([1n, 11n, 31n, 41n, 100n].map(earned)).toEqual(
    [0n, 100n, 700n, 900n, 900n].map((amount) => amount * KARES_UNIT)
  )
  const indexes = { kares_index: 7n * REWARD_SCALE, sui_index: 2n * REWARD_SCALE }
  expect(project_kares_position(indexes, { ...stake(10n), ...indexes })).toEqual({ pending_kares: 0n, pending_sui: 0n })
  expect(project_kares_position(indexes, { ...stake(0n), ...indexes, kares_accrued: 3n * REWARD_SCALE + 1n })).toEqual({
    pending_kares: 3n,
    pending_sui: 0n,
  })
  expect(() => project_kares_position(indexes, { ...stake(10n), kares_index: 8n * REWARD_SCALE })).toThrow(
    'older than the position'
  )
  expect(() => project_kares_pool(pool({ last_wall_ms: 1n }), 0n)).toThrow('older than the pool')
})

test('community vesting releases linearly to its canonical treasury and malformed reserves fail closed', () => {
  const total = KARES_ALLOCATION.community
  const reserve = (remaining = total) => ({ started_ms: 100n, remaining })
  expect(COMMUNITY_VESTING_MS).toBe(1_825n * 86_400_000n)
  expect(
    [0n, COMMUNITY_VESTING_MS / 5n, COMMUNITY_VESTING_MS * 2n].map((elapsed) =>
      project_community_claimable(reserve(), 100n + elapsed)
    )
  ).toEqual([0n, total / 5n, total])
  const remaining = [1n, 2n, 3n].reduce(
    (left, elapsed) => left - project_community_claimable(reserve(left), 100n + elapsed),
    total
  )
  expect(total - remaining).toBe((total * 3n) / COMMUNITY_VESTING_MS)
  expect(project_community_claimable(reserve(remaining), 100n + COMMUNITY_VESTING_MS)).toBe(remaining)
  expect(() => project_community_claimable(reserve(total + 1n), 100n)).toThrow('malformed')
  expect(() => project_community_claimable(reserve(), 99n)).toThrow('older than funding')
  expect(() => project_community_claimable(reserve(total - 1n), 100n)).toThrow('older than the community claim')
  const claim = create_kares_community_claim_transaction(kares_pins(kares_test_pins), id(200)).getData()
  expect(claim.commands[0]?.MoveCall).toMatchObject({ package: id(100), module: 'community', function: 'claim' })
  expect(claim.inputs[0]?.Object?.SharedObject?.objectId).toBe(id(110))
  expect(claim.commands[1]?.TransferObjects?.objects).toEqual([{ $kind: 'NestedResult', NestedResult: [0, 0] }])
})

const owner = signer.toSuiAddress()
const shared_object = (object_id: string, type: string, content: Uint8Array, json: Record<string, unknown> = {}) => ({
  objectId: object_id,
  version: '2',
  digest,
  type,
  content,
  json,
  owner: { $kind: 'Shared' as const, Shared: { initialSharedVersion: '1' } },
})
const position_object = (object_id = id(201), amount = 10n) => ({
  objectId: object_id,
  version: '2',
  digest,
  type: `${id(100)}::staking::StakePosition<${kares_test_pins.kares_coin_type}>`,
  owner: { $kind: 'AddressOwner' as const, AddressOwner: owner },
  content: STAKE_POSITION_BCS.serialize({ ...stake(amount), id: object_id }).toBytes(),
})
const finance_chain = () => {
  const coin = kares_test_pins.kares_coin_type
  const state = {
    balance_reads: 0,
    positions: [position_object()],
    objects: [
      shared_object(id(102), `${id(100)}::economy::Economy`, new Uint8Array(), {
        id: id(102),
        token: coin.slice(2),
        currency: id(101),
        staking_pool: id(103),
        combat_pot: id(109),
        community_pool: id(110),
        started_ms: '0',
      }),
      shared_object(
        id(103),
        `${id(100)}::staking::StakingPool<${coin}>`,
        STAKING_POOL_BCS.serialize({ ...pool({ principal: 10n, kares_rewards: KARES_ALLOCATION.rewards }) }).toBytes()
      ),
      shared_object(
        id(101),
        `0x2::coin_registry::Currency<${coin}>`,
        KARES_CURRENCY_BCS.serialize({
          id: id(101),
          decimals: 9,
          name: 'KARES',
          symbol: 'KARES',
          description: '',
          icon_url: '',
          supply: { BurnOnly: KARES_SUPPLY },
          regulated: { Unregulated: true },
          treasury_cap_id: null,
          metadata_cap_id: { Deleted: true },
          extra_fields: [],
        }).toBytes()
      ),
      shared_object(
        id(109),
        `${id(100)}::combat_rewards::CombatPot<${coin}>`,
        COMBAT_POT_BCS.serialize({
          id: id(109),
          balance: KARES_ALLOCATION.combat,
          authorized: { name: `${id(50)}::fight_rewards::BossVictory` },
          started_ms: 0n,
          epoch: 1n,
          epoch_started_ms: 0n,
          work: 0n,
          quota: 20_000n,
          day: 0n,
          spent: 0n,
        }).toBytes()
      ),
      shared_object(
        id(110),
        `${id(100)}::community::CommunityPool<${coin}>`,
        COMMUNITY_POOL_BCS.serialize({
          id: id(110),
          treasury: owner,
          started_ms: 0n,
          remaining: KARES_ALLOCATION.community,
        }).toBytes()
      ),
      shared_object(id(6), '0x2::clock::Clock', CLOCK_BCS.serialize({ id: id(6), timestamp_ms: 10n }).toBytes()),
    ],
  }
  const client = {
    network: 'testnet',
    core: {
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map(
          (object_id) => state.objects.find(({ objectId }) => objectId === object_id) ?? new Error('not found')
        ),
      }),
      listOwnedObjects: async () => ({ objects: state.positions, hasNextPage: false, cursor: null }),
      getBalance: async () => {
        state.balance_reads += 1
        return { balance: { balance: '12345678901' } }
      },
    },
  }
  return { state, client }
}

test('a snapshot verifies every linked reserve and fails closed behind any certified write', async () => {
  const { state, client } = finance_chain()
  const reader = create_kares_snapshot_reader(client as never, kares_test_pins, 'testnet')
  const snapshot = await reader.snapshot(owner)
  expect([
    snapshot.total_supply,
    snapshot.pool.kares_rewards,
    snapshot.combat_pot.balance,
    snapshot.community.remaining,
  ]).toEqual([KARES_SUPPLY, KARES_ALLOCATION.rewards, KARES_ALLOCATION.combat, KARES_ALLOCATION.community])
  expect([snapshot.positions[0]?.amount, snapshot.kares_balance]).toEqual([10n, 12_345_678_901n])
  expect('kares_balance' in (await reader.staking_snapshot(owner))).toBe(false)
  expect((await reader.public_snapshot())?.coin_type).toBe(kares_test_pins.kares_coin_type)
  const [position] = state.positions
  state.positions = []
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
  state.positions = [position!]
  reader.observe_receipt({
    Transaction: {
      digest: 'certified',
      effects: {
        status: { success: true },
        changedObjects: [{ objectId: id(103), outputState: 'ObjectWrite', outputVersion: '3' }],
      },
    },
  })
  await expect(reader.snapshot()).rejects.toThrow('behind a certified transaction')
  state.objects.find(({ objectId }) => objectId === id(103))!.version = '3'
  expect((await reader.snapshot()).pool.version).toBe('3')
  const cache = create_cache()
  cache.shared.set(id(103), { initialSharedVersion: '1', version: '4' })
  await expect(
    create_kares_snapshot_reader(client as never, kares_test_pins, 'testnet', cache).snapshot()
  ).rejects.toThrow('behind a certified transaction')

  const economy = state.objects[0]!
  economy.json.currency = id(999)
  await expect(reader.snapshot()).rejects.toThrow('not linked')
  economy.json.currency = id(101)
  economy.owner.Shared.initialSharedVersion = '9'
  await expect(reader.snapshot()).rejects.toThrow('shared-object version')
  economy.owner.Shared.initialSharedVersion = '1'
  state.positions[0] = { ...position!, owner: { $kind: 'AddressOwner', AddressOwner: id(999) } }
  await expect(reader.snapshot(owner)).rejects.toThrow('another wallet')
  state.positions = [position!, position!]
  await expect(reader.snapshot(owner)).rejects.toThrow('ownership changed')
  client.network = 'mainnet'
  await expect(reader.snapshot()).rejects.toThrow('different network')
  economy.json.token = ''
  economy.version = '1'
  client.network = 'testnet'
  await expect(reader.public_snapshot()).rejects.toThrow('behind the previous reading')
})

test('stake reuses a position, claims and withdrawals are one bounded PTB, payouts transfer together', async () => {
  const { state, client: finance } = finance_chain()
  const chain = fake_client()
  const sdk = SDK({ client: chain, signer, network: 'testnet', pins: kares_test_pins, transaction_storage: null })
  for (const object_id of [id(201), id(202)])
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
  const context = { sdk, address: owner }
  const claim = (await create_kares_transaction(context, { kind: 'claim', ids: [id(201), id(202), id(201)] })).getData()
  expect(claim.commands.map(({ $kind }) => $kind)).toEqual([
    'MoveCall',
    'MoveCall',
    'MergeCoins',
    'MergeCoins',
    'TransferObjects',
  ])
  expect(claim.commands.at(-1)?.TransferObjects?.objects).toHaveLength(2)
  expect(claim.commands[0]?.MoveCall?.typeArguments).toEqual([kares_test_pins.kares_coin_type])
  const withdraw = await create_kares_transaction(context, {
    kind: 'withdraw',
    withdrawals: [
      { id: id(201), amount: 20n },
      { id: id(202), amount: 5n },
    ],
  })
  expect(withdraw.getData().commands.map(({ $kind }) => $kind)).toEqual([
    'MoveCall',
    'MoveCall',
    'MergeCoins',
    'TransferObjects',
  ])
  const many = Array.from({ length: 51 }, (_, index) => id(1_000 + index))
  await expect(create_kares_transaction(context, { kind: 'claim', ids: [] })).rejects.toThrow('1..50')
  await expect(create_kares_transaction(context, { kind: 'claim', ids: many })).rejects.toThrow('50')
  await expect(
    create_kares_transaction(context, {
      kind: 'withdraw',
      withdrawals: many.map((object_id) => ({ id: object_id, amount: 1n })),
    })
  ).rejects.toThrow('50')
  const fund = (
    await create_kares_transaction(context, { kind: 'fund', asset: 'sui', amount: 5n * KARES_UNIT })
  ).getData()
  expect(fund.commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall] : []))).toMatchObject([
    { package: id(100), module: 'staking', function: 'fund_sui' },
  ])
  await expect(create_kares_transaction(context, { kind: 'fund', asset: 'sui', amount: 0n })).rejects.toThrow(
    'positive u64'
  )
  expect(() => kares_pins({})).toThrow('not configured')
  expect(chain.calls.executions).toBe(0)

  const actions = kares_actions({ sdk, client: finance as never, address: owner })
  state.positions = []
  await actions.stake(1n)
  state.positions = [position_object()]
  await actions.stake(2n)
  const opened = chain.calls.submitted.map(
    (bytes) =>
      Transaction.from(bytes)
        .getData()
        .commands.find(({ MoveCall }) => MoveCall?.module === 'staking')?.MoveCall?.function
  )
  expect(opened).toEqual(['open_position', 'add_stake'])
  const refused = fake_client({ simulate_ok: false })
  const blocked = kares_actions({
    sdk: SDK({ client: refused, signer, network: 'testnet', pins: kares_test_pins, transaction_storage: null }),
    client: finance as never,
    address: owner,
  })
  await expect(blocked.fund_sui(KARES_UNIT)).rejects.toThrow('NOT submitted')
  expect(refused.calls.executions).toBe(0)
})
