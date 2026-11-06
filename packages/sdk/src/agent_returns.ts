// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiClientTypes } from '@mysten/sui/client'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'

import { read_personal_kiosks } from './kiosk_discovery.ts'
import type { EquipChange } from './character_actions.ts'
import type { Sdk } from './client.ts'

export type ReturnEquipment = EquipChange & Readonly<{ purchase_cap: string }>
export type AgentReturnOffer = Readonly<{
  character_id: string
  seller_kiosk: string
  purchase_cap: string
  recipient: string
  agent_address: string
  equipment?: readonly ReturnEquipment[]
}>
const purchase_cap = bcs.struct('PurchaseCap', {
  id: bcs.Address,
  kiosk_id: bcs.Address,
  item_id: bcs.Address,
  min_price: bcs.u64(),
})
export const decode_agent_purchase_cap = (bytes: Uint8Array) => purchase_cap.parse(bytes)

const unequipped = bcs.struct('ItemUnequipped', { character: bcs.Address, slot: bcs.string(), item: bcs.Address })
export const decode_return_equipment = (bytes: Uint8Array) => unequipped.parse(bytes)

type CapabilityObject = SuiClientTypes.Object<{ content: true; previousTransaction: true }>
const owned_capabilities = async (client: SuiGrpcClient, owner: string, type: string) => {
  const objects: CapabilityObject[] = []
  const cursors = new Set<string>()
  let cursor: string | null | undefined
  do {
    const page = await client.core.listOwnedObjects({
      owner,
      type,
      cursor,
      include: { content: true, previousTransaction: true },
    })
    objects.push(...page.objects)
    cursor = page.hasNextPage ? page.cursor : null
    if (page.hasNextPage && (!cursor || cursors.has(cursor))) throw new Error('Return-offer pagination changed.')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  if (new Set(objects.map((object) => object.objectId)).size !== objects.length)
    throw new Error('Return-offer ownership changed; refresh before proceeding.')
  return objects
}
const verified_offer = (
  object: CapabilityObject,
  context: Readonly<{
    type: string
    recipient: string
    agent: string
    kiosks: ReadonlySet<string>
  }>
): AgentReturnOffer | null => {
  const { type, recipient, agent, kiosks } = context
  if (
    object.owner.$kind !== 'AddressOwner' ||
    normalizeSuiAddress(object.owner.AddressOwner) !== recipient ||
    normalizeStructTag(object.type) !== type
  )
    throw new Error('Return-offer ownership changed; refresh before proceeding.')
  const cap = decode_agent_purchase_cap(object.content)
  if (cap.id !== normalizeSuiAddress(object.objectId)) throw new Error('Return capability identity mismatch.')
  if (cap.min_price !== '0' || !kiosks.has(cap.kiosk_id)) return null
  return Object.freeze({
    character_id: cap.item_id,
    seller_kiosk: cap.kiosk_id,
    purchase_cap: cap.id,
    recipient,
    agent_address: agent,
  })
}

/** Explicit transaction preflight snapshot. The chain owns the capability and kiosk authority;
 * the setup server never fabricates incoming transfers or acts as custody authority. */
export const read_agent_returns = async (
  client: SuiGrpcClient,
  sdk: Pick<Sdk, 'get_owned_kiosks' | 'game_type_package'>,
  owner: string,
  agent_address: string
): Promise<readonly AgentReturnOffer[]> => {
  const recipient = normalizeSuiAddress(owner)
  const agent = normalizeSuiAddress(agent_address)
  const type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${sdk.game_type_package}::character::Character>`)
  const [caps, objects] = await Promise.all([
    read_personal_kiosks(sdk, agent),
    owned_capabilities(client, recipient, type),
  ])
  const kiosks = new Set(caps.map((cap) => normalizeSuiAddress(cap.kioskId)))
  const offers = objects
    .map((object) => verified_offer(object, { type, recipient, agent, kiosks }))
    .filter((offer): offer is AgentReturnOffer => offer !== null)
  if (!offers.length) return Object.freeze([])
  const item_type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${sdk.game_type_package}::item::Item>`)
  const items = await owned_capabilities(client, recipient, item_type)
  return Object.freeze(
    await Promise.all(
      offers.map(async (offer) => {
        const object = objects.find((row) => row.objectId === offer.purchase_cap)!
        const receipt = await offer_receipt(client, object, agent, recipient)
        const equipment = equipment_events(receipt, sdk.game_type_package!, offer.character_id)
        const associated = equipment.map((row) => {
          const matches = items.filter((item) => decode_agent_purchase_cap(item.content).item_id === row.item)
          if (matches.length !== 1) throw new Error('Return equipment capability is missing or ambiguous.')
          const item = matches[0]!
          const verified = verified_offer(item, { type: item_type, recipient, agent, kiosks })
          if (
            !verified ||
            verified.seller_kiosk !== offer.seller_kiosk ||
            item.previousTransaction !== object.previousTransaction
          )
            throw new Error('Return equipment is not from this Recall transaction and kiosk.')
          assert_created_cap(receipt, item, recipient)
          return Object.freeze({ slot: row.slot, item_id: row.item, purchase_cap: item.objectId })
        })
        return Object.freeze({ ...offer, equipment: Object.freeze(associated) })
      })
    )
  )
}

type OfferReceipt = SuiClientTypes.Transaction<{ events: true; effects: true; transaction: true }>
const assert_created_cap = (receipt: OfferReceipt, cap: CapabilityObject, recipient: string): void => {
  const change = receipt.effects.changedObjects.find((row) => row.objectId === cap.objectId)
  if (!change) throw new Error('Return capability creation is missing.')
  const valid = [
    typeof cap.version === 'string',
    typeof cap.digest === 'string',
    change.idOperation === 'Created',
    change.outputVersion === cap.version,
    change.outputDigest === cap.digest,
    change.outputOwner?.$kind === 'AddressOwner',
    change.outputOwner?.AddressOwner === recipient,
  ]
  if (!valid.every(Boolean)) throw new Error('Return capability is not the unchanged receipt output.')
}
const offer_receipt = async (client: SuiGrpcClient, cap: CapabilityObject, agent: string, recipient: string) => {
  if (!cap.previousTransaction) throw new Error('Return capability creation receipt is unavailable.')
  const result = await client.core.getTransaction({
    digest: cap.previousTransaction,
    include: { events: true, effects: true, transaction: true },
  })
  const receipt = result.Transaction
  if (
    !receipt ||
    !receipt.status.success ||
    receipt.digest !== cap.previousTransaction ||
    receipt.transaction.sender !== agent
  )
    throw new Error('Return capability receipt is invalid.')
  assert_created_cap(receipt, cap, recipient)
  return receipt
}

/** Re-read receipt and current capability ownership before review and again before signing. */
export const check_agent_return = async (
  client: SuiGrpcClient,
  sdk: Pick<Sdk, 'get_owned_kiosks' | 'game_type_package'>,
  recipient: string,
  intent: Readonly<{
    agent_address?: string
    purchase_cap: string
    seller_kiosk: string
    character_id?: string
    equipment?: readonly ReturnEquipment[]
  }>
): Promise<void> => {
  // Legacy bare-cap SDK operations carry no equipment association; the app supplies a source.
  if (!intent.agent_address) {
    if ('equipment' in intent) throw new Error('Equipment return requires a verified source identity.')
    return
  }
  const offers = await read_agent_returns(client, sdk, recipient, intent.agent_address)
  const offer = offers.find((row) => row.purchase_cap === intent.purchase_cap)
  if (!offer) throw new Error('Return capability is no longer available.')
  const valid = [
    offer.seller_kiosk === intent.seller_kiosk,
    intent.character_id === undefined || offer.character_id === intent.character_id,
    JSON.stringify(offer.equipment ?? []) === JSON.stringify(intent.equipment ?? []),
  ]
  if (!valid.every(Boolean)) throw new Error('Return equipment or ownership changed. Refresh before signing.')
}

export type AgentItemReturnOffer = Readonly<{
  item_id: string
  seller_kiosk: string
  purchase_cap: string
  recipient: string
  agent_address: string
}>
export const read_agent_item_returns = async (
  client: SuiGrpcClient,
  sdk: Pick<Sdk, 'get_owned_kiosks' | 'game_type_package'>,
  owner: string,
  agent_address: string
): Promise<readonly AgentItemReturnOffer[]> => {
  const recipient = normalizeSuiAddress(owner)
  const agent = normalizeSuiAddress(agent_address)
  const type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${sdk.game_type_package}::item::Item>`)
  const [caps, objects] = await Promise.all([
    read_personal_kiosks(sdk, agent),
    owned_capabilities(client, recipient, type),
  ])
  const kiosks = new Set(caps.map((cap) => normalizeSuiAddress(cap.kioskId)))
  // Reserve immutable slot/item associations from the character offer, even if a gear cap
  // has since moved. An unavailable or altered character receipt blocks incoming claims only.
  const character_type = normalizeStructTag(`0x2::kiosk::PurchaseCap<${sdk.game_type_package}::character::Character>`)
  const characters = await owned_capabilities(client, recipient, character_type)
  const pending = characters.flatMap((object) => {
    const offer = verified_offer(object, { type: character_type, recipient, agent, kiosks })
    return offer ? [{ object, offer }] : []
  })
  const evidence = await Promise.all(
    pending.map(async ({ object, offer }) => ({
      digest: object.previousTransaction,
      items: equipment_events(
        await offer_receipt(client, object, agent, recipient),
        sdk.game_type_package!,
        offer.character_id
      ).map((item) => `${offer.seller_kiosk}:${item.item}`),
    }))
  )
  const associated_items = new Set(evidence.flatMap((row) => row.items))
  const receipts = evidence.map((row) => row.digest)
  const paired_gear = new Set(
    objects
      .filter((object) => {
        const cap = decode_agent_purchase_cap(object.content)
        return associated_items.has(`${cap.kiosk_id}:${cap.item_id}`) || receipts.includes(object.previousTransaction)
      })
      .map((object) => object.objectId)
  )
  return Object.freeze(
    objects
      .map((object) => verified_offer(object, { type, recipient, agent, kiosks }))
      .filter((offer): offer is AgentReturnOffer => offer !== null && !paired_gear.has(offer.purchase_cap))
      .map((offer) =>
        Object.freeze({
          item_id: offer.character_id,
          seller_kiosk: offer.seller_kiosk,
          purchase_cap: offer.purchase_cap,
          recipient,
          agent_address: agent,
        })
      )
  )
}

const equipment_events = (receipt: OfferReceipt, type_package: string, character: string) => {
  const type = normalizeStructTag(`${type_package}::equipment::ItemUnequipped`)
  const rows = receipt.events
    .filter((event) => normalizeStructTag(event.eventType) === type)
    .map((event) => decode_return_equipment(event.bcs))
    .filter((row) => row.character === character)
  if (
    new Set(rows.map((row) => row.slot)).size !== rows.length ||
    new Set(rows.map((row) => row.item)).size !== rows.length
  )
    throw new Error('Ambiguous return equipment.')
  return rows
}
