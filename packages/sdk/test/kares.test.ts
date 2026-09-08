// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { SDK } from '../src/client.ts'
import { create_kares_transaction, kares_actions } from '../src/kares_actions.ts'
import { KARES_ALLOCATION, KARES_SUPPLY, KARES_UNIT, kares_pins, kares_payment } from '../src/kares_ptb.ts'
import {
  INITIAL_REWARDS,
  INITIAL_DURATION_MS,
  SUPPLEMENTARY_DURATION_MS,
  REWARD_DAY_MS,
  REWARD_SCALE,
  project_kares_pool,
  project_kares_position,
  type KaresPoolState,
} from '../src/kares_decode.ts'

import { digest, fake_client, id, signer } from './helpers/transport.ts'

const pins = {
  kares_package: id(101),
  kares_package_original: id(100),
  kares_currency: { id: id(102), shared_version: '2' },
  kares_offering: { id: id(103), shared_version: '3' },
  kares_staking_pool: { id: id(104), shared_version: '3' },
  kares_combat_pot: { id: id(105), shared_version: '3' },
}
const empty_bucket = { start_ms: 0n, kares: 0n, sui: 0n, released_kares: 0n, released_sui: 0n }
const pool = (overrides: Partial<KaresPoolState> = {}): KaresPoolState => ({
  id: id(104),
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
const position = (amount: bigint) => ({
  id: id(105),
  pool: id(104),
  amount,
  kares_index: 0n,
  sui_index: 0n,
  kares_accrued: 0n,
  sui_accrued: 0n,
})

test('display allocation conserves fixed issuance and matches Move custody constants', () => {
  expect(Object.values(KARES_ALLOCATION).reduce((sum, value) => sum + value, 0n)).toBe(KARES_SUPPLY)
  const offering = readFileSync(new URL('../../kares/sources/offering.move', import.meta.url), 'utf8')
  const constants = {
    SALE_TOKENS: 'offering',
    LIQUIDITY_TOKENS: 'liquidity',
    STAKING_TOKENS: 'rewards',
    TEAM_TOKENS: 'team',
    COMMUNITY_TOKENS: 'community',
  } as const
  for (const [constant, allocation] of Object.entries(constants)) {
    const match = offering.match(new RegExp(`const ${constant}: u64 = ([\\d_]+) \\* UNIT;`))
    expect(match).not.toBeNull()
    expect(BigInt(match![1].replaceAll('_', '')) * KARES_UNIT).toBe(KARES_ALLOCATION[allocation])
  }
  const combat = readFileSync(new URL('../../kares/sources/combat_rewards.move', import.meta.url), 'utf8')
  const initial = combat.match(/const INITIAL_TOKENS: u64 = ([\d_]+) \* UNIT;/)!
  expect(BigInt(initial[1].replaceAll('_', '')) * KARES_UNIT).toBe(KARES_ALLOCATION.combat)
})

test('the reward projection pins its precision and durations to the Move owner', () => {
  const source = readFileSync(new URL('../../kares/sources/staking.move', import.meta.url), 'utf8')
  const expected = {
    DAY_MS: REWARD_DAY_MS,
    INITIAL_REWARDS,
    SCALE: REWARD_SCALE,
    MONTH_MS: SUPPLEMENTARY_DURATION_MS,
    INITIAL_DURATION_MS,
  }
  for (const [name, value] of Object.entries(expected)) {
    const match = source.match(new RegExp(`const\\s+${name}:\\s*u\\d+\\s*=\\s*([\\d_]+)(\\s*\\*\\s*DAY_MS)?;`))
    expect(match).not.toBeNull()
    const multiplier = match![2] ? REWARD_DAY_MS : 1n
    expect(BigInt(match![1].replaceAll('_', '')) * multiplier).toBe(value)
  }
})

test('empty staking pauses all releases and does not give the next entrant a backlog', () => {
  const empty = pool({ principal: 0n })
  const projected = project_kares_pool(empty, 100n * REWARD_DAY_MS)
  expect(projected.active_ms).toBe(0n)
  expect(projected.initial_remaining).toBe(INITIAL_REWARDS)
  expect(projected.kares_index).toBe(0n)
  const resumed = pool({ last_wall_ms: 100n * REWARD_DAY_MS })
  expect(project_kares_pool(resumed, 101n * REWARD_DAY_MS).active_ms).toBe(REWARD_DAY_MS)
})

test('five-year rewards stop exactly and accrue proportionally without compounding', () => {
  const projected = project_kares_pool(pool(), 1_825n * REWARD_DAY_MS)
  const rewards = project_kares_position(projected, position(25n * KARES_UNIT))
  expect(rewards.pending_kares).toBe(50_000n * KARES_UNIT)
  expect(rewards.pending_sui).toBe(0n)
  expect(projected.initial_remaining).toBe(0n)
  expect(project_kares_pool(pool(), 9_000n * REWARD_DAY_MS)).toMatchObject({ kares_index: projected.kares_index })
})

test('overlapping donations retain independent month deadlines after their daily start', () => {
  const state = pool({
    buckets: [
      { ...empty_bucket, start_ms: REWARD_DAY_MS, sui: 300n * KARES_UNIT },
      { ...empty_bucket, start_ms: 11n * REWARD_DAY_MS, sui: 600n * KARES_UNIT },
    ],
  })
  const earned = (days: bigint) =>
    project_kares_position(project_kares_pool(state, days * REWARD_DAY_MS), position(100n * KARES_UNIT)).pending_sui
  expect(earned(1n)).toBe(0n)
  expect(earned(11n)).toBe(100n * KARES_UNIT)
  expect(earned(31n)).toBe(700n * KARES_UNIT)
  expect(earned(41n)).toBe(900n * KARES_UNIT)
  expect(earned(100n)).toBe(900n * KARES_UNIT)
})

test('late entrants cannot receive historical rewards and withdrawn principal retains fractional accrual', () => {
  const projected = { kares_index: 7n * REWARD_SCALE, sui_index: 2n * REWARD_SCALE }
  expect(project_kares_position(projected, { ...position(10n), ...projected })).toEqual({
    pending_kares: 0n,
    pending_sui: 0n,
  })
  expect(
    project_kares_position(projected, { ...position(0n), ...projected, kares_accrued: 3n * REWARD_SCALE + 1n })
  ).toEqual({ pending_kares: 3n, pending_sui: 0n })
  expect(() => project_kares_position(projected, { ...position(10n), kares_index: 8n * REWARD_SCALE })).toThrow(
    'older than the position'
  )
  expect(() => project_kares_pool(pool({ last_wall_ms: 1n }), 0n)).toThrow('older than the pool')
})

test('standalone offering PTBs have no game markers, use latest targets and canonical shared pins', async () => {
  const client = fake_client({ simulate_ok: true })
  const sdk = SDK({ client, pins, signer, transaction_storage: null })
  const tx = await create_kares_transaction(
    { sdk, address: signer.toSuiAddress() },
    { kind: 'contribute', amount: 5n * KARES_UNIT }
  )
  const calls = tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ package: id(101), module: 'offering', function: 'contribute' })
  expect(tx.getData().inputs.some((input) => input.Object?.SharedObject?.objectId === id(103))).toBe(true)
  expect(client.calls.executions).toBe(0)
  expect(() => kares_pins({})).toThrow('not configured')
  await expect(
    create_kares_transaction({ sdk, address: signer.toSuiAddress() }, { kind: 'contribute', amount: 0n })
  ).rejects.toThrow('positive u64')
})

test('official KARES resolver covers fragmented, paginated, address-only and mixed balances', async () => {
  for (const { address_balance, coins } of [
    { address_balance: 10n, coins: [] },
    { address_balance: 0n, coins: [10n] },
    { address_balance: 0n, coins: [3n, 7n] },
    { address_balance: 4n, coins: [6n] },
  ]) {
    const pages: (string | null)[] = []
    const base = fake_client({ simulate_ok: true })
    const client = {
      ...base,
      core: {
        ...base.core,
        getBalance: async () => ({
          balance: {
            balance: '10000000000',
            coinBalance: String((10n - address_balance) * KARES_UNIT),
            addressBalance: String(address_balance * KARES_UNIT),
          },
        }),
        listCoins: async ({ cursor = null }: { cursor?: string | null }) => {
          pages.push(cursor)
          const page = Number(cursor ?? 0)
          const amount = coins[page]
          return {
            objects:
              amount === undefined
                ? []
                : [
                    {
                      objectId: id(51 + page),
                      version: '3',
                      digest,
                      balance: String(amount * KARES_UNIT),
                      owner: { $kind: 'AddressOwner', AddressOwner: signer.toSuiAddress() },
                    },
                  ],
            hasNextPage: page + 1 < coins.length,
            cursor: String(page + 1),
          }
        },
      },
    }
    const sdk = SDK({ client, pins, signer, transaction_storage: null })
    const tx = new Transaction()
    tx.transferObjects([kares_payment(sdk, tx, 8n * KARES_UNIT)], signer.toSuiAddress())
    await sdk.simulate(tx)
    expect(base.calls.executions).toBe(0)
    expect(tx.getData().commands.some((command) => command.MoveCall?.function === 'redeem_funds')).toBe(
      address_balance > 0n
    )
    expect(pages).toEqual(coins.length > 1 ? [null, '1'] : [null])
    expect(tx.getData().commands.some((command) => command.$kind === 'MergeCoins')).toBe(
      coins.length > 1 || (address_balance > 0n && coins.length > 0)
    )
    if (coins.length > 1) {
      const { commands } = tx.getData()
      const merge = commands.findIndex((command) => command.$kind === 'MergeCoins')
      expect(merge).toBeGreaterThanOrEqual(0)
      expect(commands.findIndex((command) => command.$kind === 'SplitCoins')).toBeGreaterThan(merge)
      expect(tx.getData().inputs.some((input) => input.Object?.ImmOrOwnedObject?.objectId === id(52))).toBe(true)
    }
    expect(tx.getData().inputs.some((input) => input.Object?.ImmOrOwnedObject?.objectId === id(51))).toBe(
      coins.length > 0
    )
    // A prepared kiosk payment may be reused for a fresh unsigned rebuild, never an old PTB result reference.
    const rebuilt = new Transaction()
    rebuilt.transferObjects([kares_payment(sdk, rebuilt, 8n * KARES_UNIT)], signer.toSuiAddress())
    await sdk.simulate(rebuilt)
    expect(rebuilt.getData().commands).toEqual(tx.getData().commands)
    const insufficient = new Transaction()
    insufficient.transferObjects([kares_payment(sdk, insufficient, 11n * KARES_UNIT)], signer.toSuiAddress())
    await expect(sdk.simulate(insufficient)).rejects.toThrow('Insufficient balance')
    expect(base.calls.executions).toBe(0)
  }
})

test('offering actions use the existing executor and a failed simulation never submits', async () => {
  const client = fake_client({ simulate_ok: false })
  const sdk = SDK({ client, pins, signer, transaction_storage: null })
  const actions = kares_actions({ sdk, client: client as never, address: signer.toSuiAddress() })
  await expect(actions.contribute(KARES_UNIT)).rejects.toThrow('NOT submitted')
  expect(client.calls.executions).toBe(0)
})

test('the game wallet reads native KARES balances without offering or staking configuration', async () => {
  const base = fake_client({ simulate_ok: true })
  const requests: Readonly<{ owner: string; coinType?: string }>[] = []
  const client = {
    ...base,
    core: {
      ...base.core,
      getBalance: async (input: Readonly<{ owner: string; coinType?: string }>) => {
        requests.push(input)
        return { balance: { balance: '12345678901', addressBalance: '12345678901', coinBalance: '0' } }
      },
    },
  }
  const sdk = SDK({ client, signer, pins: { kares_package_original: id(100), kares_package: id(101) } })
  expect(await sdk.read_kares_balance()).toBe(12_345_678_901n)
  expect(requests).toEqual([{ owner: signer.toSuiAddress(), coinType: `${id(100)}::kares::KARES` }])
  const unpublished = SDK({ client, signer, pins: {} })
  expect(await unpublished.read_kares_balance()).toBeNull()
  expect(requests).toHaveLength(1)
})

test('sale claims carry their canonical staking pool for atomic finalization; staking claims keep their own shape', async () => {
  const client = fake_client({ simulate_ok: true })
  const sdk = SDK({ client, pins, signer, transaction_storage: null })
  sdk.cache.owned.set(id(201), { objectId: id(201), version: '1', digest })
  for (const source of ['offering', 'staking'] as const) {
    const tx = await create_kares_transaction(
      { sdk, address: signer.toSuiAddress() },
      { kind: 'claim', source, ids: [id(201)] }
    )
    const data = tx.getData()
    const [command] = data.commands
    expect(command.MoveCall!.arguments).toHaveLength(source === 'offering' ? 4 : 3)
    const shared_ids = data.inputs.flatMap((input) =>
      input.Object?.SharedObject ? [input.Object.SharedObject.objectId] : []
    )
    expect(shared_ids).toContain(pins.kares_staking_pool.id)
    expect(shared_ids.includes(pins.kares_offering.id)).toBe(source === 'offering')
  }
  expect(client.calls.executions).toBe(0)
})

test('one claim PTB consumes every selected contribution once and transfers every payout together', async () => {
  const client = fake_client({ simulate_ok: true })
  const sdk = SDK({ client, pins, signer, transaction_storage: null })
  for (const object_id of [id(201), id(202)])
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
  const tx = await create_kares_transaction(
    { sdk, address: signer.toSuiAddress() },
    { kind: 'claim', source: 'offering', ids: [id(201), id(202), id(201)] }
  )
  const data = tx.getData()
  expect(data.commands.map((command) => command.$kind)).toEqual(['MoveCall', 'MoveCall', 'TransferObjects'])
  expect(data.commands[2].TransferObjects!.objects).toHaveLength(4)
  expect(
    data.inputs.flatMap((input) => (input.Object?.ImmOrOwnedObject ? [input.Object.ImmOrOwnedObject.objectId] : []))
  ).toEqual([id(201), id(202)])
  await expect(
    create_kares_transaction(
      { sdk, address: signer.toSuiAddress() },
      {
        kind: 'claim',
        source: 'offering',
        ids: [],
      }
    )
  ).rejects.toThrow('at least one')
  expect(client.calls.executions).toBe(0)
})

test('aggregated staking withdrawal and reward claims each compose one atomic multi-position PTB', async () => {
  const client = fake_client({ simulate_ok: true })
  const sdk = SDK({ client, pins, signer, transaction_storage: null })
  for (const object_id of [id(201), id(202)])
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
  const context = { sdk, address: signer.toSuiAddress() }
  const withdraw = await create_kares_transaction(context, {
    kind: 'withdraw',
    withdrawals: [
      { id: id(201), amount: 20n },
      { id: id(202), amount: 5n },
    ],
  })
  expect(withdraw.getData().commands.map((command) => command.$kind)).toEqual([
    'MoveCall',
    'MoveCall',
    'TransferObjects',
  ])
  expect(withdraw.getData().commands.at(-1)!.TransferObjects!.objects).toHaveLength(2)
  const claim = await create_kares_transaction(context, { kind: 'claim', source: 'staking', ids: [id(201), id(202)] })
  expect(claim.getData().commands.map((command) => command.$kind)).toEqual(['MoveCall', 'MoveCall', 'TransferObjects'])
  expect(claim.getData().commands.at(-1)!.TransferObjects!.objects).toHaveLength(4)
  expect(client.calls.executions).toBe(0)
})
