// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { JobSlug } from './identity.ts'

export const weapon_categories = Object.freeze(['daggers', 'spear', 'bow', 'axe', 'sword'] as const)

export const armor_categories = Object.freeze(['hat', 'cloak', 'belt', 'boots'] as const)
export const accessory_categories = Object.freeze(['amulet', 'ring', 'title'] as const)
export const tool_categories = Object.freeze(['tool_farmer', 'tool_herbalist', 'tool_miner'] as const)

export const equipment_categories = Object.freeze([
  ...armor_categories,
  ...accessory_categories,
  'pet',
  'relic',
  ...weapon_categories,
  ...tool_categories,
] as const)

export const item_categories = Object.freeze([
  ...equipment_categories,
  'consumable',
  'resource',
  'rune',
  'key',
] as const)

export type ItemCategory = (typeof item_categories)[number]
export type EquipmentCategory = (typeof equipment_categories)[number]
export type WeaponCategory = (typeof weapon_categories)[number]

export const is_item_category = (category: string): category is ItemCategory =>
  (item_categories as readonly string[]).includes(category)
export const is_weapon_category = (category: string): category is WeaponCategory =>
  (weapon_categories as readonly string[]).includes(category)
export const is_equipment_category = (category: string): category is EquipmentCategory =>
  (equipment_categories as readonly string[]).includes(category)
export const is_tool_category = (category: string): boolean => (tool_categories as readonly string[]).includes(category)

// Mirrors move-math/content_rules.move::craft_job_of. Categories absent here deliberately use
// the recipe's authored job because one category can serve several professions.
const craft_jobs_by_category: Readonly<Partial<Record<ItemCategory, JobSlug>>> = Object.freeze({
  sword: 'FORGER',
  daggers: 'FORGER',
  axe: 'FORGER',
  bow: 'CARVER',
  spear: 'CARVER',
  hat: 'TAILOR',
  cloak: 'TAILOR',
  boots: 'TANNER',
  belt: 'TANNER',
  ring: 'JEWELER',
  amulet: 'JEWELER',
  key: 'HANDYMAN',
})

export const craft_job_of = (category: string): JobSlug | null =>
  is_item_category(category) ? (craft_jobs_by_category[category] ?? null) : null

export const stackable_item_categories = Object.freeze(['consumable', 'resource', 'rune', 'key'] as const)
export const item_is_stackable = (category: string): boolean =>
  (stackable_item_categories as readonly string[]).includes(category)

// Mirrors aresrpg::crafting's compiled hard caps. Stackable batches write at most one output
// object; unique batches mint one object per success and therefore keep the lower gas bound.
export const craft_stackable_batch_limit = 1_000
export const craft_unique_batch_limit = 1
export const craft_batch_limit = (category: string): number =>
  item_is_stackable(category) ? craft_stackable_batch_limit : craft_unique_batch_limit

export const element_names = Object.freeze(['earth', 'fire', 'water', 'air'] as const)
export type ElementName = (typeof element_names)[number]

export const character_consumable_types = Object.freeze(['heal', 'reset_stats', 'reset_spells', 'recall'] as const)
export type CharacterConsumableType = (typeof character_consumable_types)[number]

export const consumable_types = Object.freeze([...character_consumable_types, 'loot_box'] as const)
export type ConsumableType = (typeof consumable_types)[number]

export const item_stat_center = 32_768
