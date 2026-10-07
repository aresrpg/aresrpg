// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

import type { Receipt } from './cache.ts'
import type { TransactionSigner } from './client.ts'
import type { create_transaction_execution } from './transaction_execution.ts'
import { GIFT_GAS_LIMIT_MIST } from './gift_contract.ts'

export type SponsoredPreparation = Readonly<{ bytes: string; digest: string }>
export type SponsorSubmit = (digest: string, signature: string, signal?: AbortSignal) => Promise<void>

export const read_sponsored_transaction = (prepared: SponsoredPreparation, address: string) => {
  const raw = fromBase64(prepared.bytes)
  const transaction = Transaction.from(raw)
  const data = transaction.getData()
  const budget = BigInt(data.gasData.budget ?? 0)
  const valid = [
    data.sender === address,
    typeof data.gasData.owner === 'string',
    data.gasData.owner !== address,
    budget > 0n,
    budget <= GIFT_GAS_LIMIT_MIST,
    TransactionDataBuilder.getDigestFromBytes(raw) === prepared.digest,
  ].every(Boolean)
  if (!valid) throw new Error('Invalid sponsored transaction')
  return { raw, transaction }
}

const require_success = (receipt: Receipt, message: string): void => {
  if (!receipt.Transaction?.effects?.status?.success) throw new Error(message)
}

/** Sponsored gas changes transport, never the SDK's single-submit, receipt or recovery owner. */
export const create_sponsored_execution =
  ({
    address,
    sign,
    execution,
    simulate,
    receipt,
  }: Readonly<{
    address: string | null
    sign?: TransactionSigner
    execution: ReturnType<typeof create_transaction_execution>
    simulate: (bytes: Uint8Array) => Promise<Receipt>
    receipt: (digest: string, signal?: AbortSignal) => Promise<Receipt>
  }>) =>
  async (prepare: () => Promise<SponsoredPreparation>, submit: SponsorSubmit, gas_scope?: string): Promise<Receipt> => {
    await execution.before_next()
    if (!address || !sign) throw new Error('Sponsored execution needs a wallet')
    const prepared = await prepare()
    const { raw, transaction } = read_sponsored_transaction(prepared, address)
    require_success(await simulate(raw), 'Sponsored transaction simulation failed')
    const signed = await sign(transaction)
    const signed_bytes = typeof signed.bytes === 'string' ? fromBase64(signed.bytes) : signed.bytes
    if (TransactionDataBuilder.getDigestFromBytes(signed_bytes) !== prepared.digest)
      throw new Error('The wallet changed the sponsored transaction')
    const result = await execution.submit(
      raw,
      signed.signature,
      {
        include: { objectTypes: true },
        gas_payer: transaction.getData().gasData.owner!,
        gas_scope,
      },
      async ({ signal }) => {
        await submit(prepared.digest, signed.signature, signal)
        return receipt(prepared.digest, signal)
      }
    )
    require_success(result, `Sponsored transaction ${prepared.digest} failed on-chain`)
    return result
  }
