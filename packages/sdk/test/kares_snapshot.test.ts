// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_kares_snapshot_reader } from '../src/kares_snapshot.ts'
import {
  CLOCK_BCS,
  COMBAT_POT_BCS,
  CONTRIBUTION_BCS,
  KARES_CURRENCY_BCS,
  OFFERING_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
} from '../src/kares_decode.ts'
import { create_cache } from '../src/cache.ts'
import { SDK } from '../src/client.ts'
import { create_kares_transaction } from '../src/kares_actions.ts'

import { digest, fake_client, id } from './helpers/transport.ts'

// Synthetic transport scenarios prove reconciliation, not wire-layout compatibility.
// Real chain BCS captures are validated separately by the testnet rehearsal fixture test.
const pins = {
  kares_package: id(100),
  kares_package_original: id(100),
  kares_currency: { id: id(101), shared_version: '1' },
  kares_offering: { id: id(102), shared_version: '1' },
  kares_staking_pool: { id: id(103), shared_version: '1' },
  kares_combat_pot: { id: id(109), shared_version: '1' },
}
const owner = id(200)
const shared_owner = { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }
const object = (object_id: string, type: string, content: Uint8Array) => ({
  objectId: object_id,
  version: '2',
  digest: 'fixture',
  type,
  content,
  owner: shared_owner,
})
const canonical = () => [
  object(
    id(102),
    `${id(100)}::offering::Offering`,
    OFFERING_BCS.serialize({
      id: id(102),
      pool: id(103),
      minimum: 5n,
      maximum: 20n,
      started_ms: 0n,
      duration_ms: 100n,
      treasury: owner,
      liquidity: owner,
      deposits: 1n,
      sale_tokens: 200_000_000_000_000n,
      liquidity_tokens: 80_000_000_000_000n,
      total_deposited: 1n,
      accepted: 0n,
      settled: false,
      community_tokens: 110_000_000_000_000n,
      combat_pot: id(109),
      combat_tokens: 100_000_000_000_000n,
      settled_ms: 0n,
    }).toBytes()
  ),
  object(
    id(103),
    `${id(100)}::staking::StakingPool`,
    STAKING_POOL_BCS.serialize({
      id: id(103),
      active: false,
      principal: 0n,
      kares_rewards: 200_000_000_000_000n,
      sui_rewards: 0n,
      last_wall_ms: 0n,
      active_ms: 0n,
      initial_released: 0n,
      kares_index: 0n,
      sui_index: 0n,
      kares_remainder: 0n,
      sui_remainder: 0n,
      buckets: Array.from({ length: 31 }, () => ({
        start_ms: 0n,
        kares: 0n,
        sui: 0n,
        released_kares: 0n,
        released_sui: 0n,
      })),
    }).toBytes()
  ),
  object(
    id(101),
    `0x2::coin_registry::Currency<${id(100)}::kares::KARES>`,
    KARES_CURRENCY_BCS.serialize({
      id: id(101),
      decimals: 9,
      name: 'AresRPG',
      symbol: 'KARES',
      description: '',
      icon_url: '',
      supply: { BurnOnly: 1_000_000_000_000_000n },
      regulated: { Unregulated: true },
      treasury_cap_id: null,
      metadata_cap_id: { Deleted: true },
      extra_fields: [],
    }).toBytes()
  ),
  object(
    id(109),
    `${id(100)}::combat_rewards::CombatPot`,
    COMBAT_POT_BCS.serialize({
      id: id(109),
      balance: 0n,
      authorized: null,
      epoch: 0n,
      epoch_started_ms: 0n,
      work: 0n,
      quota: 20_000n,
      day: 0n,
      spent: 0n,
    }).toBytes()
  ),
  object(id(6), '0x2::clock::Clock', CLOCK_BCS.serialize({ id: id(6), timestamp_ms: 10n }).toBytes()),
]
const contribution = () => ({
  ...object(
    id(104),
    `${id(100)}::offering::Contribution`,
    CONTRIBUTION_BCS.serialize({ id: id(104), offering: id(102), amount: 1n }).toBytes()
  ),
  owner: { $kind: 'AddressOwner', AddressOwner: owner },
})
const deletion = (version = '2', deleted_owner = owner) => ({
  $kind: 'Transaction',
  Transaction: {
    digest: 'external-claim',
    effects: {
      status: { success: true },
      changedObjects: [
        {
          objectId: id(104),
          inputVersion: version,
          inputOwner: { $kind: 'AddressOwner', AddressOwner: deleted_owner },
          outputVersion: null,
          outputState: 'DoesNotExist',
          idOperation: 'Deleted',
        },
      ],
    },
  },
})
const fixture = () => {
  const state = {
    shared: canonical(),
    contributions: [contribution()],
    positions: [] as ReturnType<typeof contribution>[],
    direct: null as ReturnType<typeof contribution>[] | null,
    deleted: null as ReturnType<typeof deletion> | null,
    history_reads: [] as string[],
  }
  const client = {
    network: 'testnet',
    core: {
      listOwnedObjects: async ({ type }: { type: string }) => ({
        objects: type.endsWith('::Contribution') ? state.contributions : state.positions,
        hasNextPage: false,
        cursor: null,
      }),
      getBalance: async () => ({ balance: { balance: '100' } }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map(
          (object_id) =>
            [...state.shared, ...(state.direct ?? [...state.contributions, ...state.positions])].find(
              (row) => row.objectId === object_id
            ) ?? Object.assign(new Error('not found'), { code: 'notExists', objectId: object_id })
        ),
      }),
      getTransaction: async () => state.deleted,
    },
    ledgerService: {
      listTransactions: (request: {
        filter: { terms: { literals: { predicate: { affectedObject: { objectId: string } } }[] }[] }
      }) => {
        state.history_reads.push(request.filter.terms[0].literals[0].predicate.affectedObject.objectId)
        return {
          responses: (async function* () {
            if (state.deleted) yield { transaction: { digest: state.deleted.Transaction.digest } }
          })(),
        }
      },
    },
  }
  return { state, client }
}

test('public finance reading needs no wallet or game pins', async () => {
  const { client } = fixture()
  const snapshot = await create_kares_snapshot_reader(client as never, pins, 'testnet').snapshot()
  expect(snapshot.address).toBeNull()
  expect(snapshot.contributions).toEqual([])
  expect(snapshot.total_supply).toBe(1_000_000_000_000_000n)
  expect(snapshot.offering.min_raise).toBe(5n)
})

test('a finance reader cannot label another network as its configured deployment', async () => {
  const { client } = fixture()
  await expect(create_kares_snapshot_reader(client as never, pins, 'mainnet').snapshot()).rejects.toThrow(
    'different network'
  )
})

test('an external claim retires an observed position and removes its cached spending reference', async () => {
  const { state, client } = fixture()
  const cache = create_cache()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet', cache)
  await reader.snapshot(owner)
  state.contributions = []
  state.deleted = deletion()
  expect((await reader.snapshot(owner)).contributions).toEqual([])
  expect(cache.owned.has(id(104))).toBe(false)
  expect(state.history_reads).toEqual([id(104)])
  state.contributions = [contribution()]
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
})

test('an external claim before the first indexed observation clears only with certified consumption', async () => {
  const { state, client } = fixture()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  reader.observe_receipt({
    Transaction: {
      objectTypes: { [id(104)]: `${id(100)}::offering::Contribution` },
      effects: { changedObjects: [{ objectId: id(104), outputVersion: '2', outputOwner: { AddressOwner: owner } }] },
    },
  })
  state.contributions = []
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
  state.deleted = deletion()
  expect((await reader.snapshot(owner)).contributions).toEqual([])
})

test('a missing indexed row is restored from its live object before reading shared state', async () => {
  const { state, client } = fixture()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  await reader.snapshot(owner)
  state.direct = [{ ...contribution(), version: '3' }]
  state.contributions = []
  expect((await reader.snapshot(owner)).contributions[0].version).toBe('3')
  expect(state.history_reads).toEqual([])
})

test('fresh finance reads update the exact owned reference used by the next transaction', async () => {
  const { state, client } = fixture()
  const sdk = SDK({ client: fake_client({ simulate_ok: true }), pins, address: owner, transaction_storage: null })
  sdk.cache.owned.set(id(104), { objectId: id(104), version: '2', digest })
  state.contributions = [{ ...contribution(), version: '3', digest }]
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet', sdk.cache)
  await reader.snapshot(owner)
  const tx = await create_kares_transaction(
    { sdk, address: owner },
    { kind: 'claim', source: 'offering', ids: [id(104)] }
  )
  expect(
    tx.getData().inputs.find((input) => input.Object?.ImmOrOwnedObject?.objectId === id(104))?.Object?.ImmOrOwnedObject
      ?.version
  ).toBe('3')
  state.contributions = [{ ...contribution(), digest }]
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
  expect(sdk.ref(id(104))?.version).toBe('3')
})

test('unrelated or older deletion evidence cannot clear a required position', async () => {
  const { state, client } = fixture()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  await reader.snapshot(owner)
  state.contributions = []
  state.deleted = deletion('1')
  await expect(reader.snapshot(owner)).rejects.toThrow('older than the observed position')
  state.deleted = deletion('2', id(999))
  await expect(reader.snapshot(owner)).rejects.toThrow('another owner')
  state.deleted = deletion()
  expect((await reader.snapshot(owner)).contributions).toEqual([])
})

test('an invalid finance snapshot cannot advance the shared resolution cache', async () => {
  const { state, client } = fixture()
  const cache = create_cache()
  cache.owned.set(id(104), { objectId: id(104), version: '2', digest })
  state.contributions = [{ ...contribution(), version: '3', digest }]
  state.shared[0].owner = { $kind: 'Shared', Shared: { initialSharedVersion: '9' } }
  await expect(create_kares_snapshot_reader(client as never, pins, 'testnet', cache).snapshot(owner)).rejects.toThrow(
    'deployment pins'
  )
  expect(cache.owned.get(id(104))?.version).toBe('2')
})

test('receipt floors reject stale shared data, stale owner pages, and consumed contribution resurrection', async () => {
  const { state, client } = fixture()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  await reader.snapshot(owner)
  reader.observe_receipt({ Transaction: { effects: { changedObjects: [{ objectId: id(102), outputVersion: '3' }] } } })
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
  state.shared[0].version = '3'
  await reader.snapshot(owner)
  state.contributions = []
  await expect(reader.snapshot(owner)).rejects.toThrow('ownership snapshot is behind')
  reader.observe_receipt({ Transaction: { digest: 'claimed' } }, [id(104)])
  expect((await reader.snapshot(owner)).contributions).toEqual([])
  state.contributions = [contribution()]
  await expect(reader.snapshot(owner)).rejects.toThrow('behind a certified transaction')
})

test('the common SDK receipt cache protects finance reads after game-side burns', async () => {
  const { client } = fixture()
  const cache = create_cache()
  cache.shared.set(id(101), { initialSharedVersion: '1', version: '3' })
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet', cache)
  await expect(reader.snapshot()).rejects.toThrow('behind a certified transaction')
})

test('wrong shared versions and foreign position ownership fail closed', async () => {
  const { state, client } = fixture()
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  state.shared[0].owner = { $kind: 'Shared', Shared: { initialSharedVersion: '9' } }
  await expect(reader.snapshot(owner)).rejects.toThrow('deployment pins')
  state.shared[0].owner = shared_owner
  state.contributions[0].owner = { $kind: 'AddressOwner', AddressOwner: id(201) }
  await expect(reader.snapshot(owner)).rejects.toThrow('another wallet')
})

test('pool indexes must be at least as fresh as every owned position', async () => {
  const { state, client } = fixture()
  state.positions = [
    {
      ...object(
        id(105),
        `${id(100)}::staking::StakePosition`,
        STAKE_POSITION_BCS.serialize({
          id: id(105),
          pool: id(103),
          amount: 1n,
          kares_index: 1n,
          sui_index: 0n,
          kares_accrued: 0n,
          sui_accrued: 0n,
        }).toBytes()
      ),
      owner: { $kind: 'AddressOwner', AddressOwner: owner },
    },
  ]
  await expect(create_kares_snapshot_reader(client as never, pins, 'testnet').snapshot(owner)).rejects.toThrow(
    'older than the position'
  )
})

test('sealed configuration has no live window until the one start timestamp is present', async () => {
  const { state, client } = fixture()
  const [offering] = state.shared
  const raw = OFFERING_BCS.parse(offering.content)
  state.shared[0] = { ...offering, content: OFFERING_BCS.serialize({ ...raw, started_ms: null }).toBytes() }
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  const paused = await reader.snapshot()
  expect(paused.offering.started).toBe(false)
  expect(paused.offering.closes_ms).toBe(0n)
  state.shared[0] = { ...offering, content: OFFERING_BCS.serialize({ ...raw, started_ms: 25n }).toBytes() }
  const started = await reader.snapshot()
  expect(started.offering.started).toBe(true)
  expect(started.offering.opens_ms).toBe(25n)
  expect(started.offering.closes_ms).toBe(125n)
})

test('daily staking estimates follow funded emissions, stake share, pauses and schedule boundaries', async () => {
  const unit = 1_000_000_000n
  const day = 86_400_000n
  for (const scenario of [
    { active: true, amount: 25n * unit, start: 0n, elapsed: 0n, kares: 113_589_041_095n, sui: 2_000_000_000n },
    { active: false, amount: 25n * unit, start: 0n, elapsed: 0n, kares: 0n, sui: 0n },
    { active: true, amount: 0n, start: 0n, elapsed: 0n, kares: 113_589_041_095n, sui: 2_000_000_000n },
    { active: true, amount: 25n * unit, start: day, elapsed: 0n, kares: 109_589_041_095n, sui: 0n },
    { active: true, amount: 25n * unit, start: day / 2n, elapsed: 0n, kares: 111_589_041_095n, sui: 1_000_000_000n },
    { active: true, amount: 25n * unit, start: 0n, elapsed: 1_825n * day, kares: 0n, sui: 0n },
  ]) {
    const { state, client } = fixture()
    const pool_row = state.shared.find((row) => row.objectId === id(103))!
    const pool = STAKING_POOL_BCS.parse(pool_row.content)
    pool_row.content = STAKING_POOL_BCS.serialize({
      ...pool,
      active: scenario.active,
      principal: 100n * unit,
      active_ms: scenario.elapsed,
      buckets: pool.buckets.map((bucket, index) =>
        index === 0 ? { ...bucket, start_ms: scenario.start, kares: 120n * unit, sui: 60n * unit } : bucket
      ),
    }).toBytes()
    state.shared.find((row) => row.objectId === id(6))!.content = CLOCK_BCS.serialize({
      id: id(6),
      timestamp_ms: 0n,
    }).toBytes()
    state.positions = [
      {
        ...object(
          id(106),
          `${id(100)}::staking::StakePosition`,
          STAKE_POSITION_BCS.serialize({
            id: id(106),
            pool: id(103),
            amount: scenario.amount,
            kares_index: 0n,
            sui_index: 0n,
            kares_accrued: 7n * 10n ** 27n,
            sui_accrued: 9n * 10n ** 27n,
          }).toBytes()
        ),
        owner: { $kind: 'AddressOwner', AddressOwner: owner },
      },
    ]
    const snapshot = await create_kares_snapshot_reader(client as never, pins, 'testnet').snapshot(owner)
    expect(snapshot.pool).toMatchObject({ daily_kares: scenario.kares, daily_sui: scenario.sui })
  }
})

test('managed staking reads never fetch or retain a duplicate wallet balance', async () => {
  const { client } = fixture()
  let reads = 0
  client.core.getBalance = async () => {
    reads += 1
    return { balance: { balance: '100' } }
  }
  const reader = create_kares_snapshot_reader(client as never, pins, 'testnet')
  const staking = await reader.staking_snapshot(owner)
  expect(reads).toBe(0)
  expect(staking).not.toHaveProperty('kares_balance')
  expect(staking).not.toHaveProperty('sui_balance')
  const full = await reader.snapshot(owner)
  expect(reads).toBe(2)
  expect(full.kares_balance).toBe(100n)
  expect(full.sui_balance).toBe(100n)
})
