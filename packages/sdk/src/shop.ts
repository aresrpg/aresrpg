// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shop actions through the SDK's cached transaction lifecycle. Auth owns the kiosk lookup;
// this module owns only deterministic ids, PTB composition, and receipt projection.

import { item_is_stackable } from '@aresrpg/immutable'
import type { KioskOwnerCap } from '@mysten/kiosk'

import type { Sdk } from './client.ts'
import { receipt_digest } from './cache.ts'
import { airdrop_id, item_template_id, sale_id } from './seed_ids.ts'

export type ShopPurchase = Readonly<{
  item_type: string
  category: string
  price_mist: bigint
  quantity: number
  existing_item_id?: string | null
}>

export type AirdropClaim = Readonly<{
  drop_id: string
  item_type: string
  category: string
  existing_item_id?: string | null
}>

// One non-stackable item costs a split-coin command plus one buy call. Four hundred leaves
// protocol headroom for personal-kiosk creation/finalization and Sui resolver commands.
export const MAX_NON_STACKABLE_PURCHASE_QUANTITY = 400

const published_ids = (sdk: Sdk) => {
  const package_id = sdk.pins.package
  const registry = sdk.pins.template_registry
  if (typeof package_id !== 'string' || !package_id) throw new Error('The game package is not published.')
  const registry_id = typeof registry === 'object' && registry !== null ? Reflect.get(registry, 'id') : null
  if (typeof registry_id !== 'string' || !registry_id) throw new Error('The item registry is not published.')
  return Object.freeze({ package_id, registry_id })
}

export const buy_shop_item = async (
  sdk: Sdk,
  kiosk_cap: KioskOwnerCap | null,
  purchase: ShopPurchase
): Promise<Readonly<{ digest: string; kiosk_cap: KioskOwnerCap }>> => {
  if (!Number.isSafeInteger(purchase.quantity) || purchase.quantity < 1)
    throw new Error('Purchase quantity must be a positive integer.')
  if (purchase.price_mist <= 0n) throw new Error('Shop price must be positive.')
  if (!item_is_stackable(purchase.category) && purchase.quantity > MAX_NON_STACKABLE_PURCHASE_QUANTITY)
    throw new Error(`A non-stackable purchase can contain at most ${MAX_NON_STACKABLE_PURCHASE_QUANTITY} items.`)

  const { package_id, registry_id } = published_ids(sdk)
  const sale = sale_id(registry_id, package_id, purchase.item_type)
  const template = item_template_id(registry_id, purchase.item_type)
  await sdk.hydrate_unknown([sale, template])
  const tx = sdk.tx()
  sdk.with_personal_kiosk(tx, kiosk_cap, (kiosk, cap) => {
    const stackable = item_is_stackable(purchase.category)
    const buy = (quantity: number, payment_mist: bigint, existing: string | null) =>
      sdk.doors.buy(tx, {
        sale,
        template,
        quantity,
        payment: sdk.coin_of(tx, payment_mist),
        existing,
        kiosk,
        cap,
      })

    if (stackable) {
      buy(purchase.quantity, purchase.price_mist * BigInt(purchase.quantity), purchase.existing_item_id ?? null)
      return
    }
    for (let index = 0; index < purchase.quantity; index += 1) buy(1, purchase.price_mist, null)
  })
  const { receipt, kiosk_cap: settled_kiosk_cap } = await sdk.execute_personal_kiosk(tx, kiosk_cap)
  return Object.freeze({ digest: receipt_digest(receipt), kiosk_cap: settled_kiosk_cap })
}

export const claim_airdrop = async (
  sdk: Sdk,
  kiosk_cap: KioskOwnerCap | null,
  claim: AirdropClaim
): Promise<Readonly<{ digest: string; kiosk_cap: KioskOwnerCap }>> => {
  const { package_id, registry_id } = published_ids(sdk)
  const drop = airdrop_id(registry_id, package_id, claim.drop_id)
  const template = item_template_id(registry_id, claim.item_type)
  await sdk.hydrate_unknown([drop, template])
  const tx = sdk.tx()
  sdk.with_personal_kiosk(tx, kiosk_cap, (kiosk, cap) => {
    sdk.doors.claim_airdrop(tx, {
      drop,
      template,
      existing: item_is_stackable(claim.category) ? (claim.existing_item_id ?? null) : null,
      kiosk,
      cap,
    })
  })
  const { receipt, kiosk_cap: settled_kiosk_cap } = await sdk.execute_personal_kiosk(tx, kiosk_cap)
  return Object.freeze({ digest: receipt_digest(receipt), kiosk_cap: settled_kiosk_cap })
}
