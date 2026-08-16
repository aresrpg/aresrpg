// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'

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
