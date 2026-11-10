// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  characteristic_names,
  characteristic_spending_quote,
  is_class_name,
  type CharacteristicName,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { object_schema, identifier, decode } from './gameplay_schema.ts'
import { owned_character, custody_of, type GameplayContext } from './gameplay_context.ts'

// Character capital, natural characteristics and api::raise_stat points use the existing Move u16 ABI.
const MAX_CHARACTERISTIC = 65_535
export type StatSpending = Readonly<Partial<Record<CharacteristicName, number>>>
type Payload = Readonly<{ character_id: string; spending: StatSpending }>
const schema = object_schema({
  character_id: identifier,
  spending: {
    ...object_schema(
      Object.fromEntries(
        characteristic_names.map((stat) => [
          stat,
          { type: 'integer' as const, minimum: 1, maximum: MAX_CHARACTERISTIC },
        ])
      )
    ),
    required: [],
    minProperties: 1,
  },
})
export const RAISE_STATS_ACTION = Object.freeze({
  description:
    'Spend exact available character capital through the SDK class-cost rules. Supply positive spending for vitality, wisdom, strength, intelligence, chance or agility; omit other stats. This never allocates spell points. Observe the resulting raised stats before continuing.',
  input_schema: schema,
  parse: (value: unknown) => decode<Payload>(schema, value),
})
export const validate_stat_allocation = (context: GameplayContext) => {
  const payload = RAISE_STATS_ACTION.parse(context.command.payload)
  const character = owned_character(context, payload.character_id)
  if (character.custody !== 'kiosk' || character.active_fight) throw new Error('character_not_available')
  const { classe, available_points } = character
  if (
    !is_class_name(classe) ||
    !Number.isSafeInteger(available_points) ||
    available_points < 0 ||
    available_points > MAX_CHARACTERISTIC
  )
    throw new Error('needs_resync')
  const spending = Object.values(payload.spending).reduce((sum, points) => sum + points, 0)
  if (spending > available_points) throw new Error('insufficient_character_points')
  const quote = characteristic_spending_quote(classe, character, payload.spending)
  if (!quote || characteristic_names.some((stat) => character[stat] + quote.gains[stat] > MAX_CHARACTERISTIC))
    throw new Error('invalid_stat_spending')
  return {
    kind: 'raise_stats' as const,
    input: { character_id: character.id, spending: payload.spending, custody: custody_of(character) },
  }
}
export type StatAllocationPlan = ReturnType<typeof validate_stat_allocation>
export type StatBaseline = Pick<CharacterRow, 'classe' | 'available_points' | CharacteristicName>
export const stat_baseline = (character: CharacterRow): StatBaseline => ({
  classe: character.classe,
  available_points: character.available_points,
  vitality: character.vitality,
  wisdom: character.wisdom,
  strength: character.strength,
  intelligence: character.intelligence,
  chance: character.chance,
  agility: character.agility,
})

/** Only the indexed row completes reconciliation; no receipt or command mutates observed stats. */
export const stats_projected = (before: StatBaseline | undefined, spending: StatSpending, character: CharacterRow) => {
  if (!before || !is_class_name(before.classe)) return false
  const quote = characteristic_spending_quote(before.classe, before, spending)
  return (
    quote !== null &&
    character.classe === before.classe &&
    character.available_points === before.available_points - quote.cost &&
    characteristic_names.every((stat) => character[stat] === before[stat] + quote.gains[stat])
  )
}
