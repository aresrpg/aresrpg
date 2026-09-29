// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  characteristic_values_cost,
  item_stat_center,
  pet_max_feeds,
  xp_for_level,
  type ClassName,
} from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { fold_equipment_stats } from '../game/character_stats.ts'
import { stat_budget, spell_budget, spell_point_cost, type SimulatorCharacter } from '../modules/simulator.ts'
import type { SeedItem } from '../content/catalog.ts'

import { ADVENTURE_ITEMS, ADVENTURE_PET_ITEM, ADVENTURE_COMPANION_ITEMS } from './content.ts'

export const adventure_inventory = (items: readonly SeedItem[]): readonly ItemRow[] =>
  Object.freeze(
    items.map((item) => ({
      id: item.item_type,
      name: item.name,
      item_type: item.item_type,
      category: item.category,
      level: item.level,
      amount: 1,
      kiosk: 'adventure',
      ...(item.category === 'pet' ? { pet_power: pet_max_feeds } : {}),
      stats: Object.fromEntries(
        Object.entries(item.stats?.max ?? {}).map(([stat, value]) => [stat, value + item_stat_center])
      ),
    }))
  )

export const ADVENTURE_INVENTORY = adventure_inventory([...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM])

/** The normal HUD consumes the normal read shape, derived without creating a wallet or session. */
export const adventure_character_row = (
  character: SimulatorCharacter,
  inventory: readonly ItemRow[] = [...ADVENTURE_INVENTORY, ...adventure_inventory(ADVENTURE_COMPANION_ITEMS)]
): CharacterRow => {
  const equipment = Object.entries(character.loadout).flatMap(([slot, item_type]) => {
    const item = inventory.find((item) => item.item_type === item_type)
    return item ? [{ ...item, slot }] : []
  })
  return {
    ...character,
    sex: character.male ? 'male' : 'female',
    experience: String(xp_for_level(character.level)),
    color_1: Number.parseInt(character.colors[0].slice(1), 16),
    color_2: Number.parseInt(character.colors[1].slice(1), 16),
    color_3: Number.parseInt(character.colors[2].slice(1), 16),
    available_points:
      stat_budget(character.level) - characteristic_values_cost(character.classe as ClassName, character)!,
    available_spell_points:
      spell_budget(character.level) -
      Object.values(character.spell_levels).reduce((sum, level) => sum + spell_point_cost(level), 0),
    spells: { ...character.spell_levels },
    jobs: {},
    kiosk: 'adventure',
    world: 'nauvis',
    equipment,
    folded_stats: fold_equipment_stats(equipment),
  }
}

export const adventure_available_inventory = (state: import('../modules/adventure.ts').AdventureState) => {
  if (state.encounter === 0) return []
  const other = state.selected_character_id === state.character?.id ? state.companion : state.character
  const equipped_elsewhere = Object.values(other?.loadout ?? {})
  const items = state.companion
    ? [...ADVENTURE_INVENTORY, ...adventure_inventory(ADVENTURE_COMPANION_ITEMS)]
    : ADVENTURE_INVENTORY
  return items.filter(({ item_type }) => !equipped_elsewhere.includes(item_type))
}
