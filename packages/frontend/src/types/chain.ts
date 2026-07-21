// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The transport-independent item shape consumed by inventory and marketplace views. */
export interface ItemInfo {
  id: string
  template_id: string
  quantity: number
  stats_json: string
  slot: string
  name: string
  description: string
  rarity: string
  category: string
  level: number
  damages_json: string
  consumable_json: string
  particle_trail_json: string
  appearance: string
  weapon_class: string
  pet_power: number
  pet_stats_json: string
}

/** The item-listing projection shared by the marketplace store and its views. */
export interface MarketplaceListing {
  id: string
  kiosk_id: string
  seller_uuid: string
  item: ItemInfo
  price: number
  price_mist: string
  seller_sui_address: string
  seller_name: string
}
