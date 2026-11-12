// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure equipment intent — the client twin of equipment.move's guards. One gesture creates
// one immutable slot change, revalidated before the SDK transaction and receipt fold.

import { character_equipment_slots, equipment_slot_accepts, type CharacterEquipmentSlot } from '@aresrpg/immutable'
import type { CharacterRow, EquippedItem, ItemRow } from '@aresrpg/protocol'
import { equip_refusal, type EquipRefusal } from '@aresrpg/protocol/equipment'
export { equip_refusal, type EquipRefusal } from '@aresrpg/protocol/equipment'

export type EquipmentMap = Readonly<Partial<Record<CharacterEquipmentSlot, EquippedItem>>>

export const equipment_map_of = (character: Readonly<CharacterRow>): EquipmentMap =>
  Object.freeze(Object.fromEntries(character.equipment.map((item) => [item.slot, item]))) as EquipmentMap

const as_equipped = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot): EquippedItem => {
  const { kiosk: _kiosk, ...row } = item
  return { ...row, slot }
}

/** The slot a bag item lands in: its category's slot, first free among the multi-slots
 *  (rings, relics) — falling back to the first multi-slot when all are taken (a replace). */
export const natural_slot_for = (
  item: Readonly<Pick<ItemRow, 'category'>>,
  equipment: EquipmentMap
): CharacterEquipmentSlot | null => {
  const candidates = character_equipment_slots.filter((slot) => equipment_slot_accepts(slot, item.category))
  if (candidates.length === 0) return null
  return candidates.find((slot) => !equipment[slot]) ?? candidates[0] ?? null
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

/** A gesture binds the visible loadout and item revision, never a later replacement. */
export const equipment_commit_refusal = ({
  character,
  current,
  equipment,
  inventory,
  blocked,
}: Readonly<{
  character: Readonly<CharacterRow>
  current: Readonly<CharacterRow> | null
  equipment: EquipmentMap
  inventory: readonly Readonly<ItemRow>[]
  blocked: ReadonlySet<string>
}>): Exclude<EquipRefusal, null> | 'unavailable' | null => {
  if (!current) return 'unavailable'
  const changed = equipment_change_set(equipment_map_of(current), equipment_map_of(character))
  const unavailable = [
    current.custody !== 'kiosk',
    current.kiosk !== character.kiosk,
    blocked.has(current.id),
    changed.to_equip.length + changed.to_unequip.length > 0,
  ].some(Boolean)
  if (unavailable) return 'unavailable'
  const changes = equipment_change_set(equipment, equipment_map_of(character))
  for (const { slot, item_id } of changes.to_equip) {
    const item = inventory.find(({ id }) => id === item_id)
    const target = slot as CharacterEquipmentSlot
    if (item?.kiosk !== current.kiosk || item.version !== equipment[target]!.version) return 'unavailable'
    const refusal = equip_refusal({
      item,
      slot: target,
      character_level: current.level,
      equipment,
      listed_ids: blocked,
    })
    if (refusal) return refusal
  }
  return null
}
