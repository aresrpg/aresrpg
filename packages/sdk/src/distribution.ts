// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Free distribution actions through the SDK's cached transaction lifecycle. Auth owns the
// kiosk lookup; this module owns only deterministic ids, PTB composition, and receipt projection.

import { item_is_stackable } from '@aresrpg/immutable'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { GiftcardRow } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { ZkSendClient } from '@mysten/zksend'

import type { Sdk } from './client.ts'
import { receipt_digest, receipt_event } from './cache.ts'
import { event_integer, event_string } from './receipt_decode.ts'
import { airdrop_id, item_template_id } from './seed_ids.ts'

export type AirdropClaim = Readonly<{
  drop_id: string
  item_type: string
  recipient: string
}>

export type GiftcardRedeem = Readonly<{
  card: GiftcardRow
  category: string
  existing_item_id?: string | null
  existing_kiosk_id?: string | null
}>

type GiftcardObject = Readonly<{
  objectId: string
  type?: string
  json?: Readonly<Record<string, unknown>> | null
}>

const giftcard_type = (sdk: Sdk): string => {
  if (!sdk.game_type_package) throw new Error('The game package is not published.')
  return `${sdk.game_type_package}::distribution::Giftcard`
}

const canonical_giftcard = (object: GiftcardObject, expected_type: string): GiftcardRow => {
  if (!object.type || normalizeStructTag(object.type) !== normalizeStructTag(expected_type))
    throw new Error('The zkSend link does not contain an AresRPG giftcard')
  const template = object.json?.template
  const amount = Number(object.json?.amount)
  if (typeof template !== 'string' || !Number.isSafeInteger(amount) || amount < 1)
    throw new Error('The zkSend giftcard has invalid chain data')
  return Object.freeze({ id: object.objectId, template, amount })
}

const gift_link_network = (url: URL): 'testnet' | 'mainnet' => {
  const parameter = url.searchParams.get('network')
  if (parameter !== null && parameter !== 'testnet') throw new Error('The printed giftcard network is invalid')
  return parameter === 'testnet' ? 'testnet' : 'mainnet'
}

export const canonical_zksend_gift_url = (url: string, network: 'testnet' | 'mainnet'): string => {
  const scanned = new URL(url)
  if (scanned.pathname !== '/gift' || !scanned.hash.startsWith('#$') || scanned.hash.length <= 2)
    throw new Error('The printed giftcard link is invalid')
  const link_network = gift_link_network(scanned)
  if (link_network !== network) throw new Error(`The giftcard belongs to ${link_network}, not ${network}`)
  const canonical = new URL('https://my.slush.app/claim')
  if (network === 'testnet') canonical.searchParams.set('network', network)
  canonical.hash = scanned.hash
  return canonical.toString()
}

/** Claims one bearer voucher through zkSend's hosted claim service. That service pays this
 * transport leg; the authenticated game wallet pays only the later AresRPG redemption. */
export const claim_giftcard_link = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  url: string,
  recipient: string
): Promise<Readonly<{ digest: string; giftcard: GiftcardRow }>> => {
  const expected_type = giftcard_type(sdk)
  const link = await new ZkSendClient(client).loadLinkFromUrl(canonical_zksend_gift_url(url, sdk.network))
  const assets = link.assets?.nfts.filter(({ type }) => normalizeStructTag(type) === normalizeStructTag(expected_type))
  if (assets?.length !== 1) throw new Error('The zkSend link must contain exactly one AresRPG giftcard')
  const [asset] = assets
  const { objects } = await client.core.getObjects({ objectIds: [asset.objectId], include: { json: true } })
  const [object] = objects
  if (!object || object instanceof Error || object.objectId !== asset.objectId)
    throw new Error('The zkSend giftcard is unavailable')
  const giftcard = canonical_giftcard(object, expected_type)
  const claimed = await link.claimAssets(recipient)
  return Object.freeze({ digest: claimed.Transaction.digest, giftcard })
}

const published_ids = (sdk: Sdk) => {
  const package_id = sdk.game_type_package
  if (typeof package_id !== 'string' || !package_id) throw new Error('The game package is not published.')
  const root = sdk.pins.content_root
  const content_root = typeof root === 'object' && root !== null ? Reflect.get(root, 'id') : null
  const seed_original = sdk.pins.seed_package_original
  if (typeof content_root !== 'string' || typeof seed_original !== 'string')
    throw new Error('The living-content registry is not published.')
  return Object.freeze({ package_id, content_root, seed_package_original: seed_original })
}

export const claim_airdrop = async (
  sdk: Sdk,
  claim: AirdropClaim
): Promise<Readonly<{ digest: string; giftcard: GiftcardRow }>> => {
  const { package_id, content_root, seed_package_original } = published_ids(sdk)
  const drop = airdrop_id(content_root, package_id, claim.drop_id)
  const template = item_template_id(content_root, seed_package_original, claim.item_type)
  await sdk.hydrate_unknown([drop, template])
  const tx = sdk.tx()
  sdk.doors.claim_airdrop(tx, { drop, template, recipient: claim.recipient })
  const receipt = await sdk.execute(tx, { include: { objectTypes: true } })
  const claimed = receipt_event(receipt, '::distribution::AirdropClaimed')
  const minted = receipt_event(receipt, '::distribution::GiftcardMinted')
  if (!claimed || !minted) throw new Error('The airdrop receipt carried no voucher')
  return Object.freeze({
    digest: receipt_digest(receipt),
    giftcard: Object.freeze({
      id: event_string(claimed, 'giftcard'),
      template: event_string(minted, 'template'),
      amount: event_integer(minted, 'amount'),
    }),
  })
}

export const redeem_giftcard = async (
  sdk: Sdk,
  kiosk_cap: KioskOwnerCap | null,
  redemption: GiftcardRedeem
): Promise<Readonly<{ digest: string; kiosk_cap: KioskOwnerCap }>> => {
  await sdk.hydrate_unknown([redemption.card.id, redemption.card.template])
  const tx = sdk.tx()
  sdk.with_personal_kiosk(tx, kiosk_cap, (kiosk, cap) => {
    sdk.doors.redeem_giftcard(tx, {
      card: redemption.card.id,
      template: redemption.card.template,
      existing: item_is_stackable(redemption.category) ? (redemption.existing_item_id ?? null) : null,
      kiosk,
      cap,
    })
  })
  const { receipt, kiosk_cap: settled_kiosk_cap } = await sdk.execute_personal_kiosk(tx, kiosk_cap)
  return Object.freeze({ digest: receipt_digest(receipt), kiosk_cap: settled_kiosk_cap })
}
