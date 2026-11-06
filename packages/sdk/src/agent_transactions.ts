// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'

import type { ReturnEquipment } from './agent_returns.ts'
import type { EquipChange } from './character_actions.ts'
import type { Sdk, TransactionSigner } from './client.ts'
import type { create_agent_identity } from './agent_multisig.ts'
import { resolve_marketplace_transfer } from './marketplace.ts'

type AgentIdentity = ReturnType<typeof create_agent_identity>

/** Inject an authorized ordinary-member signer. No key creation, storage, RPC or submission.
 * The caller resolves the complete transaction before invoking this SDK-compatible signer. */
const create_member_transaction_signer =
  (
    identity: AgentIdentity,
    sign_bytes: (bytes: Uint8Array) => Promise<Readonly<{ bytes: string; signature: string }>>,
    member_index: 0 | 1,
    verification: Parameters<typeof verifyTransactionSignature>[2] = {}
  ): TransactionSigner =>
  async (transaction) => {
    const snapshot = Transaction.from(transaction)
    if (snapshot.getData().sender !== identity.address) throw new Error('Agent transaction sender mismatch.')
    const bytes = await snapshot.build()
    const proof = await sign_bytes(bytes.slice())
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
export const agent_character_transfer = (sdk: Sdk) => {
  const type = `${sdk.game_type_package}::character::Character`
  const item_type = `${sdk.game_type_package}::item::Item`
  return Object.freeze({
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
        for (const { slot, item_id } of input.unequip ?? [])
          sdk.doors.unequip_item(tx, { kiosk, cap, character_id: input.character_id, slot, receiving: item_id })
        const purchase_cap = tx.moveCall({
          target: '0x2::kiosk::list_with_purchase_cap',
          typeArguments: [type],
          arguments: [kiosk, cap, tx.pure.id(input.character_id), tx.pure.u64(0)],
        })
        const gear = (input.unequip ?? []).map(({ item_id }) =>
          tx.moveCall({
            target: '0x2::kiosk::list_with_purchase_cap',
            typeArguments: [item_type],
            arguments: [kiosk, cap, tx.pure.id(item_id), tx.pure.u64(0)],
          })
        )
        tx.transferObjects([purchase_cap, ...gear], input.recipient)
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
        const zero = tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
        const [character, request] = tx.moveCall({
          target: '0x2::kiosk::purchase_with_cap',
          typeArguments: [type],
          arguments: [tx.object(input.seller_kiosk), tx.object(input.purchase_cap), zero],
        })
        resolve_marketplace_transfer(
          sdk,
          tx,
          'character',
          input.character_id,
          0n,
          kiosk,
          cap,
          character!,
          request!,
          input.seller_kiosk
        )
        for (const { slot, item_id, purchase_cap } of input.equipment ?? []) {
          const payment = tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
          const [item, item_request] = tx.moveCall({
            target: '0x2::kiosk::purchase_with_cap',
            typeArguments: [item_type],
            arguments: [tx.object(input.seller_kiosk), tx.object(purchase_cap), payment],
          })
          resolve_marketplace_transfer(
            sdk,
            tx,
            'item',
            item_id,
            0n,
            kiosk,
            cap,
            item!,
            item_request!,
            input.seller_kiosk
          )
          sdk.doors.equip_item(tx, { kiosk, cap, character_id: input.character_id, slot, item_id })
        }
      })
      return tx
    },
    cancel: (
      input: Readonly<{
        holder: string
        seller_kiosk: string
        purchase_cap: string
        equipment?: readonly ReturnEquipment[]
      }>
    ) => {
      const tx = sdk.tx()
      tx.setSender(input.holder)
      tx.moveCall({
        target: '0x2::kiosk::return_purchase_cap',
        typeArguments: [type],
        arguments: [tx.object(input.seller_kiosk), tx.object(input.purchase_cap)],
      })
      for (const { purchase_cap } of input.equipment ?? [])
        tx.moveCall({
          target: '0x2::kiosk::return_purchase_cap',
          typeArguments: [item_type],
          arguments: [tx.object(input.seller_kiosk), tx.object(purchase_cap)],
        })
      return tx
    },
  })
}
