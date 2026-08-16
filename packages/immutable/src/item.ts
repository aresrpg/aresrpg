// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const weapon_categories = Object.freeze([
  'longsword',
  'daggers',
  'battleaxe',
  'spear',
  'staff',
  'spellbook',
  'bow',
  'axe',
  'mace',
  'club',
  'sword',
] as const)

export const item_categories = Object.freeze([
  'helmet',
  'chestplate',
  'belt',
  'gauntlets',
  'pants',
  'boots',
  'amulet',
  'ring',
  'pet',
  'relic',
  'title',
  'hat',
  'cloak',
  ...weapon_categories,
  'tool_farmer',
  'tool_herbalist',
  'tool_miner',
  'consumable',
  'resource',
  'rune',
  'pet_food',
  'key',
] as const)

export type ItemCategory = (typeof item_categories)[number]
export type WeaponCategory = (typeof weapon_categories)[number]

export const is_item_category = (category: string): category is ItemCategory =>
  (item_categories as readonly string[]).includes(category)
export const is_weapon_category = (category: string): category is WeaponCategory =>
  (weapon_categories as readonly string[]).includes(category)

export const stackable_item_categories = Object.freeze(['consumable', 'resource', 'rune', 'pet_food'] as const)
export const item_is_stackable = (category: string): boolean =>
  (stackable_item_categories as readonly string[]).includes(category)

export const element_names = Object.freeze(['earth', 'fire', 'water', 'air'] as const)
export type ElementName = (typeof element_names)[number]

export const character_consumable_types = Object.freeze(['heal', 'reset_stats', 'reset_spells', 'recall'] as const)
export type CharacterConsumableType = (typeof character_consumable_types)[number]

export const consumable_types = Object.freeze([...character_consumable_types, 'loot_box'] as const)
export type ConsumableType = (typeof consumable_types)[number]

export const item_stat_center = 32_768
