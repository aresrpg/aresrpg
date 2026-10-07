// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { MAINNET_CONTRACT_IDS, TESTNET_CONTRACT_IDS, ZkBag, ZkSendClient } from '@mysten/zksend'

import { GiftError, type GiftStatus } from './gift_contract.ts'
import type { GiftPolicy } from './gift_provenance.ts'

/** Build the one-card transport from public bag state. The QR key never reaches the server. */
export const build_gift_transport = async (
  client: SuiGrpcClient,
  policy: GiftPolicy,
  recipient: string,
  sender: string,
  status: GiftStatus
) => {
  if (status.stage !== 'available' || !status.proof || !policy.giftcards.has(status.proof.giftcard))
    throw new GiftError('ineligible')
  const { assets } = await new ZkSendClient(client).loadLink({ address: sender })
  if (!assets) throw new GiftError('ineligible')
  const [card] = assets.nfts
  if (!card) throw new GiftError('ineligible')
  const valid = [
    assets.nfts.length === 1,
    assets.coins.length === 0,
    card.objectId === status.proof.giftcard,
    normalizeStructTag(card.type) === normalizeStructTag(`${policy.game_type}::distribution::Giftcard`),
  ].every(Boolean)
  if (!valid) throw new GiftError('ineligible')
  const contract = client.network === 'mainnet' ? MAINNET_CONTRACT_IDS : TESTNET_CONTRACT_IDS
  const tx = new Transaction()
  tx.setSender(sender)
  const zk_bag = new ZkBag(contract.packageId, contract)
  const [bag, claim] = tx.add(zk_bag.init_claim({ arguments: [contract.bagStoreId] }))
  const voucher = tx.add(
    zk_bag.claim({
      typeArguments: [card.type],
      arguments: [bag, claim, tx.receivingRef(card)],
    })
  )
  tx.transferObjects([voucher], recipient)
  tx.add(zk_bag.finalize({ arguments: [bag, claim] }))
  return { tx, kind: await tx.build({ client, onlyTransactionKind: true }) }
}
