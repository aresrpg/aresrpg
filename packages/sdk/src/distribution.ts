// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Free distribution actions through the SDK's cached transaction lifecycle. Auth owns the
// kiosk lookup; this module owns only deterministic ids, PTB composition, and receipt projection.

import type { KioskOwnerCap } from '@mysten/kiosk'
import type { GiftcardRow } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidSuiAddress, normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'
import { ZkSendClient } from '@mysten/zksend'

import type { Sdk } from './client.ts'
import { absorb_receipt, receipt_digest } from './cache.ts'
import { MAX_GIFTCARDS_PER_TRANSACTION } from './giftcard_batch.ts'

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
    throw new Error('The object is not an AresRPG giftcard')
  const template = object.json?.template
  const amount = Number(object.json?.amount)
  if (typeof template !== 'string' || !Number.isSafeInteger(amount) || amount < 1)
    throw new Error('The giftcard has invalid chain data')
  return Object.freeze({ id: object.objectId, template, amount })
}

const gift_link_network = (url: URL): 'testnet' | 'mainnet' => {
  const parameter = url.searchParams.get('network')
  if (parameter !== null && parameter !== 'testnet') throw new Error('The printed giftcard network is invalid')
  return parameter === 'testnet' ? 'testnet' : 'mainnet'
}

export const canonical_zksend_gift_url = (url: string, network: 'testnet' | 'mainnet'): string => {
  const scanned = new URL(url)
  if (!['/gift', '/claim'].includes(scanned.pathname) || !scanned.hash.startsWith('#$') || scanned.hash.length <= 2)
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

export const redeem_giftcards = async (
  sdk: Sdk,
  kiosk_cap: KioskOwnerCap | null,
  cards: readonly GiftcardRow[],
  received_transaction?: string
): Promise<Readonly<{ digest: string; kiosk_cap: KioskOwnerCap }>> => {
  if (cards.length < 1 || cards.length > MAX_GIFTCARDS_PER_TRANSACTION)
    throw new Error('Redeem 1..100 giftcards at a time')
  const ids = cards.map(({ id }) => normalizeSuiAddress(id))
  if (new Set(ids).size !== ids.length) throw new Error('A giftcard cannot appear twice in a batch')
  if (received_transaction) {
    const receipt = await sdk.sui_client.core.waitForTransaction({
      digest: received_transaction,
      include: { effects: true, objectTypes: true },
      timeout: 20_000,
    })
    if (receipt_digest(receipt) !== received_transaction) throw new Error('Giftcard transfer receipt does not match')
    absorb_receipt(sdk.cache, receipt)
  }
  // Vouchers can enter this wallet through a different SDK session. Their owned refs are not stable.
  await sdk.hydrate(ids)
  await sdk.hydrate_unknown(cards.map(({ template }) => template))
  const tx = sdk.tx()
  sdk.with_personal_kiosk(tx, kiosk_cap, (kiosk, cap) => {
    cards.forEach((card) =>
      sdk.doors.redeem_giftcard(tx, {
        card: card.id,
        template: card.template,
        // Each voucher constructs its own stack; inventory already groups fragments by item type.
        existing: null,
        kiosk,
        cap,
      })
    )
  })
  // A claim may construct 100 items, so its cost is not the fixed single-action game budget.
  const { receipt, kiosk_cap: settled_kiosk_cap } = await sdk.execute_personal_kiosk(tx, kiosk_cap, {
    budget: 'estimate',
  })
  return Object.freeze({ digest: receipt_digest(receipt), kiosk_cap: settled_kiosk_cap })
}

/** Explicit import inspection for the separately connected external wallet. */
export const read_giftcards = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  owner: string
): Promise<readonly GiftcardRow[]> => {
  const type = giftcard_type(sdk)
  const cards: GiftcardRow[] = []
  let cursor: string | null | undefined
  do {
    const page = await client.core.listOwnedObjects({ owner, type, cursor, include: { json: true } })
    cards.push(...page.objects.map((object) => canonical_giftcard(object, type)))
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  return Object.freeze(cards)
}

export type GiftcardTransfer = Readonly<{ id: string; recipient: string }>

/** One fixed transport door for wallet imports and distribution batches. No mint authority. */
export const transfer_giftcards = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  transfers: readonly GiftcardTransfer[]
): Promise<Readonly<{ digest: string; giftcards: readonly GiftcardRow[] }>> => {
  if (transfers.length < 1 || transfers.length > MAX_GIFTCARDS_PER_TRANSACTION)
    throw new Error('Transfer 1..100 giftcards at a time')
  const ids = transfers.map(({ id }) => normalizeSuiAddress(id))
  if (new Set(ids).size !== ids.length) throw new Error('A giftcard cannot appear twice in a batch')
  if (transfers.some(({ recipient }) => !isValidSuiAddress(recipient))) throw new Error('Invalid giftcard recipient')
  const { objects } = await client.core.getObjects({ objectIds: ids, include: { json: true } })
  const type = giftcard_type(sdk)
  const cards = objects.map((object, index) => {
    if (object instanceof Error) throw object
    if (
      object.objectId !== ids[index] ||
      object.owner.$kind !== 'AddressOwner' ||
      normalizeSuiAddress(object.owner.AddressOwner) !== normalizeSuiAddress(sender)
    )
      throw new Error('Every giftcard must be held by the signing wallet')
    return canonical_giftcard(object, type)
  })
  if (cards.length !== ids.length) throw new Error('Giftcard lookup returned incomplete results')
  await sdk.hydrate(ids)
  const tx = sdk.tx()
  transfers.forEach(({ id, recipient }) => tx.transferObjects([sdk.door_context.obj(tx, id, true)], recipient))
  const receipt = await sdk.execute(tx)
  return Object.freeze({ digest: receipt_digest(receipt), giftcards: Object.freeze(cards) })
}
