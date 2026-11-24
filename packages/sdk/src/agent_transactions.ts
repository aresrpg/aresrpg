// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'

import type { ReturnEquipment } from './agent_returns.ts'
import type { EquipChange } from './character_actions.ts'
import type { Sdk, TransactionSigner } from './client.ts'
import type { create_agent_identity } from './agent_multisig.ts'
import { claim_purchase_cap, offer_purchase_cap } from './marketplace.ts'

type AgentIdentity = ReturnType<typeof create_agent_identity>

/** Inject an authorized ordinary-member signer. No key creation, storage, RPC or submission.
 * The caller resolves the complete transaction before invoking this SDK-compatible signer. */
const create_member_transaction_signer =
  (
    identity: AgentIdentity,
    sign_bytes: (
      bytes: Uint8Array,
      before_sign?: () => void
    ) => Promise<Readonly<{ bytes: string; signature: string }>>,
    member_index: 0 | 1,
    verification: Parameters<typeof verifyTransactionSignature>[2] = {}
  ): TransactionSigner =>
  async (transaction, before_sign) => {
    const snapshot = Transaction.from(transaction)
    if (snapshot.getData().sender !== identity.address) throw new Error('Agent transaction sender mismatch.')
    const bytes = await snapshot.build()
    before_sign?.()
    const proof = await sign_bytes(bytes.slice(), before_sign)
    if (toBase64(fromBase64(proof.bytes)) !== toBase64(bytes))
      throw new Error('Agent signer changed transaction bytes.')
    const member = identity.public_key.getPublicKeys()[member_index]!.publicKey
    const verified = await verifyTransactionSignature(bytes, proof.signature, verification)
    if (toBase64(verified.toRawBytes()) !== toBase64(member.toRawBytes()))
      throw new Error('Transaction signature belongs to another member.')
    return { bytes: toBase64(bytes), signature: identity.public_key.combinePartialSignatures([proof.signature]) }
  }

export const create_agent_transaction_signer = (
  identity: AgentIdentity,
  sign_bytes: Parameters<typeof create_member_transaction_signer>[1]
): TransactionSigner => create_member_transaction_signer(identity, sign_bytes, 0)

/** Google recovery uses the existing wallet proof and explicit network verification client.
 * It never asks the agent to co-sign. The wallet must support signing the multisig sender. */
export const create_google_transaction_signer = (
  identity: AgentIdentity,
  sign_bytes: Parameters<typeof create_member_transaction_signer>[1],
  client: NonNullable<Parameters<typeof verifyTransactionSignature>[2]>['client']
): TransactionSigner => {
  if (!client) throw new Error('Google signature verification needs an explicit network client.')
  return create_member_transaction_signer(identity, sign_bytes, 1, { client })
}

/** Two explicit transactions, reused in either direction: offer, then claim.
 * A zero price does not waive policy royalties or gas. No builder signs or executes. */
export const agent_character_transfer = (sdk: Sdk) =>
  Object.freeze({
    offer: (
      input: Readonly<{
        sender: string
        recipient: string
        character_id: string
        kiosk_cap: KioskOwnerCap
        unequip?: readonly EquipChange[]
      }>
    ) => {
      if (input.sender === input.recipient) throw new Error('Transfer needs a different recipient.')
      const tx = sdk.tx()
      tx.setSender(input.sender)
      sdk.with_personal_kiosk(tx, input.kiosk_cap, (kiosk, cap) => {
        tx.transferObjects(offer_character_caps(sdk, tx, kiosk, cap, input), input.recipient)
      })
      return tx
    },
    claim: (
      input: Readonly<{
        recipient: string
        character_id: string
        seller_kiosk: string
        purchase_cap: string
        kiosk_cap: KioskOwnerCap | null
        equipment?: readonly ReturnEquipment[]
      }>
    ) => {
      const tx = sdk.tx()
      tx.setSender(input.recipient)
      sdk.with_personal_kiosk(tx, input.kiosk_cap, (kiosk, cap) => {
        claim_character_caps(sdk, tx, kiosk, cap, input)
      })
      return tx
    },
  })

export const offer_character_caps = (
  sdk: Sdk,
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  cap: TransactionObjectArgument,
  input: Readonly<{ character_id: string; unequip?: readonly EquipChange[] }>
) => {
  for (const { slot, item_id } of input.unequip ?? [])
    sdk.doors.unequip_item(tx, { kiosk, cap, character_id: input.character_id, slot, receiving: item_id })
  return [
    offer_purchase_cap(sdk, tx, 'character', kiosk, cap, input.character_id),
    ...(input.unequip ?? []).map(({ item_id }) => offer_purchase_cap(sdk, tx, 'item', kiosk, cap, item_id)),
  ]
}

export const claim_character_caps = (
  sdk: Sdk,
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  cap: TransactionObjectArgument,
  input: Readonly<{
    character_id: string
    seller_kiosk: string
    purchase_cap: string
    equipment?: readonly ReturnEquipment[]
  }>
) => {
  const { seller_kiosk } = input
  claim_purchase_cap(sdk, tx, 'character', { ...input, asset_id: input.character_id }, kiosk, cap)
  for (const { slot, item_id, purchase_cap } of input.equipment ?? []) {
    claim_purchase_cap(sdk, tx, 'item', { asset_id: item_id, seller_kiosk, purchase_cap }, kiosk, cap)
    sdk.doors.equip_item(tx, { kiosk, cap, character_id: input.character_id, slot, item_id })
  }
}
