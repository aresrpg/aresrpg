// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { stat_names, type CharacterEquipmentSlot, type StatName } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { item_stat_offset } from '@aresrpg/protocol/character-stats'
import { equip_refusal } from '@aresrpg/protocol/equipment'

import { inventory_read, profession_inventory } from './actor_inventory.ts'
import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { identifier, nonempty, object_schema } from './gameplay_schema.ts'
import { character_free, EQUIPMENT_SLOT_SCHEMA } from './equipment_actions.ts'

/** A ranked order wears the best owned item of the slot and fails when nothing owned is better than
 * what the slot wears: `highest_level` by item level, `best_stats` by the listed item stats as they
 * rolled, the most wanted first. An item that adds none of them never beats an empty slot. */
type RankedOrder =
  | Readonly<{ item_type?: never; order: 'highest_level' }>
  | Readonly<{ item_type?: never; order: 'best_stats'; stats: readonly StatName[] }>
export type EquipOwnedAction = Readonly<{
  type: 'equip_owned'
  character_id: string
  slot: CharacterEquipmentSlot
}> &
  (Readonly<{ item_type: string; order: 'lowest_id' }> | RankedOrder)
export type ConsumeOwnedAction = Readonly<{
  type: 'consume_owned'
  character_id: string
  item_type: string
  amount: number
  order: 'largest_stack'
}>
const equip = { type: { const: 'equip_owned' }, character_id: identifier, slot: EQUIPMENT_SLOT_SCHEMA } as const
export const ITEM_ACTION_SCHEMAS = [
  object_schema({ ...equip, item_type: nonempty, order: { const: 'lowest_id' } }),
  object_schema({ ...equip, order: { const: 'highest_level' } }),
  object_schema({
    ...equip,
    order: { const: 'best_stats' },
    stats: { type: 'array', uniqueItems: true, items: { oneOf: stat_names.map((stat) => ({ const: stat })) } },
  }),
  object_schema({
    type: { const: 'consume_owned' },
    character_id: identifier,
    item_type: nonempty,
    amount: { const: 1 },
    order: { const: 'largest_stack' },
  }),
] as const
type OwnedAction = EquipOwnedAction | ConsumeOwnedAction
type Ranked = Extract<EquipOwnedAction, RankedOrder>
type Row = Readonly<Pick<ItemRow, 'id' | 'item_type' | 'level' | 'amount' | 'category' | 'stats' | 'pet_power'>>
const ranked = (action: OwnedAction): action is Ranked => action.item_type === undefined
/** What a ranked order values in an item, the most important first. */
const worth = (action: Ranked, row: Row): readonly number[] =>
  action.order === 'best_stats' ? action.stats.map((stat) => item_stat_offset(row, stat)) : [row.level]
/** An empty slot: below every item level, and equal to an item that adds none of the listed stats. */
const bare = (action: Ranked): readonly number[] => (action.order === 'best_stats' ? action.stats.map(() => 0) : [-1])
/** The first difference decides, so an earlier entry outweighs every later one. */
const compare = (left: readonly number[], right: readonly number[]): number =>
  left.map((value, index) => value - right[index]!).find((difference) => difference !== 0) ?? 0
/** A ranked order never blocks its tree: it wears nothing while its hero cannot change gear, and an
 * order that lists no stat ranks nothing, so it reads no inventory. */
const idle = (action: Ranked, character: CharacterRow) =>
  !character_free(character) || (action.order === 'best_stats' && !action.stats.length)
/** The exact authored item, or for a ranked order anything strictly better than what the slot wears. */
const requested = (action: OwnedAction, row: Row, worn: Row | undefined) =>
  ranked(action)
    ? compare(worth(action, row), worn ? worth(action, worn) : bare(action)) > 0
    : row.item_type === action.item_type
const preferred = (action: OwnedAction) => (a: Row, b: Row) =>
  (action.type === 'consume_owned' ? b.amount - a.amount : 0) ||
  (ranked(action) ? compare(worth(action, b), worth(action, a)) : 0) ||
  a.id.localeCompare(b.id)
/** The owned items an action may take, best first: certified, wanted, and passing the equip refusals. */
const candidates = (action: OwnedAction, character: CharacterRow, worn: Row | undefined, items: readonly ItemRow[]) => {
  const equipment = Object.fromEntries(character.equipment.map((row) => [row.slot, row]))
  const usable = (item: ItemRow) =>
    action.type === 'consume_owned'
      ? item.category === 'consumable'
      : equip_refusal({
          item,
          slot: action.slot,
          character_level: character.level,
          equipment,
          listed_ids: new Set(),
        }) === null
  return items
    .filter((row) => row.version && requested(action, row, worn))
    .filter(usable)
    .toSorted(preferred(action))
}
export const select_owned_item = (action: OwnedAction, context: GameplayContext) => {
  const character = owned_character(context, action.character_id)
  const worn = character.equipment.find(({ slot }) => action.type === 'equip_owned' && slot === action.slot)
  if (worn && worn.item_type === action.item_type) return { status: 'success' as const }
  if (ranked(action) && idle(action, character)) return { status: 'failure' as const, code: 'item_unavailable' }
  const { inventory } = context.snapshot
  if (!inventory_read(inventory)) return { status: 'waiting' as const, code: 'inventory_unavailable' }
  const [item] = candidates(action, character, worn, profession_inventory(inventory, character.kiosk))
  if (!item) return { status: 'failure' as const, code: 'item_unavailable' }
  return selected_item_action(action, item.id)
}
const selected_item_action = (action: OwnedAction, item_id: string) => {
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
