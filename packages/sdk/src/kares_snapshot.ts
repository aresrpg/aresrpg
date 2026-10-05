// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import { decode_rewards_economy } from './kares_economy.ts'
import { resolve_pins } from './pins.ts'
import type { Pins, SdkNetwork } from './client.ts'
import { absorb_object, absorb_receipt, type Receipt, type ResolutionCache } from './cache.ts'
import { kares_pins, type KaresPins } from './kares_ptb.ts'
import {
  CLOCK_BCS,
  COMBAT_POT_BCS,
  KARES_CURRENCY_BCS,
  COMMUNITY_POOL_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
  project_kares_pool,
  project_kares_position,
  project_community_claimable,
} from './kares_decode.ts'

type FinanceObject = SuiClientTypes.Object<{ content: true; json: true }>
export class KaresSnapshotPending extends Error {}

export type KaresCommunitySnapshot = Readonly<{
  id: string
  version: string
  started_ms: bigint
  remaining: bigint
  claimable: bigint
  treasury: string
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
  community: KaresCommunitySnapshot
  pool: KaresPoolSnapshot
  combat_pot: Readonly<{
    id: string
    version: string
    balance: bigint
    quota: bigint
    spent: bigint
    authorized: string
  }>
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
    const page = await client.core.listOwnedObjects({ owner, type, cursor, include: { content: true, json: true } })
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

const wallet_objects = async (client: SuiGrpcClient, pins: KaresPins, owner: string | null) => ({
  positions: owner
    ? await owned_objects(client, owner, `${pins.original}::staking::StakePosition<${pins.coin_type}>`)
    : [],
})

const wallet_balances = async (
  client: SuiGrpcClient,
  pins: KaresPins,
  owner: string | null
): Promise<KaresBalances> => {
  if (!owner) return { kares_balance: 0n, sui_balance: 0n }
  const [kares, sui] = await Promise.all([
    client.core.getBalance({ owner, coinType: pins.coin_type }),
    client.core.getBalance({ owner }),
  ])
  return { kares_balance: BigInt(kares.balance.balance), sui_balance: BigInt(sui.balance.balance) }
}

const shared_objects = async (client: SuiGrpcClient, pins: KaresPins) => {
  const ids = [
    pins.economy.id,
    pins.pool.id,
    pins.currency.id,
    normalizeSuiObjectId('0x6'),
    pins.combat_pot.id,
    pins.community.id,
  ]
  const types = [
    `${pins.original}::economy::Economy`,
    `${pins.original}::staking::StakingPool<${pins.coin_type}>`,
    `0x2::coin_registry::Currency<${pins.coin_type}>`,
    '0x2::clock::Clock',
    `${pins.original}::combat_rewards::CombatPot<${pins.coin_type}>`,
    `${pins.original}::community::CommunityPool<${pins.coin_type}>`,
  ]
  const { objects } = await client.core.getObjects({ objectIds: ids, include: { content: true, json: true } })
  const checked = ids.map((id, index) => {
    const object = objects.find(
      (candidate) => !(candidate instanceof Error) && normalizeSuiObjectId(candidate.objectId) === id
    )
    if (!object || object instanceof Error) throw new Error(`KARES object ${id} is unavailable`)
    const verified = canonical_object(object, id, types[index])
    const expected = [
      pins.economy.shared_version,
      pins.pool.shared_version,
      pins.currency.shared_version,
      '1',
      pins.combat_pot.shared_version,
      pins.community.shared_version,
    ][index]
    if (verified.owner.$kind !== 'Shared' || verified.owner.Shared.initialSharedVersion !== expected)
      throw new Error('KARES shared-object version does not match its deployment pins')
    return verified
  })
  return checked
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
  const [economy_object, pool_object, currency_object, clock_object, combat_object, community_object] = shared
  const economy = decode_rewards_economy(economy_object.json!)
  const community = COMMUNITY_POOL_BCS.parse(community_object.content)
  const pool = STAKING_POOL_BCS.parse(pool_object.content)
  const combat = COMBAT_POT_BCS.parse(combat_object.content)
  const currency = KARES_CURRENCY_BCS.parse(currency_object.content)
  const { timestamp_ms: clock_ms } = CLOCK_BCS.parse(clock_object.content)
  const links = [
    [economy.coin_type, pins.coin_type],
    [economy.id, pins.economy.id],
    [economy.currency, pins.currency.id],
    [economy.staking_pool, pins.pool.id],
    [pool.id, pins.pool.id],
    [economy.combat_pot, pins.combat_pot.id],
    [combat.id, pins.combat_pot.id],
    [economy.community_pool, pins.community.id],
    [community.id, pins.community.id],
  ]
  if (links.some(([actual, expected]) => actual !== expected))
    throw new Error('KARES economy and reserves are not linked')
  assert_currency(currency, pins)
  if (pool.buckets.length !== 31) throw new Error('KARES reward schedule is malformed')
  const projected = project_kares_pool(pool, clock_ms)
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
      authorized: normalizeStructTag(combat.authorized.name),
    }),
    total_supply: currency.supply!.BurnOnly!,
    positions: Object.freeze(positions),
    community: Object.freeze({
      id: community.id,
      version: community_object.version,
      started_ms: community.started_ms,
      remaining: community.remaining,
      claimable: project_community_claimable(community, clock_ms),
      treasury: community.treasury,
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
  return [`${pins.original}::staking::StakePosition<${pins.coin_type}>`]
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
  const shared_ids = [pins.economy.id, pins.pool.id, pins.currency.id, pins.combat_pot.id, pins.community.id]
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
    const wallet = await wallet_objects(client, pins, owner)
    const balances = include_balances ? await wallet_balances(client, pins, owner) : null
    const shared = await shared_objects(client, pins)
    const snapshot = decode_snapshot(network, owner, pins, shared, wallet)
    retain_snapshot([...shared, ...wallet.positions], owner)
    return { snapshot, balances }
  }
  return Object.freeze({
    snapshot: async (address?: string): Promise<KaresSnapshot> => {
      const { snapshot, balances } = await read_snapshot(address, true)
      return Object.freeze({ ...snapshot, ...balances! })
    },
    staking_snapshot: async (address?: string): Promise<KaresStakingSnapshot> =>
      (await read_snapshot(address, false)).snapshot,
    observe_receipt: (receipt: Receipt): void => {
      observe_finance_receipt(floors, kares_pins(raw_pins), receipt)
    },
  })
}

export const create_kares_reader = (options: Readonly<{ network: SdkNetwork; rpc_url?: string; pins?: Pins }>) =>
  create_kares_snapshot_reader(
    new SuiGrpcClient({
      network: options.network,
      baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
    }),
    resolve_pins(options.network, options.pins),
    options.network
  )
