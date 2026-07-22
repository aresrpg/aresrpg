// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type Context = {
  // #23/D79 — the gRPC Core API client is the SSOT for chain reads (the legacy JSON-RPC `sui_client` was removed
  // from the runtime context during the migration; every read runs on `grpc_client.core.*`).
  grpc_client: import('@mysten/sui/grpc').SuiGrpcClient
  kiosk_client: import('@mysten/kiosk').KioskClient
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
  // The merged-package deployment override seam (S-46): a full/partial `aresrpg` id set merged OVER the
  // network map by every builder/read that targets THE merged package (offline tests / per-deployment
  // overrides). Omit in production.
  ids?: { aresrpg?: Record<string, string> }
}

export type ItemDamage = {
  from: number
  to: number
  damage_type: string
  element: string
}

export type ItemStatistics = {
  vitality?: number
  wisdom?: number
  strength?: number
  intelligence?: number
  chance?: number
  agility?: number
  range?: number
  movement?: number
  action?: number
  critical?: number
  raw_damage?: number
  critical_chance?: number
  critical_outcomes?: number
  earth_resistance?: number
  fire_resistance?: number
  water_resistance?: number
  air_resistance?: number
}

export type Recipe = {
  id: string
  name: string
  level: number
  ingredients: {
    item_type: string
    amount: number
  }[]
  template: {
    name: string
    item_category: string
    item_set: string
    item_type: string
    level: number
    amount: number

    stats_min: ItemStatistics
    stats_max: ItemStatistics
    damages: ItemDamages[]
  }
}

export type SuiItem = {
  id: string
  name: string
  item_category: string
  item_set: string
  item_type: string
  level: number

  damages: ItemDamage[]

  amount: number

  // kiosk related
  kiosk_id: string
  is_kiosk_personal: boolean
  personal_kiosk_cap_id: string
  list_price?: bigint
  seller?: string

  // type related
  is_aresrpg_item: boolean
  is_aresrpg_character: boolean
  image_url: string
  _type: string
  stackable: boolean

  // for pets
  last_feed?: number
  feed_percent?: number
} & ItemStatistics

export type SuiToken = {
  name: string
  item_category: string
  item_set: string
  item_type: string
  amount: bigint
  decimal: number
  image_url: string
  ids: string[]
  is_token: boolean
  level: number
}

export type SuiCharacter = {
  id: string
  name: string
  classe: string
  sex: string
  realm: string

  position: { x: number; y: number; z: number }
  experience: number
  health: number
  available_points: number

  color_1: number
  color_2: number
  color_3: number

  vitality: number
  wisdom: number
  strength: number
  intelligence: number
  chance: number
  agility: number

  kiosk_id: string
  personal_kiosk_cap_id: string

  relic_1?: SuiItem
  relic_2?: SuiItem
  relic_3?: SuiItem
  relic_4?: SuiItem
  relic_5?: SuiItem
  relic_6?: SuiItem
  title?: SuiItem
  amulet?: SuiItem
  weapon?: SuiItem
  left_ring?: SuiItem
  belt?: SuiItem
  right_ring?: SuiItem
  boots?: SuiItem
  hat?: SuiItem
  cloak?: SuiItem
  pet?: SuiItem

  // On-chain per-job total XP, keyed by job id (jobs.js id: "farmer", "miner", "sword_smith", ...).
  // Stored as a Character VecMap dynamic field, projected by the indexer; absent until the character
  // has crafted/gathered. The server resolves job level from it (the craft lerp + gating consume it).
  jobs?: Record<string, number>

  _type: string
}
