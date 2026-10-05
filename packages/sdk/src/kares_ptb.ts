// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction, coinWithBalance, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { isValidSuiAddress, normalizeSuiObjectId, normalizeStructTag } from '@mysten/sui/utils'

import type { Pins, Sdk, SharedPin } from './client.ts'
import { KARES_RESERVE_SUPPLY } from './kares_economics.ts'

export { KARES_UNIT, KARES_SUPPLY, KARES_ALLOCATION } from './kares_economics.ts'

export type KaresPins = Readonly<{
  package: string
  original: string
  coin_type: string
  currency: Readonly<{ id: string; shared_version: string }>
  economy: Readonly<{ id: string; shared_version: string }>
  pool: Readonly<{ id: string; shared_version: string }>
  combat_pot: Readonly<{ id: string; shared_version: string }>
  community: Readonly<{ id: string; shared_version: string }>
}>

const address = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !isValidSuiAddress(value)) throw new Error(`KARES ${name} is not configured`)
  return normalizeSuiObjectId(value)
}

export const rewards_shared_pin = (value: unknown, name: string): KaresPins['pool'] => {
  const pin = value as SharedPin | undefined
  if (!pin || typeof pin.shared_version !== 'string' || !/^[1-9]\d*$/.test(pin.shared_version))
    throw new Error(`KARES ${name} is not configured`)
  return Object.freeze({ id: address(pin.id, name), shared_version: pin.shared_version })
}

/** Currency identity is independent of the reward contracts and of the retired token. */
export const kares_coin_type = (value: unknown): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw new Error('KARES coin type is not configured')
  return normalizeStructTag(value)
}

export const kares_pins = (pins: Pins): KaresPins =>
  Object.freeze({
    package: address(pins.kares_rewards_package, 'rewards package'),
    original: address(pins.kares_rewards_package_original, 'original rewards package'),
    coin_type: kares_coin_type(pins.kares_coin_type),
    currency: rewards_shared_pin(pins.kares_currency, 'currency'),
    economy: rewards_shared_pin(pins.kares_economy, 'economy'),
    pool: rewards_shared_pin(pins.kares_staking_pool, 'staking pool'),
    combat_pot: rewards_shared_pin(pins.kares_combat_pot, 'combat pot'),
    community: rewards_shared_pin(pins.kares_community_pool, 'community pool'),
  })

export const kares_shared = (tx: Transaction, pin: KaresPins['pool'], mutable = true): TransactionObjectArgument =>
  tx.sharedObjectRef({ objectId: pin.id, initialSharedVersion: pin.shared_version, mutable })
export const kares_clock = (tx: Transaction): TransactionObjectArgument =>
  tx.sharedObjectRef({ objectId: normalizeSuiObjectId('0x6'), initialSharedVersion: '1', mutable: false })

export const positive_kares_amount = (amount: bigint): bigint => {
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error('Amount must be a positive u64')
  return amount
}

export const kares_payment = (
  sdk: Readonly<{ pins: Pins }>,
  tx: Transaction,
  amount: bigint
): TransactionObjectArgument => {
  positive_kares_amount(amount)
  return tx.add(
    coinWithBalance({ type: kares_coin_type(sdk.pins.kares_coin_type), balance: amount, useGasCoin: false })
  )
}

export const fund_kares_reward = (
  tx: Transaction,
  pins: KaresPins,
  asset: 'kares' | 'sui',
  payment: TransactionObjectArgument
): void => {
  tx.moveCall({
    target: `${pins.package}::staking::fund_${asset}`,
    typeArguments: [pins.coin_type],
    arguments: [kares_shared(tx, pins.pool), payment, kares_clock(tx)],
  })
}

export type RewardsSetup = Readonly<{
  package: string
  setup: string
  economy: KaresPins['economy']
  upgrade_cap: string
  coin_type: string
  currency: KaresPins['currency']
  treasury: string
  victory_type: string
}>

/** Explicit one-shot funding; upgrade authority stays with its owner until the later project freeze. */
export const create_rewards_setup_transaction = (sdk: Sdk, terms: RewardsSetup): Transaction => {
  const tx = new Transaction()
  const coin_type = kares_coin_type(terms.coin_type)
  const reserve = tx.add(coinWithBalance({ type: coin_type, balance: KARES_RESERVE_SUPPLY, useGasCoin: false }))
  tx.moveCall({
    target: `${address(terms.package, 'rewards package')}::economy::setup`,
    typeArguments: [coin_type, terms.victory_type],
    arguments: [
      sdk.door_context.obj(tx, terms.setup, true),
      kares_shared(tx, terms.economy),
      sdk.door_context.obj(tx, terms.upgrade_cap, false),
      kares_shared(tx, terms.currency, false),
      reserve,
      tx.pure.address(address(terms.treasury, 'treasury')),
      kares_clock(tx),
    ],
  })
  return tx
}

export const create_kares_community_claim_transaction = (pins: KaresPins, recipient: string): Transaction => {
  const tx = new Transaction()
  const [payment] = tx.moveCall({
    target: `${pins.package}::community::claim`,
    typeArguments: [pins.coin_type],
    arguments: [kares_shared(tx, pins.community), kares_clock(tx)],
  })
  tx.transferObjects([payment], recipient)
  return tx
}
