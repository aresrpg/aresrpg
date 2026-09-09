// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction, coinWithBalance, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { isValidSuiAddress, normalizeSuiObjectId } from '@mysten/sui/utils'

import type { Pins, Sdk, SharedPin } from './client.ts'

export { KARES_UNIT, KARES_SUPPLY, KARES_ALLOCATION } from './kares_economics.ts'

export type KaresPins = Readonly<{
  package: string
  original: string
  currency: Readonly<{ id: string; shared_version: string }>
  offering: Readonly<{ id: string; shared_version: string }>
  pool: Readonly<{ id: string; shared_version: string }>
  combat_pot: Readonly<{ id: string; shared_version: string }>
}>

const address = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !isValidSuiAddress(value)) throw new Error(`KARES ${name} is not configured`)
  return normalizeSuiObjectId(value)
}

const shared = (value: unknown, name: string): KaresPins['pool'] => {
  const pin = value as SharedPin | undefined
  if (!pin || typeof pin.shared_version !== 'string' || !/^[1-9]\d*$/.test(pin.shared_version))
    throw new Error(`KARES ${name} is not configured`)
  return Object.freeze({ id: address(pin.id, name), shared_version: pin.shared_version })
}

export const kares_pins = (pins: Pins): KaresPins =>
  Object.freeze({
    package: address(pins.kares_package, 'package'),
    original: address(pins.kares_package_original, 'original package'),
    currency: shared(pins.kares_currency, 'currency'),
    offering: shared(pins.kares_offering, 'offering'),
    pool: shared(pins.kares_staking_pool, 'staking pool'),
    combat_pot: shared(pins.kares_combat_pot, 'combat pot'),
  })

export const kares_coin_type = (original: unknown): string => `${address(original, 'original package')}::kares::KARES`
export const kares_shared = (tx: Transaction, pin: KaresPins['pool'], mutable = true): TransactionObjectArgument =>
  tx.sharedObjectRef({ objectId: pin.id, initialSharedVersion: pin.shared_version, mutable })
export const kares_clock = (tx: Transaction): TransactionObjectArgument =>
  tx.sharedObjectRef({ objectId: normalizeSuiObjectId('0x6'), initialSharedVersion: '1', mutable: false })

export const positive_kares_amount = (amount: bigint): bigint => {
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error('Amount must be a positive u64')
  return amount
}

/** Official wallet-asset intent supports both Coin objects and address balances before signing. */
export const kares_payment = (
  sdk: Readonly<{ pins: Pins }>,
  tx: Transaction,
  amount: bigint
): TransactionObjectArgument => {
  positive_kares_amount(amount)
  return tx.add(
    coinWithBalance({ type: kares_coin_type(sdk.pins.kares_package_original), balance: amount, useGasCoin: false })
  )
}

/** Composable funding door for admin royalty PTBs and public donations. */
export const fund_kares_reward = (
  tx: Transaction,
  pins: KaresPins,
  asset: 'kares' | 'sui',
  payment: TransactionObjectArgument
): void => {
  tx.moveCall({
    target: `${pins.package}::staking::fund_${asset}`,
    arguments: [kares_shared(tx, pins.pool), payment, kares_clock(tx)],
  })
}

export type OfferingSetup = Readonly<{
  package: string
  genesis: string
  upgrade_cap: string
  currency: string
  minimum: bigint
  maximum: bigint
  duration_ms: bigint
  treasury: string
  liquidity: string
  team: string
  community: string
}>

/** Unsigned fixed-target setup for the publisher; terms are also validated on-chain. */
export const create_kares_setup_transaction = (sdk: Sdk, terms: OfferingSetup): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: '0x2::coin_registry::finalize_registration',
    typeArguments: [`${address(terms.package, 'setup package')}::kares::KARES`],
    arguments: [
      sdk.door_context.obj(tx, normalizeSuiObjectId('0xc'), true),
      sdk.door_context.receiving(tx, terms.currency),
    ],
  })
  tx.moveCall({
    target: `${address(terms.package, 'setup package')}::offering::setup`,
    arguments: [
      sdk.door_context.obj(tx, terms.genesis, true),
      sdk.door_context.obj(tx, terms.upgrade_cap, true),
      ...[terms.minimum, terms.maximum, terms.duration_ms].map((value) => tx.pure.u64(value)),
      ...[terms.treasury, terms.liquidity, terms.team, terms.community].map((value) =>
        tx.pure.address(address(value, 'recipient'))
      ),
    ],
  })
  return tx
}

export const create_kares_start_transaction = (pins: KaresPins): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${pins.package}::offering::start`,
    arguments: [kares_shared(tx, pins.offering), kares_clock(tx)],
  })
  return tx
}

export const create_kares_settlement_transaction = (pins: KaresPins): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${pins.package}::offering::settle`,
    arguments: [kares_shared(tx, pins.offering), kares_shared(tx, pins.pool), kares_clock(tx)],
  })
  return tx
}

export const create_kares_combat_seed_transaction = (pins: KaresPins): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${pins.package}::offering::seed_combat`,
    arguments: [kares_shared(tx, pins.offering), kares_shared(tx, pins.combat_pot)],
  })
  return tx
}

export const create_kares_combat_authorization_transaction = (pins: KaresPins, game_original: unknown): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${pins.package}::offering::authorize_combat`,
    typeArguments: [`${address(game_original, 'original game package')}::fight_rewards::BossVictory`],
    arguments: [kares_shared(tx, pins.offering, false), kares_shared(tx, pins.combat_pot)],
  })
  return tx
}

/** Native authority checks the immutable treasury; the caller receives only unlocked inventory. */
export const create_kares_community_claim_transaction = (pins: KaresPins, treasury: string): Transaction => {
  const tx = new Transaction()
  const [payment] = tx.moveCall({
    target: `${pins.package}::offering::claim_community`,
    arguments: [kares_shared(tx, pins.offering), kares_clock(tx)],
  })
  tx.transferObjects([payment], address(treasury, 'treasury'))
  return tx
}
