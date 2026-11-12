// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { equipment_slot_accepts, relic_slots, type CharacterEquipmentSlot } from '@aresrpg/immutable'

import type { EquippedItem, ItemRow } from './packets.ts'

type EquipmentMap = Readonly<Partial<Record<CharacterEquipmentSlot, EquippedItem>>>
export type EquipRefusal = 'wrong_slot' | 'level_too_low' | 'relic_duplicate' | 'item_listed' | null

/** equipment.move's own guards, predicted client-side — a refused stage never becomes a tx. */
export const equip_refusal = ({
  item,
  slot,
  character_level,
  equipment,
  listed_ids,
}: Readonly<{
  item: Readonly<ItemRow>
  slot: CharacterEquipmentSlot
  character_level: number
  equipment: EquipmentMap
  listed_ids: ReadonlySet<string>
}>): EquipRefusal => {
  if (listed_ids.has(item.id)) return 'item_listed'
  if (!equipment_slot_accepts(slot, item.category)) return 'wrong_slot'
  if (character_level < item.level) return 'level_too_low'
  if (
    slot.startsWith('relic_') &&
    relic_slots.some((other) => other !== slot && equipment[other]?.item_type === item.item_type)
  )
    return 'relic_duplicate'
  return null
}
