// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * The currency launch: three treasury transactions, because Sui cannot use a package or a shared
 * object in the transaction that creates it.
 *   1. publish the currency and the pool's liquidity token, both immutable;
 *   2. register the currency as its shared object;
 *   3. open the supply, create the locked Aftermath pool and fund the reward reserves.
 */
import { bcs } from '@mysten/sui/bcs'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import {
  deriveObjectID,
  normalizeStructTag,
  normalizeSuiAddress,
  normalizeSuiObjectId,
  SUI_TYPE_ARG,
} from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import type { ContractArtifact, DeploymentReceipt, SharedDeploymentPin } from './deployment_admin.ts'
import { KARES_ALLOCATION, KARES_MARKET } from './kares_economics.ts'
import { add_rewards_setup, kares_coin_type, type RewardsSetup } from './kares_ptb.ts'

/** Aftermath's 18-decimal fixed point: 1e18 is 100%. */
const AFTERMATH_ONE = 1_000_000_000_000_000_000n
export const LAUNCH_KARES_WEIGHT = (AFTERMATH_ONE * KARES_MARKET.kares_weight_bps) / 10_000n
export const LAUNCH_SUI_WEIGHT = AFTERMATH_ONE - LAUNCH_KARES_WEIGHT
/** Charged on the coin going in and kept by the pool, so it deepens the locked liquidity. */
export const LAUNCH_POOL_FEE = (AFTERMATH_ONE * KARES_MARKET.pool_fee_bps) / 10_000n
/** Paid to the treasury on every swap, deposit and withdrawal. */
export const LAUNCH_DAO_FEE_BPS = Number(KARES_MARKET.treasury_fee_bps)
export const LAUNCH_POOL_NAME = 'KARES/SUI'
/** Both coins have nine decimals. Aftermath records them; the currency contract enforces KARES's nine. */
export const LAUNCH_COIN_DECIMALS = 9
/** Nobody can sign for this address: liquidity tokens sent here can never withdraw the pool. */
export const LIQUIDITY_LOCK_ADDRESS = normalizeSuiAddress('0x0')
/** Sui's coin registry. Its shared version is the mainnet one, read from the object on 2026-11-26. */
export const COIN_REGISTRY = Object.freeze({ id: normalizeSuiObjectId('0xc'), shared_version: '646801004' })

export type AftermathDeployment = Readonly<{
  amm: string
  amm_types: string
  amm_v2_types: string
  pool_registry: SharedDeploymentPin
  dao_fee: string
  dao_fee_types: string
  dao_fee_version: SharedDeploymentPin
}>

/**
 * Aftermath's mainnet deployment. Source: Aftermath `/api/addresses` (2026-11-26), each package checked
 * against its on-chain lineage. `amm_types`, `amm_v2_types` and `dao_fee_types` are the ids their struct types carry.
 */
export const AFTERMATH_MAINNET: AftermathDeployment = Object.freeze({
  amm: '0x93056cd889839d7186498c5e86d3087cb79dacb08ae0e18b9b2c42ebe06d7be7',
  amm_types: '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c',
  /** The AMM version that introduced `CreatePoolCapV2`: a type keeps the id of the version that defined it. */
  amm_v2_types: '0xf948935b111990c2b604900c9b2eeb8f24dcf9868a45d1ea1653a5f282c10e29',
  pool_registry: Object.freeze({
    id: '0xfcc774493db2c45c79f688f88d28023a3e7d98e4ee9f48bbf5c7990f651577ae',
    shared_version: '6808332',
  }),
  dao_fee: '0x3654c4a2d0956cb8ccd35c436a9c623512644689c46412f5f5d5447e321718ce',
  dao_fee_types: '0x6f60a091637054e23915b8745c0c0d47b1d49618ee3435b5f68eccf6a44fb53d',
  dao_fee_version: Object.freeze({
    id: '0xb4bfb0f917f12ad2a772bea9b4f22431f6f5f9653162c3ae6fae5b99b21392b7',
    shared_version: '293243902',
  }),
})

const shared = (tx: Transaction, pin: SharedDeploymentPin, mutable: boolean): TransactionObjectArgument =>
  tx.sharedObjectRef({ objectId: pin.id, initialSharedVersion: pin.shared_version, mutable })

/** Both packages are immutable from their first transaction: the supply and the pool token can never change. */
export const create_currency_publish_transaction = ({
  currency,
  liquidity_token,
}: Readonly<{ currency: ContractArtifact; liquidity_token: ContractArtifact }>): Transaction => {
  const tx = new Transaction()
  for (const artifact of [currency, liquidity_token]) {
    const upgrade_cap = tx.publish({ modules: [...artifact.modules], dependencies: [...artifact.dependencies] })
    tx.moveCall({ target: '0x2::package::make_immutable', arguments: [upgrade_cap] })
  }
  return tx
}

export type CurrencyPublication = Readonly<{
  coin_type: string
  liquidity_token_type: string
  genesis: string
  metadata_cap: string
  /** The currency as publication left it: owned by the coin registry until registered. */
  unregistered_currency: string
  pool_cap: string
}>

const owner_of = (receipt: DeploymentReceipt, id: string) =>
  receipt.Transaction?.effects?.changedObjects?.find((change) => change.objectId === id)?.outputOwner
const shared_version = (receipt: DeploymentReceipt, id: string): string | null => {
  const version = owner_of(receipt, id)?.Shared?.initialSharedVersion
  return version === undefined ? null : String(version)
}
const type_entries = (receipt: DeploymentReceipt): readonly (readonly [string, string])[] =>
  // Core lists each published package itself under this sentinel, which is not a struct tag.
  Object.entries(receipt.Transaction?.objectTypes ?? {}).filter(([, type]) => type !== 'package')
const only = (
  receipt: DeploymentReceipt,
  matches: (type: string) => boolean,
  name: string
): readonly [string, string] => {
  const found = type_entries(receipt).filter(([, type]) => matches(type))
  if (found.length !== 1) throw new Error(`Currency publication created ${String(found.length)} ${name}, expected one`)
  return found[0]!
}

export const project_currency_publication = (receipt: DeploymentReceipt): CurrencyPublication => {
  const [genesis, genesis_type] = only(receipt, (type) => type.endsWith('::kares::Genesis'), 'Genesis')
  const coin_type = kares_coin_type(`${genesis_type.split('::')[0]!}::kares::KARES`)
  const exact = (type: string) => (actual: string) => normalizeStructTag(actual) === normalizeStructTag(type)
  const [pool_cap, pool_cap_type] = only(receipt, (type) => type.endsWith('::pool::CreatePoolCapV2'), 'pool cap')
  const [, token_metadata] = only(
    receipt,
    (type) => /^0x0*2::coin::CoinMetadata<.+::af_lp::AF_LP>$/.test(type),
    'liquidity token'
  )
  if (!pool_cap_type) throw new Error('Currency publication created no pool cap')
  return Object.freeze({
    coin_type,
    liquidity_token_type: normalizeStructTag(token_metadata.slice(token_metadata.indexOf('<') + 1, -1)),
    genesis,
    metadata_cap: only(receipt, exact(`0x2::coin_registry::MetadataCap<${coin_type}>`), 'metadata cap')[0],
    unregistered_currency: only(receipt, exact(`0x2::coin_registry::Currency<${coin_type}>`), 'currency')[0],
    pool_cap,
  })
}

/** Anyone may register a published currency; it then lives at its derived shared address. */
export const create_currency_registration_transaction = ({
  coin_type,
  unregistered_currency,
}: Pick<CurrencyPublication, 'coin_type' | 'unregistered_currency'>): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: '0x2::coin_registry::finalize_registration',
    typeArguments: [kares_coin_type(coin_type)],
    arguments: [shared(tx, COIN_REGISTRY, true), tx.object(unregistered_currency)],
  })
  return tx
}

/**
 * Where a registered currency lives: derived from the coin registry and the coin type alone. Anyone may
 * register a published currency, so the launch finds it by this address and never by who registered it.
 */
export const registered_currency_id = (coin_type: string): string =>
  normalizeSuiObjectId(
    deriveObjectID(
      COIN_REGISTRY.id,
      `0x2::coin_registry::CurrencyKey<${kares_coin_type(coin_type)}>`,
      bcs.bool().serialize(false).toBytes()
    )
  )

/** Registration deletes the registry-owned currency and shares it again at its derived address. */
export const project_currency_registration = (receipt: DeploymentReceipt, coin_type: string): SharedDeploymentPin => {
  const currency = normalizeStructTag(`0x2::coin_registry::Currency<${coin_type}>`)
  const registered = type_entries(receipt).flatMap(([id, type]) => {
    const version = shared_version(receipt, id)
    return normalizeStructTag(type) === currency && version ? [Object.freeze({ id, shared_version: version })] : []
  })
  if (registered.length !== 1 || normalizeSuiObjectId(registered[0]!.id) !== registered_currency_id(coin_type))
    throw new Error('Registration did not share exactly one currency at its derived address')
  return registered[0]!
}

/**
 * Aftermath orders a pool's coins by type name. Every per-coin vector follows this order, so a weight
 * is always looked up by coin and never written by position.
 */
export const launch_pool_order = (coin_type: string): readonly ['sui' | 'kares', 'sui' | 'kares'] => {
  const name = (type: string) => normalizeStructTag(type).slice(2)
  return name(SUI_TYPE_ARG) < name(coin_type) ? ['sui', 'kares'] : ['kares', 'sui']
}

export type CurrencyLaunch = Readonly<{
  currency_package: string
  publication: Pick<CurrencyPublication, 'coin_type' | 'liquidity_token_type' | 'genesis' | 'pool_cap'>
  /** SUI the treasury locks beside the 540M KARES, in MIST. */
  seed_sui: bigint
  aftermath: AftermathDeployment
  rewards: RewardsSetup
}>

/**
 * One atomic launch. The supply opens into its three shares; the liquidity share and the seed SUI become
 * an 80/20 Aftermath pool behind a 2% treasury fee, with every liquidity token sent to the lock address;
 * the reserve share funds the Economy; the team share and the fee authority go to the treasury.
 */
export const create_currency_launch_transaction = (sdk: Sdk, terms: CurrencyLaunch): Transaction => {
  if (terms.seed_sui <= 0n) throw new Error('The launch needs a positive SUI seed')
  const { aftermath, publication, rewards } = terms
  const coin_type = kares_coin_type(publication.coin_type)
  if (coin_type !== kares_coin_type(rewards.coin_type)) throw new Error('Reward funding names another currency')
  const liquidity_token = normalizeStructTag(publication.liquidity_token_type)
  const treasury = normalizeSuiAddress(rewards.treasury)
  const tx = new Transaction()
  const [liquidity, reserves, team] = tx.moveCall({
    target: `${normalizeSuiObjectId(terms.currency_package)}::kares::split`,
    arguments: [sdk.door_context.obj(tx, publication.genesis, true)],
  })
  const [seed] = tx.splitCoins(tx.gas, [tx.pure.u64(terms.seed_sui)])
  const order = launch_pool_order(coin_type)
  const by_coin = <T>(values: Readonly<{ sui: T; kares: T }>): readonly T[] => order.map((coin) => values[coin])
  const per_coin = (value: bigint) => tx.pure.vector('u64', [value, value])
  const [pool, liquidity_tokens] = tx.moveCall({
    target: `${aftermath.amm}::pool_factory::create_pool_2_coins_v2`,
    typeArguments: [liquidity_token, ...by_coin({ sui: SUI_TYPE_ARG, kares: coin_type })],
    arguments: [
      sdk.door_context.obj(tx, publication.pool_cap, true),
      shared(tx, aftermath.pool_registry, true),
      tx.pure.vector('u8', [...new TextEncoder().encode(LAUNCH_POOL_NAME)]),
      tx.pure.vector('u64', by_coin({ sui: LAUNCH_SUI_WEIGHT, kares: LAUNCH_KARES_WEIGHT })),
      tx.pure.u64(0n),
      per_coin(LAUNCH_POOL_FEE),
      per_coin(0n),
      per_coin(0n),
      per_coin(0n),
      ...by_coin({ sui: seed!, kares: liquidity! }),
      // The shape of every pool Aftermath's own interface creates: decimals recorded, amounts not rescaled.
      tx.pure.option('vector<u8>', [...by_coin({ sui: LAUNCH_COIN_DECIMALS, kares: LAUNCH_COIN_DECIMALS })]),
      tx.pure.bool(false),
    ],
  })
  const [fee_pool, fee_owner] = tx.moveCall({
    target: `${aftermath.dao_fee}::pool::new`,
    typeArguments: [liquidity_token],
    arguments: [
      pool!,
      shared(tx, aftermath.dao_fee_version, false),
      tx.pure.u16(LAUNCH_DAO_FEE_BPS),
      tx.pure.address(treasury),
    ],
  })
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`${aftermath.dao_fee_types}::pool::DaoFeePool<${liquidity_token}>`],
    arguments: [fee_pool!],
  })
  tx.transferObjects([liquidity_tokens!], LIQUIDITY_LOCK_ADDRESS)
  add_rewards_setup(sdk, tx, rewards, reserves!)
  tx.transferObjects([fee_owner!, team!], treasury)
  return tx
}

export type CurrencyLaunchResult = Readonly<{
  market_pool: SharedDeploymentPin
  fee_owner: string
  locked_liquidity_tokens: string
}>

/** Reads the launch receipt. The reward pools come from `project_rewards_setup` on the same receipt. */
export const project_currency_launch = (
  receipt: DeploymentReceipt,
  aftermath: AftermathDeployment,
  liquidity_token_type: string
): CurrencyLaunchResult => {
  const liquidity_token = normalizeStructTag(liquidity_token_type)
  const exact = (type: string) => (actual: string) => normalizeStructTag(actual) === normalizeStructTag(type)
  const [market_pool] = only(receipt, exact(`${aftermath.dao_fee_types}::pool::DaoFeePool<${liquidity_token}>`), 'pool')
  const [fee_owner] = only(receipt, exact(`${aftermath.dao_fee_types}::pool::OwnerCap<${liquidity_token}>`), 'owner')
  const [locked] = only(receipt, exact(`0x2::coin::Coin<${liquidity_token}>`), 'liquidity coin')
  const version = shared_version(receipt, market_pool)
  if (!version) throw new Error('The market pool is not shared')
  if (normalizeSuiAddress(String(owner_of(receipt, locked)?.AddressOwner ?? '0x1')) !== LIQUIDITY_LOCK_ADDRESS)
    throw new Error('The pool liquidity is not locked')
  return Object.freeze({
    market_pool: Object.freeze({ id: market_pool, shared_version: version }),
    fee_owner,
    locked_liquidity_tokens: locked,
  })
}

type BalanceChange = Readonly<{ coinType: string; address: string; amount: string }>
/** Gas and storage the launch may spend beside its seed. */
const LAUNCH_GAS_ALLOWANCE = 1_000_000_000n

/** A simulation that did not succeed says nothing about the launch. */
const simulated_balance_changes = (receipt: DeploymentReceipt): readonly BalanceChange[] => {
  const simulated = receipt.Transaction as
    | (NonNullable<DeploymentReceipt['Transaction']> & Readonly<{ balanceChanges?: readonly BalanceChange[] }>)
    | undefined
  if (!simulated || receipt.FailedTransaction || simulated.effects?.status?.success === false)
    throw new Error('The launch simulation failed; nothing was signed')
  return simulated.balanceChanges ?? []
}

/** One coin's net movement, and whether any of it touched an address other than its one allowed holder. */
const coin_movement = (changes: readonly BalanceChange[], type: string, holder: string) => {
  const rows = changes.filter(({ coinType: coin }) => normalizeStructTag(coin) === normalizeStructTag(type))
  return Object.freeze({
    elsewhere: rows.some(({ address }) => normalizeSuiAddress(address) !== holder),
    total: rows.reduce((sum, { amount }) => sum + BigInt(amount), 0n),
  })
}

/**
 * The last check before the wallet opens, on what the chain says the launch would do. A launch that
 * does not lock all liquidity, moves KARES to anyone but the treasury, or spends other than the seed
 * is refused unsigned.
 */
export const assert_launch_simulation = (receipt: DeploymentReceipt, terms: CurrencyLaunch): void => {
  const changes = simulated_balance_changes(receipt)
  const liquidity_token = normalizeStructTag(terms.publication.liquidity_token_type)
  const treasury = normalizeSuiAddress(terms.rewards.treasury)
  // Refuses a pool that is not shared or liquidity that is not at the lock address.
  const { fee_owner } = project_currency_launch(receipt, terms.aftermath, liquidity_token)
  const kares = coin_movement(changes, kares_coin_type(terms.publication.coin_type), treasury)
  const locked = coin_movement(changes, liquidity_token, LIQUIDITY_LOCK_ADDRESS)
  const sui = coin_movement(changes, SUI_TYPE_ARG, treasury)
  const refusals: readonly (readonly [boolean, string])[] = [
    [
      normalizeSuiAddress(String(owner_of(receipt, fee_owner)?.AddressOwner ?? '0x0')) !== treasury,
      'The simulated launch does not leave the fee authority with the treasury',
    ],
    [changes.length === 0, 'The launch simulation returned no balance changes'],
    [
      kares.elsewhere || kares.total !== KARES_ALLOCATION.team,
      'The simulated launch leaves KARES outside the pool, the reserves and the treasury team share',
    ],
    [locked.elsewhere || locked.total <= 0n, 'The simulated launch does not lock every liquidity token'],
    [
      sui.elsewhere || -sui.total < terms.seed_sui || -sui.total > terms.seed_sui + LAUNCH_GAS_ALLOWANCE,
      'The simulated launch spends other than the seed and its gas',
    ],
  ]
  const refusal = refusals.find(([broken]) => broken)
  if (refusal) throw new Error(refusal[1])
}
