// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_equipment_slots, type CharacterEquipmentSlot } from '@aresrpg/immutable'
import { equip_refusal } from '@aresrpg/protocol/equipment'
import type { create_agent_actions } from '@aresrpg/sdk/agent-actions'

import { consumable_noop } from './consumable_projection.ts'
import { profession_inventory } from './actor_inventory.ts'
import { profession_item } from './profession_catalog.ts'
import { owned_character, custody_of, gameplay_observed_ms, type GameplayContext } from './gameplay_context.ts'
import { object_schema, identifier, decode } from './gameplay_schema.ts'

type CharacterActions = ReturnType<typeof create_agent_actions>['character']
export const EQUIPMENT_SLOT_SCHEMA = { oneOf: character_equipment_slots.map((slot) => ({ const: slot })) }
type EquipPayload = Readonly<{ character_id: string; item_id: string; slot: CharacterEquipmentSlot }>
type ConsumePayload = Readonly<{ character_id: string; item_id: string; amount: number }>
const equip_schema = object_schema({ character_id: identifier, item_id: identifier, slot: EQUIPMENT_SLOT_SCHEMA })
const consume_schema = object_schema({
  character_id: identifier,
  item_id: identifier,
  amount: { const: 1 },
})
export const EQUIPMENT_ACTIONS = {
  equip_item: {
    description:
      'Equip an exact available owned item into an authored slot, replacing its current occupant atomically.',
    input_schema: equip_schema,
    parse: (value: unknown) => decode<EquipPayload>(equip_schema, value),
  },
  use_consumable: {
    description:
      'Consume one available item through its existing heal, reset, recall or city effect. Does not choose a healing policy; loot boxes use their separate action.',
    input_schema: consume_schema,
    parse: (value: unknown) => decode<ConsumePayload>(consume_schema, value),
  },
}
const available_character = (context: GameplayContext, character_id: string) => {
  const character = owned_character(context, character_id)
  if (character.custody !== 'kiosk' || character.active_fight || character.ambush)
    throw new Error('character_not_available')
  return character
}
export const validate_equip_item = (context: GameplayContext) => {
  const payload = EQUIPMENT_ACTIONS.equip_item.parse(context.command.payload)
  const character = available_character(context, payload.character_id)
  const item = profession_inventory(context.snapshot.inventory, character.kiosk).find(
    ({ id }) => id === payload.item_id
  )
  if (!item?.version) throw new Error('item_unavailable')
  const refusal = equip_refusal({
    item,
    slot: payload.slot,
    character_level: character.level,
    equipment: Object.fromEntries(character.equipment.map((row) => [row.slot, row])),
    listed_ids: new Set(),
  })
  if (refusal) throw new Error(refusal)
  if (character.equipment.some(({ id }) => id === item.id)) throw new Error('item_already_equipped')
  const previous = character.equipment.find(({ slot }) => slot === payload.slot)
  return {
    kind: 'equip_item' as const,
    input: {
      character_id: character.id,
      custody: custody_of(character),
      to_equip: [{ slot: payload.slot, item_id: item.id }],
      to_unequip: previous ? [{ slot: payload.slot, item_id: previous.id }] : [],
    },
  }
}
const consumable_effect = (item_type: string) => {
  const effect = profession_item(item_type)?.consumable
  if (!effect || effect.type === 'loot_box') throw new Error('unsupported_consumable')
  return effect
}
const consumable_world = (item_type: string, character: import('@aresrpg/protocol').CharacterRow, chain_ms: number) => {
  const effect = consumable_effect(item_type)
  if (consumable_noop(effect.type, character)) throw new Error('consumable_no_effect')
  const teleport = ['city', 'recall'].includes(effect.type)
  const rooted = character.dungeon_run ? teleport : (character.at_ms ?? 0) > chain_ms
  if (rooted) throw new Error('character_not_available')
  if (effect.type !== 'city') return {}
  if (!character.world) throw new Error('needs_resync')
  return { world: character.world }
}
export const validate_consumable = (context: GameplayContext) => {
  const payload = EQUIPMENT_ACTIONS.use_consumable.parse(context.command.payload)
  const character = available_character(context, payload.character_id)
  const items = profession_inventory(context.snapshot.inventory, character.kiosk)
  const item = items.find(({ id }) => id === payload.item_id)
  if (!item?.version || item.category !== 'consumable') throw new Error('item_unavailable')
  const world = consumable_world(item.item_type, character, Number(gameplay_observed_ms(context)))
  if (item.amount < payload.amount) throw new Error('insufficient_consumables')
  return {
    kind: 'use_consumable' as const,
    input: {
      character_id: character.id,
      item_id: item.id,
      item_type: item.item_type,
      amount: payload.amount,
      custody: custody_of(character),
      ...world,
    },
  }
}
export type EquipmentActionPlan = ReturnType<typeof validate_equip_item> | ReturnType<typeof validate_consumable>
export const equipment_executors = (actions: Pick<CharacterActions, 'equip' | 'use_consumable'>) => ({
  equip_item: actions.equip,
  use_consumable: actions.use_consumable,
})
export const equipment_projected = (payload: EquipPayload, character: import('@aresrpg/protocol').CharacterRow) =>
  character.equipment.some(({ slot, id }) => slot === payload.slot && id === payload.item_id)
