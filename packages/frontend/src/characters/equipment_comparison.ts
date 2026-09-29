// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { stat_names } from '@aresrpg/immutable'
import type { EquippedItem } from '@aresrpg/protocol'

import { item_stat_offset } from '../game/character_stats.ts'

import { natural_slot_for, type EquipmentMap } from './equipment_stage.ts'

type ComparisonItem = Readonly<Omit<EquippedItem, 'slot'>>

/** Compare the exact replacement selected by Equip, including signed rolls and pet power. */
export const equipment_comparison = (item: ComparisonItem, equipment: EquipmentMap) => {
  if (Object.values(equipment).some((equipped) => equipped.id === item.id)) return null
  const slot = natural_slot_for(item, equipment)
  const previous = slot ? equipment[slot] : undefined
  if (!previous) return null
  const rows = stat_names.flatMap((stat) => {
    const delta = item_stat_offset(item, stat) - item_stat_offset(previous, stat)
    return delta === 0 ? [] : [{ stat, delta }]
  })
  return { previous, rows }
}
