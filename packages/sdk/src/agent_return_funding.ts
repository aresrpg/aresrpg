// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, SUI_TYPE_ARG } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { gas_mist_from_receipt, simulation_gas_budget } from './gas.ts'
import { receipt_digest } from './cache.ts'
import { sui_transfer_ptb } from './sui_transfer.ts'
import { transaction_resolution_error } from './transaction_error.ts'

export type ReturnFeeQuote = Readonly<{ budget_mist: bigint; cost_mist: bigint; required_mist: bigint }>
export class AgentReturnFundingRequired extends Error {
  readonly cost_mist: bigint
  constructor(cost_mist: bigint) {
    super('More SUI is needed to finish returning assets. The bot remains stopped.')
    // eslint-disable-next-line functional/no-this-expressions -- Error metadata supplies the existing owner funding modal's target.
    this.cost_mist = cost_mist
  }
}

/** Checks stay enabled. Mock gas only lets an unfunded sender obtain a non-signing quote. */
export const quote_return_transaction = async (
  client: SuiGrpcClient,
  sender: string,
  transaction: Transaction,
  sweep = false
): Promise<ReturnFeeQuote> => {
  const quote = Transaction.from(transaction)
  quote.setSenderIfNotSet(sender)
  if (quote.getData().sender !== sender) throw new Error('Return transaction sender mismatch.')
  const [result, price] = await Promise.all([
    client.core.simulateTransaction({
      transaction: quote,
      doGasSelection: false,
      checksEnabled: true,
      include: { effects: true, balanceChanges: true },
    }),
    client.core.getReferenceGasPrice(),
  ])
  const receipt = result.Transaction
  if (!receipt?.status.success) throw transaction_resolution_error(receipt?.status.error ?? 'Return simulation failed.')
  const gas_receipt = { effects: { gasUsed: receipt.effects.gasUsed } }
  const gas = gas_mist_from_receipt(gas_receipt)
  if (gas === null) throw new Error('Return simulation has no gas estimate.')
  const balance_change = receipt.balanceChanges
    .filter(
      (change) => change.address === sender && normalizeStructTag(change.coinType) === normalizeStructTag(SUI_TYPE_ARG)
    )
    .reduce((total, change) => total + BigInt(change.amount), 0n)
  const spending = sweep ? 0n : -balance_change - gas
  const extra = spending > 0n ? spending : 0n
  const budget_mist = simulation_gas_budget(gas_receipt, BigInt(price.referenceGasPrice))
  return { budget_mist, cost_mist: gas + extra, required_mist: budget_mist + extra }
}

/** Either signer funds the other with an ordinary owner-approved SUI transfer; no sponsorship is assumed. */
export const return_funding = (
  context: Readonly<{
    client: SuiGrpcClient
    sdk: Sdk
    owner_sdk: Sdk
    owner: string
    agent: string
    before_sign: () => void
    guard: () => Promise<void>
  }>
) => {
  const balance = async (owner: string) => BigInt((await context.client.core.getBalance({ owner })).balance.balance)
  const ensure = async (sender: string, quote: ReturnFeeQuote): Promise<void> => {
    const available = await balance(sender)
    if (available >= quote.required_mist) return
    if (![context.owner, context.agent].includes(sender)) throw new Error('Return payer mismatch.')
    const source =
      sender === context.owner
        ? { address: context.agent, sdk: context.sdk }
        : { address: context.owner, sdk: context.owner_sdk }
    const transaction = sui_transfer_ptb({
      sender: source.address,
      recipient: sender,
      amount_mist: quote.required_mist - available,
    })
    const top_up = await quote_return_transaction(context.client, source.address, transaction)
    if ((await balance(source.address)) < top_up.required_mist)
      throw new AgentReturnFundingRequired(sender === context.owner ? quote.required_mist : top_up.required_mist)
    await context.guard()
    context.before_sign()
    const receipt = await source.sdk.execute(transaction, {
      budget: top_up.budget_mist,
      before_sign: context.before_sign,
    })
    await context.client.core.waitForTransaction({ digest: receipt_digest(receipt) })
  }
  const funded = (sdk: Sdk, sender: string): Sdk => ({
    ...sdk,
    execute: async (transaction, options = {}) => {
      const quote = await quote_return_transaction(context.client, sender, transaction)
      await ensure(sender, quote)
      await context.guard()
      context.before_sign()
      return sdk.execute(transaction, {
        ...options,
        budget: quote.budget_mist,
        before_sign: () => {
          context.before_sign()
          options.before_sign?.()
        },
      })
    },
  })
  return { balance, ensure, funded }
}
