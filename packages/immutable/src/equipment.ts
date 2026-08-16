// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character equipment vocabulary shared by every client surface.

import { is_weapon_category } from './item.ts'

export const relic_slots = Object.freeze(['relic_1', 'relic_2', 'relic_3', 'relic_4', 'relic_5', 'relic_6'] as const)
export const rig_slots = Object.freeze([
  'helmet',
  'amulet',
  'gauntlets',
  'chestplate',
  'weapon',
  'left_ring',
  'belt',
  'right_ring',
  'pet',
  'pants',
  'boots',
] as const)
export const cosmetic_slots = Object.freeze(['hat', 'cloak', 'title'] as const)
export const combat_equipment_slots = Object.freeze([...relic_slots, ...rig_slots] as const)
export const character_equipment_slots = Object.freeze([...combat_equipment_slots, ...cosmetic_slots] as const)
export type CharacterEquipmentSlot = (typeof character_equipment_slots)[number]

export const equipment_slot_accepts = (slot: CharacterEquipmentSlot, category: string): boolean => {
  if (slot === 'weapon') return is_weapon_category(category)
  if (slot === 'left_ring' || slot === 'right_ring') return category === 'ring'
  if (slot.startsWith('relic_')) return category === 'relic'
  return slot === category
}
