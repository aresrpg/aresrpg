// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure equipment staging — the client twin of equipment.move's guards. The tab stages a
// change-set locally (immutable slot map), the Accept button turns the diff into ONE SDK
// transaction, and the proven receipt folds through the session reducer.

import {
  character_equipment_slots,
  equipment_slot_accepts,
  relic_slots,
  type CharacterEquipmentSlot,
} from '@aresrpg/immutable'
import type { CharacterRow, EquippedItem, ItemRow } from '@aresrpg/protocol'

export type EquipmentMap = Readonly<Partial<Record<CharacterEquipmentSlot, EquippedItem>>>

export const equipment_map_of = (character: Readonly<CharacterRow>): EquipmentMap =>
  Object.freeze(Object.fromEntries(character.equipment.map((item) => [item.slot, item]))) as EquipmentMap

const as_equipped = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot): EquippedItem => {
  const { kiosk: _kiosk, ...row } = item
  return { ...row, slot }
}

/** The slot a bag item lands in: its category's slot, first free among the multi-slots
 *  (rings, relics) — falling back to the first multi-slot when all are taken (a replace). */
export const natural_slot_for = (item: Readonly<ItemRow>, equipment: EquipmentMap): CharacterEquipmentSlot | null => {
  const candidates = character_equipment_slots.filter((slot) => equipment_slot_accepts(slot, item.category))
  if (candidates.length === 0) return null
  return candidates.find((slot) => !equipment[slot]) ?? candidates[0] ?? null
}

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

export const stage_equip = (
  equipment: EquipmentMap,
  item: Readonly<ItemRow>,
  slot: CharacterEquipmentSlot
): EquipmentMap => Object.freeze({ ...equipment, [slot]: as_equipped(item, slot) })

export const stage_unequip = (equipment: EquipmentMap, slot: CharacterEquipmentSlot): EquipmentMap => {
  const { [slot]: _removed, ...rest } = equipment
  return Object.freeze(rest) as EquipmentMap
}

export type EquipmentChangeSet = Readonly<{
  to_equip: readonly Readonly<{ slot: string; item_id: string }>[]
  to_unequip: readonly Readonly<{ slot: string; item_id: string }>[]
}>

/** staged − real: slots whose occupant changed. A replace unequips then equips the same slot. */
export const equipment_change_set = (staged: EquipmentMap, real: EquipmentMap): EquipmentChangeSet => {
  const to_equip = character_equipment_slots.flatMap((slot) => {
    const item = staged[slot]
    return item && item.id !== real[slot]?.id ? [{ slot, item_id: item.id }] : []
  })
  const to_unequip = character_equipment_slots.flatMap((slot) => {
    const item = real[slot]
    return item && item.id !== staged[slot]?.id ? [{ slot, item_id: item.id }] : []
  })
  return Object.freeze({ to_equip: Object.freeze(to_equip), to_unequip: Object.freeze(to_unequip) })
}
