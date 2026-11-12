// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { characteristic_names } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { receipt_event, type Receipt } from '@aresrpg/sdk/cache'

import { profession_item } from './profession_catalog.ts'
import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { inventory_projected } from './actor_inventory.ts'

export type ConsumableBaseline = Readonly<{
  effect: string
  hp_ms: number
  checkpoint_ms: number
  available_points: number
  available_spell_points: number
}>
export const consumable_baseline = (context: GameplayContext): ConsumableBaseline => {
  const character = owned_character(context, String(context.command.payload.character_id))
  const item = context.snapshot.inventory?.items.find(({ id }) => id === context.command.payload.item_id)
  const effect = item && profession_item(item.item_type)?.consumable
  if (!effect) throw new Error('unsupported_consumable')
  return {
    effect: effect.type,
    hp_ms: character.hp_ms ?? 0,
    checkpoint_ms: character.at_ms ?? 0,
    available_points: character.available_points,
    available_spell_points: character.available_spell_points,
  }
}
export const consumable_noop = (effect: string, character: CharacterRow) => {
  if (effect === 'reset_stats') return characteristic_names.every((stat) => character[stat] === 0)
  if (effect === 'reset_spells') return Object.values(character.spells).every((rank) => rank <= 1)
  return false
}
const teleport_projected = (before: ConsumableBaseline, receipt: Receipt, character: CharacterRow) => {
  const event = receipt_event(receipt, '::world::CharacterTeleported')
  return Boolean(
    event &&
    [
      event.character === character.id,
      event.world === character.world,
      Number(event.x) === character.x,
      Number(event.z) === character.z,
      Number(character.at_ms) > before.checkpoint_ms,
    ].every(Boolean)
  )
}
/** No character version is projected yet: missing or equal-timestamp evidence stays blocked, never retries. */
export const consumable_projected = (
  before: ConsumableBaseline | undefined,
  receipt: Receipt,
  context: GameplayContext,
  character: CharacterRow
) => {
  if (!before || !inventory_projected(receipt, context.snapshot.inventory)) return false
  const checks: Record<string, () => boolean> = {
    heal: () => Number(character.hp_ms) > before.hp_ms,
    reset_stats: () =>
      characteristic_names.every((stat) => character[stat] === 0) &&
      character.available_points > before.available_points,
    reset_spells: () =>
      Object.keys(character.spells).length === 0 && character.available_spell_points > before.available_spell_points,
    city: () => teleport_projected(before, receipt, character),
    recall: () => teleport_projected(before, receipt, character),
  }
  return checks[before.effect]?.() ?? false
}
