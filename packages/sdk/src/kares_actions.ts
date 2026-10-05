// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { normalizeSuiObjectId } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { receipt_digest, type Receipt } from './cache.ts'
import {
  fund_kares_reward,
  kares_clock,
  kares_payment,
  kares_pins,
  kares_shared,
  positive_kares_amount,
  create_kares_community_claim_transaction,
} from './kares_ptb.ts'
import { create_kares_snapshot_reader, type KaresSnapshot, type KaresStakingSnapshot } from './kares_snapshot.ts'
import { plan_staking_withdrawal, assert_staking_batch, type StakeWithdrawal } from './kares_staking.ts'

export type KaresIntent =
  | Readonly<{ kind: 'stake'; amount: bigint; position?: string }>
  | Readonly<{ kind: 'fund_combat'; amount: bigint }>
  | Readonly<{ kind: 'claim'; ids: readonly string[] }>
  | Readonly<{ kind: 'fund'; asset: 'kares' | 'sui'; amount: bigint }>
  | Readonly<{ kind: 'withdraw'; withdrawals: readonly StakeWithdrawal[] }>

export type KaresOutcome = Readonly<{ digest: string; receipt: Receipt }>
export type KaresActions = Readonly<{
  snapshot: () => Promise<KaresSnapshot>
  staking_snapshot: () => Promise<KaresStakingSnapshot>
  stake: (amount: bigint) => Promise<KaresOutcome>
  withdraw: (positions: readonly StakeWithdrawal[], amount: bigint) => Promise<KaresOutcome>
  claim_rewards: (ids: readonly string[]) => Promise<KaresOutcome>
  claim_community: () => Promise<KaresOutcome>
  fund_kares: (amount: bigint) => Promise<KaresOutcome>
  fund_sui: (amount: bigint) => Promise<KaresOutcome>
  fund_combat: (amount: bigint) => Promise<KaresOutcome>
}>

type FinanceContext = Readonly<{ sdk: Sdk; client: SuiGrpcClient; address: string }>

/** Every caller validates a nonempty batch. Consolidate payouts before transferring custody. */
const merge_payments = (tx: Transaction, payments: readonly TransactionObjectArgument[]): TransactionObjectArgument => {
  const [first, ...rest] = payments
  if (rest.length) tx.mergeCoins(first!, rest)
  return first!
}

/** The same unsigned composition is used by browser actions and the testnet rehearsal. */
export const create_kares_transaction = async (
  { sdk, address }: Omit<FinanceContext, 'client'>,
  intent: KaresIntent
): Promise<Transaction> => {
  const pins = kares_pins(sdk.pins)
  const tx = new Transaction()
  const object = (id: string) => sdk.door_context.obj(tx, id, true)
  switch (intent.kind) {
    case 'fund_combat': {
      const payment = kares_payment(sdk, tx, intent.amount)
      tx.moveCall({
        target: `${pins.package}::combat_rewards::fund`,
        typeArguments: [pins.coin_type],
        arguments: [kares_shared(tx, pins.combat_pot), payment],
      })
      break
    }
    case 'claim': {
      const ids = [...new Set(intent.ids.map((id) => normalizeSuiObjectId(id)))]
      assert_staking_batch(ids.length)
      await sdk.hydrate_unknown(ids)
      const payments = ids.map((id) => {
        const [kares, sui] = tx.moveCall({
          target: `${pins.package}::staking::claim`,
          typeArguments: [pins.coin_type],
          arguments: [kares_shared(tx, pins.pool), object(id), kares_clock(tx)],
        })
        return { kares, sui }
      })
      tx.transferObjects(
        [
          merge_payments(
            tx,
            payments.map(({ kares }) => kares)
          ),
          merge_payments(
            tx,
            payments.map(({ sui }) => sui)
          ),
        ],
        address
      )
      break
    }
    case 'stake': {
      const [method, position_ids] =
        intent.position === undefined ? (['open_position', []] as const) : (['add_stake', [intent.position]] as const)
      await sdk.hydrate_unknown(position_ids)
      const payment = kares_payment(sdk, tx, intent.amount)
      tx.moveCall({
        target: `${pins.package}::staking::${method}`,
        typeArguments: [pins.coin_type],
        arguments: [kares_shared(tx, pins.pool), ...position_ids.map(object), payment, kares_clock(tx)],
      })
      break
    }
    case 'withdraw': {
      assert_staking_batch(intent.withdrawals.length)
      positive_kares_amount(intent.withdrawals.reduce((total, row) => total + row.amount, 0n))
      await sdk.hydrate_unknown(intent.withdrawals.map(({ id }) => id))
      const payments = intent.withdrawals.map((withdrawal) => {
        const [payment] = tx.moveCall({
          target: `${pins.package}::staking::withdraw`,
          typeArguments: [pins.coin_type],
          arguments: [
            kares_shared(tx, pins.pool),
            object(withdrawal.id),
            tx.pure.u64(positive_kares_amount(withdrawal.amount)),
            kares_clock(tx),
          ],
        })
        return payment
      })
      tx.transferObjects([merge_payments(tx, payments)], address)
      break
    }
    case 'fund': {
      const payment =
        intent.asset === 'kares'
          ? kares_payment(sdk, tx, intent.amount)
          : tx.splitCoins(tx.gas, [tx.pure.u64(positive_kares_amount(intent.amount))])[0]
      fund_kares_reward(tx, pins, intent.asset, payment)
      break
    }
  }
  return tx
}

export const kares_actions = (context: FinanceContext): KaresActions => {
  const reader = create_kares_snapshot_reader(context.client, context.sdk.pins, context.sdk.network, context.sdk.cache)
  const execute_transaction = async (tx: Transaction): Promise<KaresOutcome> => {
    const receipt = await context.sdk.execute(tx, {
      include: { objectTypes: true },
      budget: 'estimate',
    })
    reader.observe_receipt(receipt)
    return Object.freeze({ digest: receipt_digest(receipt), receipt })
  }
  const execute = async (intent: KaresIntent): Promise<KaresOutcome> =>
    execute_transaction(await create_kares_transaction(context, intent))
  return Object.freeze({
    snapshot: () => reader.snapshot(context.address),
    staking_snapshot: () => reader.staking_snapshot(context.address),
    stake: async (amount) => {
      const { positions } = await reader.staking_snapshot(context.address)
      return execute({ kind: 'stake', amount, position: positions[0]?.id })
    },
    withdraw: (positions, amount) =>
      execute({ kind: 'withdraw', withdrawals: plan_staking_withdrawal(positions, amount) }),
    claim_rewards: (ids) => execute({ kind: 'claim', ids }),
    claim_community: () =>
      execute_transaction(create_kares_community_claim_transaction(kares_pins(context.sdk.pins), context.address)),
    fund_kares: (amount) => execute({ kind: 'fund', asset: 'kares', amount }),
    fund_sui: (amount) => execute({ kind: 'fund', asset: 'sui', amount }),
    fund_combat: (amount) => execute({ kind: 'fund_combat', amount }),
  })
}
