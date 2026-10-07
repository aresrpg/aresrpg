// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'
import { isValidTransactionDigest, toBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import type { Sdk } from './client.ts'
import { SDK, living_content } from './client.ts'
import { read_sponsored_transaction } from './sponsored_execution.ts'
import { item_template_id } from './seed_ids.ts'
import { receipt_digest } from './cache.ts'
import {
  GIFT_API_PATH,
  GiftError,
  decode_gift_status,
  gift_request_message,
  type GiftAction,
  type GiftProof,
  type GiftRequest,
  type GiftStatus,
  type SponsoredGift,
} from './gift_contract.ts'
import { validate_gift_transaction } from './gift_provenance.ts'

type SignMessage = (message: Uint8Array) => Promise<Readonly<{ signature: string }>>

const post_gift = async (body: object, signal?: AbortSignal): Promise<Record<string, unknown>> => {
  const result = await fetch(GIFT_API_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(25_000),
  })
  const value = (await result.json()) as Record<string, unknown>
  if (!result.ok) {
    if (['invalid', 'ineligible', 'unavailable', 'unauthorized', 'sponsor_unavailable'].includes(String(value.error)))
      throw new GiftError(value.error as GiftError['code'])
    throw new GiftError('unavailable')
  }
  return value
}

const sponsored_gift = (proof: GiftProof, result: Record<string, unknown>): SponsoredGift => {
  if (
    typeof result.bytes !== 'string' ||
    typeof result.digest !== 'string' ||
    !isValidTransactionDigest(result.digest) ||
    typeof result.sponsor_signature !== 'string'
  )
    throw new GiftError('invalid')
  const status = decode_gift_status(result.status)
  if (status.proof?.giftcard !== proof.giftcard) throw new GiftError('invalid')
  return { bytes: result.bytes, digest: result.digest, sponsor_signature: result.sponsor_signature, status }
}

export const create_gift_actions = (sdk: Sdk, address: string, sign: SignMessage) => {
  const request = async (action: GiftRequest['action'], proof: GiftProof | null, sender?: string) => {
    const intent: GiftRequest = {
      action,
      proof,
      address,
      network: sdk.network,
      time: Date.now(),
      ...(sender ? { sender } : {}),
    }
    if (action === 'status') return post_gift({ request: intent })
    const { signature } = await sign(gift_request_message(intent))
    return post_gift({ request: intent, signature })
  }
  const prepare = async (action: GiftAction, proof: GiftProof): Promise<SponsoredGift> => {
    const { bytes, digest, sponsor_signature, status } = sponsored_gift(proof, await request(action, proof))
    const { content_root, seed_package_original } = living_content(sdk, 'Gift sponsorship')
    // Before asking the wallet to sign, independently restrict the returned PTB to gift doors.
    validate_gift_transaction(
      {
        pins: sdk.pins,
        game_type: sdk.game_type_package!,
        box_template: item_template_id(content_root, seed_package_original, 'sui_crate'),
        giftcards: new Set([proof.giftcard]),
        reward_templates: new Set(),
      },
      action,
      Transaction.from(bytes).getData(),
      status
    )
    return { bytes, digest, sponsor_signature, status }
  }
  return Object.freeze({
    status: async (proof: GiftProof | null): Promise<GiftStatus> => decode_gift_status(await request('status', proof)),
    execute: async (action: GiftAction, proof: GiftProof): Promise<Readonly<{ digest: string }>> => {
      const receipt = await sdk.execute_sponsored(() => prepare(action, proof))
      return { digest: receipt_digest(receipt) }
    },
    transfer: async (url: string, proof: GiftProof): Promise<Readonly<{ digest: string }>> => {
      const { load_giftcard_link } = await import('./distribution.ts')
      const loaded = await load_giftcard_link(sdk.sui_client as unknown as SuiGrpcClient, sdk, url)
      if (!loaded?.link.keypair || loaded.giftcard.id !== proof.giftcard) throw new GiftError('ineligible')
      const { link } = loaded
      const tx = link.createClaimTransaction(address)
      const kind = await tx.build({ client: sdk.sui_client as never, onlyTransactionKind: true })
      const transport = SDK({ client: sdk.sui_client, network: sdk.network, pins: sdk.pins, signer: link.keypair })
      const receipt = await transport.execute_sponsored(async () => {
        const prepared = sponsored_gift(proof, await request('transfer', proof, link.address))
        const { transaction } = read_sponsored_transaction(prepared, link.address, address)
        const returned_kind = await transaction.build({ onlyTransactionKind: true })
        if (toBase64(returned_kind) !== toBase64(kind)) throw new GiftError('invalid')
        return prepared
      })
      return { digest: receipt_digest(receipt) }
    },
    recover: sdk.recover_pending_transaction,
  })
}

export type GiftActions = ReturnType<typeof create_gift_actions>
