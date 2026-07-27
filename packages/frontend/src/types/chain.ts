// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The transport-independent item shape consumed by inventory and marketplace views. */
export interface ItemInfo {
  id: string
  template_id: string
  /** The raw on-chain item_type slug (e.g. `iron_sword`) — the ONE key `item_icon_url` accepts. `template_id`
   *  is a canonical grouping/transaction identity that is frequently NOT a valid icon slug (a hash or a
   *  private-catalog-only id); a listing row must carry its own slug rather than let icon resolution guess it
   *  from template_id, or every template the private catalog doesn't know 404s to the placeholder cube (#1227).
   *  Optional: only the marketplace listing builders populate it today; other ItemInfo producers degrade to
   *  the template_id fallback the icon resolvers already carry. */
  slug?: string
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
