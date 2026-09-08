// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import PINS from '../../../pins.json' with { type: 'json' }

import type { Pins, SdkNetwork } from './client.ts'
import { absorb_object, absorb_receipt, type Receipt, type ResolutionCache } from './cache.ts'
import { kares_coin_type, kares_pins, type KaresPins } from './kares_ptb.ts'
import { KaresSnapshotPending, reconcile_kares_positions, type FinanceObject } from './kares_ownership.ts'
import {
  CLOCK_BCS,
  COMBAT_POT_BCS,
  CONTRIBUTION_BCS,
  KARES_CURRENCY_BCS,
  OFFERING_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
  project_kares_pool,
  project_kares_position,
  project_community_claimable,
  project_kares_schedule,
} from './kares_decode.ts'

export { KaresSnapshotPending } from './kares_ownership.ts'

export type KaresOfferingSnapshot = Readonly<{
  id: string
  version: string
  started: boolean
  duration_ms: bigint
  opens_ms: bigint
  closes_ms: bigint
  min_raise: bigint
  max_raise: bigint
  total_contributed: bigint
  accepted: bigint
  settled: boolean
  settled_ms: bigint
  community_remaining: bigint
  community_claimable: bigint
  treasury: string
  liquidity: string
}>
export type KaresPoolSnapshot = Readonly<{
  id: string
  version: string
  active: boolean
  total_staked: bigint
  active_ms: bigint
  initial_remaining: bigint
  kares_rewards: bigint
  sui_rewards: bigint
  daily_kares: bigint
  daily_sui: bigint
}>
export type KaresContributionSnapshot = Readonly<{ id: string; version: string; amount: bigint }>
export type KaresPositionSnapshot = Readonly<{
  id: string
  version: string
  amount: bigint
  pending_kares: bigint
  pending_sui: bigint
}>
export type KaresStakingSnapshot = Readonly<{
  network: SdkNetwork
  address: string | null
  clock_ms: bigint
  offering: KaresOfferingSnapshot
  pool: KaresPoolSnapshot
  combat_pot: Readonly<{ id: string; version: string; balance: bigint; quota: bigint; spent: bigint }>
  contributions: readonly KaresContributionSnapshot[]
  positions: readonly KaresPositionSnapshot[]
  total_supply: bigint
}>

export type KaresBalances = Readonly<{ kares_balance: bigint; sui_balance: bigint }>
export type KaresSnapshot = KaresStakingSnapshot & KaresBalances

const canonical_object = (object: FinanceObject, id: string, type: string): FinanceObject => {
  if (normalizeSuiObjectId(object.objectId) !== id || normalizeStructTag(object.type) !== normalizeStructTag(type))
    throw new Error('Unexpected canonical KARES object')
  if (!object.content) throw new Error('KARES object content is missing')
  return object
}

const owned_objects = async (client: SuiGrpcClient, owner: string, type: string): Promise<readonly FinanceObject[]> => {
  const objects: FinanceObject[] = []
  let cursor: string | null | undefined
  do {
    const page = await client.core.listOwnedObjects({ owner, type, cursor, include: { content: true } })
    for (const object of page.objects) {
      if (object.owner.$kind !== 'AddressOwner' || normalizeSuiObjectId(object.owner.AddressOwner) !== owner)
        throw new Error('KARES position belongs to another wallet')
      objects.push(canonical_object(object, normalizeSuiObjectId(object.objectId), type))
    }
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  if (new Set(objects.map(({ objectId }) => objectId)).size !== objects.length)
    throw new Error('KARES ownership changed during pagination; refresh the snapshot')
  return objects
}

const wallet_objects = async (client: SuiGrpcClient, pins: KaresPins, owner: string | null) => {
  if (!owner) return { contributions: [], positions: [] }
  const [contributions, positions] = await Promise.all([
    owned_objects(client, owner, `${pins.original}::offering::Contribution`),
    owned_objects(client, owner, `${pins.original}::staking::StakePosition`),
  ])
  return { contributions, positions }
}

const wallet_balances = async (
  client: SuiGrpcClient,
  pins: KaresPins,
  owner: string | null
): Promise<KaresBalances> => {
  if (!owner) return { kares_balance: 0n, sui_balance: 0n }
  const [kares, sui] = await Promise.all([
    client.core.getBalance({ owner, coinType: kares_coin_type(pins.original) }),
    client.core.getBalance({ owner }),
  ])
  return { kares_balance: BigInt(kares.balance.balance), sui_balance: BigInt(sui.balance.balance) }
}

const shared_objects = async (client: SuiGrpcClient, pins: KaresPins) => {
  const ids = [pins.offering.id, pins.pool.id, pins.currency.id, normalizeSuiObjectId('0x6'), pins.combat_pot.id]
  const types = [
    `${pins.original}::offering::Offering`,
    `${pins.original}::staking::StakingPool`,
    `0x2::coin_registry::Currency<${kares_coin_type(pins.original)}>`,
    '0x2::clock::Clock',
    `${pins.original}::combat_rewards::CombatPot`,
  ]
  const { objects } = await client.core.getObjects({ objectIds: ids, include: { content: true } })
  const checked = ids.map((id, index) => {
    const object = objects.find(
      (candidate) => !(candidate instanceof Error) && normalizeSuiObjectId(candidate.objectId) === id
    )
    if (!object || object instanceof Error) throw new Error(`KARES object ${id} is unavailable`)
    const verified = canonical_object(object, id, types[index])
    const expected = [
      pins.offering.shared_version,
      pins.pool.shared_version,
      pins.currency.shared_version,
      '1',
      pins.combat_pot.shared_version,
    ][index]
    if (verified.owner.$kind !== 'Shared' || verified.owner.Shared.initialSharedVersion !== expected)
      throw new Error('KARES shared-object version does not match its deployment pins')
    return verified
  })
  return checked as [FinanceObject, FinanceObject, FinanceObject, FinanceObject, FinanceObject]
}

const assert_currency = (currency: ReturnType<typeof KARES_CURRENCY_BCS.parse>, pins: KaresPins): void => {
  if (currency.id !== pins.currency.id || currency.decimals !== 9 || currency.supply?.$kind !== 'BurnOnly')
    throw new Error('KARES currency is not the expected burn-only supply')
}

const decode_snapshot = (
  network: SdkNetwork,
  address: string | null,
  pins: KaresPins,
  shared: readonly FinanceObject[],
  wallet: Awaited<ReturnType<typeof wallet_objects>>
): KaresStakingSnapshot => {
  const [offering_object, pool_object, currency_object, clock_object, combat_object] = shared
  const offering = OFFERING_BCS.parse(offering_object.content)
  const pool = STAKING_POOL_BCS.parse(pool_object.content)
  const combat = COMBAT_POT_BCS.parse(combat_object.content)
  if (offering.combat_pot !== pins.combat_pot.id || combat.id !== pins.combat_pot.id)
    throw new Error('KARES offering and combat pot are not linked')
  const currency = KARES_CURRENCY_BCS.parse(currency_object.content)
  const { timestamp_ms: clock_ms } = CLOCK_BCS.parse(clock_object.content)
  if (offering.pool !== pins.pool.id || offering.id !== pins.offering.id || pool.id !== pins.pool.id)
    throw new Error('KARES offering and staking pool are not linked')
  assert_currency(currency, pins)
  if (pool.buckets.length !== 31) throw new Error('KARES reward schedule is malformed')
  const projected = project_kares_pool(pool, clock_ms)
  const contributions = wallet.contributions.map((object) => {
    const contribution = CONTRIBUTION_BCS.parse(object.content)
    if (contribution.id !== normalizeSuiObjectId(object.objectId) || contribution.offering !== pins.offering.id)
      throw new Error('Contribution targets another offering')
    return Object.freeze({ id: object.objectId, version: object.version, amount: contribution.amount })
  })
  const positions = wallet.positions.map((object) => {
    const position = STAKE_POSITION_BCS.parse(object.content)
    if (position.id !== normalizeSuiObjectId(object.objectId) || position.pool !== pins.pool.id)
      throw new Error('Position targets another staking pool')
    const pending = project_kares_position(projected, position)
    return Object.freeze({
      id: object.objectId,
      version: object.version,
      amount: position.amount,
      ...pending,
    })
  })
  return Object.freeze({
    network,
    address,
    clock_ms,
    combat_pot: Object.freeze({
      id: combat.id,
      version: combat_object.version,
      balance: combat.balance,
      quota: combat.quota,
      spent: combat.spent,
    }),
    total_supply: currency.supply!.BurnOnly!,
    contributions: Object.freeze(contributions),
    positions: Object.freeze(positions),
    offering: Object.freeze({
      id: offering.id,
      version: offering_object.version,
      ...project_kares_schedule(offering),
      min_raise: offering.minimum,
      max_raise: offering.maximum,
      total_contributed: offering.total_deposited,
      accepted: offering.accepted,
      settled: offering.settled,
      settled_ms: offering.settled_ms,
      community_remaining: offering.community_tokens,
      community_claimable: project_community_claimable(offering, clock_ms),
      treasury: offering.treasury,
      liquidity: offering.liquidity,
    }),
    pool: Object.freeze({
      id: pool.id,
      version: pool_object.version,
      active: pool.active,
      total_staked: pool.principal,
      active_ms: projected.active_ms,
      initial_remaining: projected.initial_remaining,
      kares_rewards: pool.kares_rewards,
      sui_rewards: pool.sui_rewards,
      daily_kares: projected.daily_kares,
      daily_sui: projected.daily_sui,
    }),
  })
}

type VersionFloor = Readonly<{ version: bigint; deleted: boolean; owner: string | null }>
type ChangedObject = NonNullable<NonNullable<NonNullable<Receipt['Transaction']>['effects']>['changedObjects']>[number]

const position_type = (type: string | undefined, pins: KaresPins): boolean => {
  if (!type || type === 'package') return false
  return [`${pins.original}::offering::Contribution`, `${pins.original}::staking::StakePosition`]
    .map(normalizeStructTag)
    .includes(normalizeStructTag(type))
}

const changed_floor = (change: ChangedObject, previous?: VersionFloor): VersionFloor => {
  const output_owner = change.outputOwner ?? {}
  return Object.freeze({
    version: BigInt(change.outputVersion ?? previous?.version ?? 0n),
    deleted: change.outputState === 'DoesNotExist' || change.idOperation === 'Deleted',
    owner: typeof output_owner.AddressOwner === 'string' ? normalizeSuiObjectId(output_owner.AddressOwner) : null,
  })
}

const receipt_changes = (receipt: Receipt) => {
  const transaction = receipt.Transaction ?? receipt.FailedTransaction
  return { types: transaction?.objectTypes ?? {}, changes: transaction?.effects?.changedObjects ?? [] }
}

const retain_floor = (floors: Map<string, VersionFloor>, id: string, observed: VersionFloor): void => {
  if (observed.version >= (floors.get(id)?.version ?? 0n)) floors.set(id, observed)
}

const observe_finance_receipt = (floors: Map<string, VersionFloor>, pins: KaresPins, receipt: Receipt) => {
  const { types, changes } = receipt_changes(receipt)
  const shared_ids = [pins.offering.id, pins.pool.id, pins.currency.id, pins.combat_pot.id]
  for (const change of changes) {
    if (!change.objectId) continue
    const id = normalizeSuiObjectId(change.objectId)
    if (![floors.has(id), shared_ids.includes(id), position_type(types[change.objectId], pins)].some(Boolean)) continue
    const observed = changed_floor(change, floors.get(id))
    retain_floor(floors, id, observed)
  }
}

const assert_version = (object: FinanceObject, known?: VersionFloor): void => {
  if (known && (known.deleted || BigInt(object.version) < known.version))
    throw new KaresSnapshotPending('KARES snapshot is behind a certified transaction; refresh before continuing')
}

const assert_owned_presence = (
  floors: ReadonlyMap<string, VersionFloor>,
  ids: ReadonlySet<string>,
  owner: string | null
): void => {
  if (!owner) return
  for (const [id, known] of floors) {
    if (!known.deleted && known.owner === owner && !ids.has(id))
      throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
  }
}

const cache_floor = (cache: ResolutionCache | undefined, id: string): VersionFloor | undefined => {
  const version = cache?.owned.get(id)?.version ?? cache?.shared.get(id)?.version
  return version ? { version: BigInt(version), deleted: false, owner: null } : undefined
}

/** Each connected session retains receipt version floors; stale RPC pages fail closed. */
export const create_kares_snapshot_reader = (
  client: SuiGrpcClient,
  raw_pins: Pins,
  network: SdkNetwork,
  cache?: ResolutionCache
) => {
  const floors = new Map<string, VersionFloor>()
  const reconcile_wallet = async (
    pins: KaresPins,
    owner: string | null,
    wallet: Awaited<ReturnType<typeof wallet_objects>>
  ) => {
    if (!owner) return wallet
    const ids = new Set(
      [...wallet.contributions, ...wallet.positions].map(({ objectId }) => normalizeSuiObjectId(objectId))
    )
    const missing = [...floors]
      .filter(([id, known]) => !known.deleted && known.owner === owner && !ids.has(id))
      .map(([id, known]) => ({ id, version: known.version }))
    const resolved = await reconcile_kares_positions(client, pins, owner, missing)
    for (const result of resolved) {
      if ('receipt' in result) {
        observe_finance_receipt(floors, pins, result.receipt)
        if (cache) absorb_receipt(cache, result.receipt)
      }
    }
    const restored = resolved.flatMap((result) => ('object' in result ? [result.object] : []))
    return {
      ...wallet,
      contributions: [
        ...wallet.contributions,
        ...restored.filter(({ type }) => type.endsWith('::offering::Contribution')),
      ],
      positions: [...wallet.positions, ...restored.filter(({ type }) => type.endsWith('::staking::StakePosition'))],
    }
  }
  const retain_snapshot = (objects: readonly FinanceObject[], owner: string | null): void => {
    const ids = new Set(objects.map(({ objectId }) => normalizeSuiObjectId(objectId)))
    const versions = objects.map((object) => ({
      object,
      id: normalizeSuiObjectId(object.objectId),
      version: BigInt(object.version),
    }))
    assert_owned_presence(floors, ids, owner)
    for (const object of objects) {
      const id = normalizeSuiObjectId(object.objectId)
      assert_version(object, floors.get(id))
      assert_version(object, cache_floor(cache, id))
    }
    for (const { object, id, version } of versions) {
      floors.set(
        id,
        Object.freeze({
          version,
          deleted: false,
          owner: object.owner.$kind === 'AddressOwner' ? normalizeSuiObjectId(object.owner.AddressOwner) : null,
        })
      )
      if (cache) absorb_object(cache, object)
    }
  }
  const read_snapshot = async (address: string | undefined, include_balances: boolean) => {
    if (client.network !== network) throw new Error('KARES reader belongs to a different network')
    const pins = kares_pins(raw_pins)
    const owner = address ? normalizeSuiObjectId(address) : null
    // Positions precede shared indexes. The game session owns its balances independently.
    const wallet = await reconcile_wallet(pins, owner, await wallet_objects(client, pins, owner))
    const balances = include_balances ? await wallet_balances(client, pins, owner) : null
    const shared = await shared_objects(client, pins)
    const snapshot = decode_snapshot(network, owner, pins, shared, wallet)
    retain_snapshot([...shared, ...wallet.contributions, ...wallet.positions], owner)
    return { snapshot, balances }
  }
  return Object.freeze({
    snapshot: async (address?: string): Promise<KaresSnapshot> => {
      const { snapshot, balances } = await read_snapshot(address, true)
      return Object.freeze({ ...snapshot, ...balances! })
    },
    staking_snapshot: async (address?: string): Promise<KaresStakingSnapshot> =>
      (await read_snapshot(address, false)).snapshot,
    observe_receipt: (receipt: Receipt, consumed: readonly string[] = []): void => {
      observe_finance_receipt(floors, kares_pins(raw_pins), receipt)
      for (const id of consumed) {
        const normalized = normalizeSuiObjectId(id)
        floors.set(
          normalized,
          Object.freeze({ version: floors.get(normalized)?.version ?? 0n, deleted: true, owner: null })
        )
      }
    },
  })
}

export const create_kares_reader = (options: Readonly<{ network: SdkNetwork; rpc_url?: string; pins?: Pins }>) =>
  create_kares_snapshot_reader(
    new SuiGrpcClient({
      network: options.network,
      baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
    }),
    options.pins ?? (PINS as Record<string, Pins>)[options.network],
    options.network
  )
