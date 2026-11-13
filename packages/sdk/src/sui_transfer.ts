// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { receipt_digest } from './cache.ts'

export const sui_transfer_ptb = ({
  sender,
  recipient,
  amount_mist,
}: Readonly<{
  sender: string
  recipient: string
  amount_mist: bigint | null
}>): Transaction => {
  const transaction = new Transaction()
  transaction.setSender(normalizeSuiAddress(sender))
  const normalized_recipient = normalizeSuiAddress(recipient)
  if (amount_mist === null) transaction.transferObjects([transaction.gas], normalized_recipient)
  else {
    if (amount_mist <= 0n) throw new Error('The SUI amount must be positive')
    const [coin] = transaction.splitCoins(transaction.gas, [amount_mist])
    transaction.transferObjects([coin], normalized_recipient)
  }
  return transaction
}

/** Player and owner-authorized multisig transfers share composition, estimation and execution. */
export const sui_transfer_actions = (
  sdk: Pick<Sdk, 'simulate' | 'execute'>,
  sender: string,
  before_sign?: () => void
) => {
  const compose = (recipient: string, amount_mist: bigint, drain: boolean) => {
    before_sign?.()
    if (!isValidSuiAddress(recipient)) throw new Error('Enter a valid Sui address')
    if (amount_mist <= 0n) throw new Error('The SUI amount must be positive')
    return sui_transfer_ptb({ sender, recipient, amount_mist: drain ? null : amount_mist })
  }
  return {
    estimate_sui_transfer: async (recipient: string, amount_mist: bigint, drain: boolean) => {
      const simulation = await sdk.simulate(compose(recipient, amount_mist, drain))
      if (simulation.$kind === 'FailedTransaction') throw new Error('The transfer cannot be built')
      const estimate = gas_mist_from_receipt(simulation)
      if (estimate === null) throw new Error('The simulation carried no gas figures — cannot estimate the transfer')
      return estimate
    },
    send_sui: async (recipient: string, amount_mist: bigint, drain: boolean, current?: () => void) => {
      const receipt = await sdk.execute(compose(recipient, amount_mist, drain), {
        before_sign: () => {
          before_sign?.()
          current?.()
        },
      })
      if (receipt.$kind === 'FailedTransaction') throw new Error('The SUI transfer failed on-chain')
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
  }
}
