// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'
import { isValidTransactionDigest } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { living_content } from './client.ts'
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

export const create_gift_actions = (sdk: Sdk, address: string, sign: SignMessage) => {
  const request = async (action: GiftRequest['action'], proof: GiftProof | null) => {
    const intent: GiftRequest = { action, proof, address, network: sdk.network, time: Date.now() }
    const { signature } = await sign(gift_request_message(intent))
    return post_gift({ request: intent, signature })
  }
  const prepare = async (action: GiftAction, proof: GiftProof): Promise<SponsoredGift> => {
    const result = await request(action, proof)
    if (
      typeof result.bytes !== 'string' ||
      typeof result.digest !== 'string' ||
      !isValidTransactionDigest(result.digest)
    )
      throw new GiftError('invalid')
    const status = decode_gift_status(result.status)
    if (status.proof?.giftcard !== proof.giftcard) throw new GiftError('invalid')
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
      Transaction.from(result.bytes).getData(),
      status
    )
    return { bytes: result.bytes, digest: result.digest, status }
  }
  return Object.freeze({
    status: async (proof: GiftProof | null): Promise<GiftStatus> => decode_gift_status(await request('status', proof)),
    execute: async (action: GiftAction, proof: GiftProof): Promise<Readonly<{ digest: string }>> => {
      const receipt = await sdk.execute_sponsored(
        () => prepare(action, proof),
        async (digest, signature, signal) => {
          const result = await post_gift({ digest, signature }, signal)
          if (result.digest !== digest) throw new GiftError('unavailable')
        }
      )
      return { digest: receipt_digest(receipt) }
    },
    recover: sdk.recover_pending_transaction,
  })
}

export type GiftActions = ReturnType<typeof create_gift_actions>
