// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiGraphQLClient } from '@mysten/sui/graphql'
import type { Transaction } from '@mysten/sui/transactions'

import type { Sdk } from './client.ts'
import { receipt_digest, type Receipt } from './cache.ts'
import { GiftError, type GiftAction, type GiftProof, type GiftStatus } from './gift_contract.ts'
import { gift_redemption, gift_opening, gift_collection, type GiftPolicy, type GiftReceipt } from './gift_provenance.ts'
import { build_gift_transaction, create_gift_reader } from './gift_chain.ts'

const GIFT_EXECUTION_INCLUDE = { effects: true, events: true, objectTypes: true } as const

/** The signed bytes and their certified receipt prove the next stage; nothing rereads the chain. */
const advance_gift = (
  policy: GiftPolicy,
  address: string,
  action: GiftAction,
  status: GiftStatus,
  transaction: ReturnType<Transaction['getData']>,
  receipt: Receipt
): GiftStatus => {
  if (!receipt.Transaction || !status.proof) throw new GiftError('unavailable')
  const certified = { ...receipt, Transaction: { ...receipt.Transaction, transaction } } as unknown as GiftReceipt
  const prior = { ...status, proof: { ...status.proof, [action]: receipt_digest(receipt) } }
  if (action === 'redeem') return gift_redemption(policy, address, prior.proof, certified)
  return action === 'open'
    ? gift_opening(policy, address, prior, certified)
    : gift_collection(policy, address, prior, certified)
}

/** The player's own wallet pays redemption, opening and collection. The bearer QR moves the voucher
 * through the same zkSend claim as every other gift link. */
export const create_gift_actions =
  (sdk: Sdk, address: string, client: SuiGrpcClient, graphql: SuiGraphQLClient) => (policy: GiftPolicy) =>
    Object.freeze({
      status: create_gift_reader(client, graphql, policy, address),
      execute: async (action: GiftAction, status: GiftStatus): Promise<GiftStatus> => {
        const tx = await build_gift_transaction(sdk, policy, address, action, status)
        const receipt = await sdk.execute(tx, { include: GIFT_EXECUTION_INCLUDE })
        return advance_gift(policy, address, action, status, tx.getData(), receipt)
      },
      transfer: async (url: string, proof: GiftProof): Promise<GiftStatus> => {
        const { claim_giftcard_link } = await import('./distribution.ts')
        const claimed = await claim_giftcard_link(client, sdk, url, address)
        if (claimed?.giftcard.id !== proof.giftcard) throw new GiftError('ineligible')
        return { stage: 'voucher', proof }
      },
      recover: sdk.recover_pending_transaction,
    })

export type GiftActions = ReturnType<ReturnType<typeof create_gift_actions>>
