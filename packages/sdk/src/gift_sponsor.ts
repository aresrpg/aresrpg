// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ObjectError, TransactionError, type SuiClientTypes } from '@mysten/sui/client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiGraphQLClient } from '@mysten/sui/graphql'
import { normalizeStructTag } from '@mysten/sui/utils'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'

import type { Sdk } from './client.ts'
import { GiftError, type GiftAction, type GiftProof, type GiftStatus } from './gift_contract.ts'
import {
  GIFT_RECEIPT_INCLUDE,
  gift_redemption,
  gift_opening,
  gift_collection,
  validate_gift_transaction,
  verified_gift_package,
  type GiftPolicy,
  type GiftReceipt,
} from './gift_provenance.ts'
import { read_gift_history, redemption_hint, box_hints, type GiftHistory } from './gift_recovery.ts'

type GiftObject = SuiClientTypes.Object<{ json: true }>

export const validate_gift_voucher = (policy: GiftPolicy, object: GiftObject): void => {
  if (
    !policy.giftcards.has(object.objectId) ||
    normalizeStructTag(object.type) !== normalizeStructTag(`${policy.game_type}::distribution::Giftcard`) ||
    object.json?.template !== policy.box_template ||
    object.json.amount !== 1
  )
    throw new GiftError('ineligible')
}

const read_object = async (client: SuiGrpcClient, id: string): Promise<GiftObject | null> => {
  try {
    return (await client.core.getObject({ objectId: id, include: { json: true } })).object
  } catch (error) {
    if (error instanceof ObjectError && error.reason === 'notFound') return null
    throw error
  }
}

export const create_gift_reader = (
  client: SuiGrpcClient,
  graphql: SuiGraphQLClient,
  policy: GiftPolicy,
  address: string
) => {
  let history: Promise<GiftHistory> | null = null
  const historical = (): Promise<GiftHistory> => (history ??= read_gift_history(graphql, policy, address))
  const receipt = async (digest: string): Promise<GiftReceipt> => {
    try {
      return await client.core.getTransaction({ digest, include: GIFT_RECEIPT_INCLUDE })
    } catch (error) {
      if (!(error instanceof TransactionError) || error.reason !== 'notFound') throw error
      // Only historical, shape-checked single-gift PTBs use the archive. Their fixed scaffold
      // emits fewer than 50 events; this is never an execution-receipt fallback.
      return graphql.core.getTransaction({ digest, include: GIFT_RECEIPT_INCLUDE })
    }
  }
  const receipt_policy = async (receipt: GiftReceipt): Promise<GiftPolicy> => {
    if (!receipt.Transaction) throw new GiftError('ineligible')
    const data = Transaction.from(JSON.stringify(receipt.Transaction.transaction)).getData()
    const call = data.commands.find((command) => command.MoveCall?.module === 'api')?.MoveCall
    if (!call) throw new GiftError('ineligible')
    if (call.package === policy.pins.package) return policy
    const { response } = await client.movePackageService.getPackage({ packageId: call.package })
    if (response.package?.storageId !== call.package) throw new GiftError('ineligible')
    return verified_gift_package(policy, call.package, response.package.originalId ?? '')
  }
  const redemption = async (proof: GiftProof): Promise<GiftStatus> => {
    const result = await receipt(proof.redeem!)
    return gift_redemption(await receipt_policy(result), address, proof, result)
  }
  const finish = async (status: GiftStatus, action: 'open' | 'collect'): Promise<GiftStatus> => {
    const result = await receipt(status.proof![action]!)
    const prior_policy = await receipt_policy(result)
    return action === 'open'
      ? gift_opening(prior_policy, address, status, result)
      : gift_collection(prior_policy, address, status, result)
  }

  const recover_stage = async (status: GiftStatus, action: 'open' | 'collect'): Promise<GiftStatus> => {
    const page = (await historical())[action === 'open' ? 'openings' : 'collections']
    for (const digest of box_hints(policy, page)) {
      const proof = { ...status.proof!, [action]: digest }
      try {
        return await finish({ ...status, proof }, action)
      } catch (error) {
        if (!(error instanceof GiftError) || error.code !== 'ineligible') throw error
      }
    }
    throw new GiftError('unavailable')
  }

  const follow_reward = async (status: GiftStatus): Promise<GiftStatus> => {
    if (status.proof?.collect) return finish(status, 'collect')
    const claim = await read_object(client, status.claim!)
    if (!claim) return recover_stage(status, 'collect')
    if (
      !claim.json ||
      claim.owner.AddressOwner !== address ||
      claim.json.rolled_template !== status.reward_template ||
      claim.json.box_template !== policy.box_template ||
      claim.json.amount !== status.amount
    )
      throw new GiftError('ineligible')
    return status
  }

  const follow_crate = async (status: GiftStatus): Promise<GiftStatus> => {
    if (status.proof?.open) return follow_reward(await finish(status, 'open'))
    const crate = await read_object(client, status.crate!)
    if (!crate) return follow_reward(await recover_stage(status, 'open'))
    if (crate.json?.template !== policy.box_template || crate.json.amount !== 1) throw new GiftError('ineligible')
    return status
  }

  const discover = async (): Promise<GiftProof | null> => {
    const { objects, hasNextPage } = await client.core.listOwnedObjects({
      owner: address,
      type: `${policy.game_type}::distribution::Giftcard`,
      limit: 50,
      include: { json: true },
    })
    const owned = objects.find((object) => policy.giftcards.has(object.objectId))
    if (owned) return { giftcard: owned.objectId }
    const saved = await historical()
    const hint = redemption_hint(policy, saved)
    if (hint) return { giftcard: String(hint.contents.json.giftcard), redeem: hint.transaction.digest }
    if (hasNextPage || saved.redemptions.pageInfo.hasPreviousPage) throw new GiftError('unavailable')
    return null
  }

  return async (requested: GiftProof | null): Promise<GiftStatus> => {
    const proof = requested ?? (await discover())
    if (!proof) return { stage: 'missing', proof: null }
    if (!policy.giftcards.has(proof.giftcard)) throw new GiftError('ineligible')
    if (proof.redeem) return follow_crate(await redemption(proof))
    const voucher = await read_object(client, proof.giftcard)
    if (voucher) {
      validate_gift_voucher(policy, voucher)
      return { stage: voucher.owner.AddressOwner === address ? 'voucher' : 'available', proof }
    }
    const hint = redemption_hint(policy, await historical(), proof.giftcard)
    if (!hint) throw new GiftError('unavailable')
    const recovered = { ...proof, redeem: hint.transaction.digest }
    return follow_crate(await redemption(recovered))
  }
}

const personal_cap = async (sdk: Sdk, address: string, kiosk?: string): Promise<KioskOwnerCap | null> => {
  const { kioskOwnerCaps } = await sdk.get_owned_kiosks(address)
  const cap = kioskOwnerCaps.find((cap) => cap.isPersonal && (!kiosk || cap.kioskId === kiosk)) ?? null
  if (kiosk && !cap) throw new GiftError('ineligible')
  return cap
}

/** The gateway accepts intent, never transaction bytes; the SDK composes its three fixed PTBs. */
export const build_gift_transaction = async (
  sdk: Sdk,
  policy: GiftPolicy,
  address: string,
  action: GiftAction,
  status: GiftStatus
) => {
  const required = { redeem: 'voucher', open: 'crate', collect: 'reward' }[action]
  if (status.stage !== required || !status.proof) throw new GiftError('ineligible')
  const cap = await personal_cap(sdk, address, status.kiosk)
  const tx = sdk.tx()
  tx.setSender(address)
  if (action === 'redeem') {
    await sdk.hydrate([status.proof.giftcard, policy.box_template])
    sdk.with_personal_kiosk(tx, cap, (kiosk, owner_cap) =>
      sdk.doors.redeem_giftcard(tx, {
        card: status.proof!.giftcard,
        template: policy.box_template,
        existing: null,
        kiosk,
        cap: owner_cap,
      })
    )
  } else {
    if (!cap || !status.kiosk) throw new GiftError('ineligible')
    await sdk.hydrate([
      status.kiosk,
      policy.box_template,
      ...[status.claim, status.reward_template].filter((id): id is string => !!id),
    ])
    if (action === 'open')
      sdk.doors.open_loot_boxes(tx, {
        kiosk: status.kiosk,
        personal: cap,
        box_item_id: status.crate!,
        box_template: policy.box_template,
        count: 1,
      })
    else
      sdk.doors.claim_loot(tx, {
        kiosk: status.kiosk,
        personal: cap,
        claim: status.claim!,
        rolled_template: status.reward_template!,
        existing: null,
      })
  }
  // Resolves only kind inputs. The player's empty gas balance is irrelevant.
  const kind = await tx.build({ client: sdk.sui_client as never, onlyTransactionKind: true })
  validate_gift_transaction(policy, action, tx.getData(), status)
  return { tx, kind }
}
