// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterEquipmentSlot } from '@aresrpg/immutable'
import { equip_refusal } from '@aresrpg/protocol/equipment'

import { profession_inventory } from './actor_inventory.ts'
import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { identifier, nonempty, object_schema } from './gameplay_schema.ts'
import { EQUIPMENT_SLOT_SCHEMA } from './equipment_actions.ts'

export type EquipOwnedAction = Readonly<{
  type: 'equip_owned'
  character_id: string
  item_type: string
  slot: CharacterEquipmentSlot
  order: 'lowest_id'
}>
export type ConsumeOwnedAction = Readonly<{
  type: 'consume_owned'
  character_id: string
  item_type: string
  amount: number
  order: 'largest_stack'
}>
export const ITEM_ACTION_SCHEMAS = [
  object_schema({
    type: { const: 'equip_owned' },
    character_id: identifier,
    item_type: nonempty,
    slot: EQUIPMENT_SLOT_SCHEMA,
    order: { const: 'lowest_id' },
  }),
  object_schema({
    type: { const: 'consume_owned' },
    character_id: identifier,
    item_type: nonempty,
    amount: { const: 1 },
    order: { const: 'largest_stack' },
  }),
] as const
export const select_owned_item = (action: EquipOwnedAction | ConsumeOwnedAction, context: GameplayContext) => {
  const character = owned_character(context, action.character_id)
  if (
    action.type === 'equip_owned' &&
    character.equipment.some(({ slot, item_type }) => slot === action.slot && item_type === action.item_type)
  )
    return { status: 'success' as const }
  const { inventory } = context.snapshot
  if (![inventory?.loaded, inventory?.listings, inventory?.trades].every(Boolean))
    return { status: 'waiting' as const, code: 'inventory_unavailable' }
  const equipment = Object.fromEntries(character.equipment.map((row) => [row.slot, row]))
  const [item] = profession_inventory(inventory, character.kiosk)
    .filter((row) => row.version && row.item_type === action.item_type)
    .filter((row) =>
      action.type === 'consume_owned'
        ? row.category === 'consumable'
        : equip_refusal({
            item: row,
            slot: action.slot,
            character_level: character.level,
            equipment,
            listed_ids: new Set(),
          }) === null
    )
    .toSorted((a, b) => (action.type === 'consume_owned' ? b.amount - a.amount : 0) || a.id.localeCompare(b.id))
  if (!item) return { status: 'failure' as const, code: 'item_unavailable' }
  return selected_item_action(action, item.id)
}
const selected_item_action = (action: EquipOwnedAction | ConsumeOwnedAction, item_id: string) => {
  return action.type === 'equip_owned'
    ? {
        status: 'action' as const,
        action: {
          kind: 'equip_item' as const,
          payload: { character_id: action.character_id, item_id, slot: action.slot },
        },
      }
    : {
        status: 'action' as const,
        action: {
          kind: 'use_consumable' as const,
          payload: { character_id: action.character_id, item_id, amount: action.amount },
        },
      }
}
