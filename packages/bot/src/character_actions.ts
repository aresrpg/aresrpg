// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hero creation by the bot account (owner ruling 2026-11-21: "it's always the bot wallet"). The bot
// wallet pays the creation price and the gas, and the hero is born in its own personal kiosk.
import { worlds_source } from '@aresrpg/engine/data'
import { class_names } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { receipt_event, type Receipt } from '@aresrpg/sdk/cache'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_NAME_MIN_LENGTH,
  is_valid_character_name,
  normalize_character_name,
} from '@aresrpg/sdk/character-name'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { CHARACTER_FUNDING_MIST } from '@aresrpg/sdk/gas-budget'
import { transaction_resolution_error } from '@aresrpg/sdk/transaction-error'

import { gameplay_action, type GameplayContext } from './gameplay_context.ts'
import { decode, object_schema, nonempty, type Schema } from './gameplay_schema.ts'

// The colour range is character.move's MAX_COLOR_VALUE ABI bound, not a hosted limit.
const colour: Schema = { type: 'integer', minimum: 0, maximum: 0xffffff }
const schema = object_schema({
  name: nonempty,
  classe: { oneOf: class_names.map((classe) => ({ const: classe })) },
  male: { type: 'boolean' },
  color_1: colour,
  color_2: colour,
  color_3: colour,
})
const parse = (value: unknown) => {
  const payload = decode<CharacterCreateInput>(schema, value)
  if (!is_valid_character_name(payload.name)) throw new Error('invalid_character_name')
  return payload
}
const validate = (context: GameplayContext) => {
  const payload = parse(context.command.payload)
  const name = normalize_character_name(payload.name)
  // The registry is the game's; this only stops a second creation of a hero this wallet already holds.
  if (context.snapshot.characters.some((row) => row.name.toLowerCase() === name))
    throw new Error('character_name_taken')
  const first_world = worlds_source[0]?.world
  if (!first_world) throw new Error('entry_world_missing')
  // The SDK's own pre-submission error: the one wording list classifies it as a funding refusal.
  if (context.balance && BigInt(context.balance.balance_mist) < CHARACTER_FUNDING_MIST)
    throw transaction_resolution_error(new Error('insufficient SUI balance for the hero price and its fees'))
  return { input: { ...payload, first_world } }
}
/** The wallet-level character fragment of the one catalogue. */
export const CHARACTER_ACTIONS = {
  create_character: gameplay_action({
    description: `Create a new hero for this bot account in the entry world. The bot wallet pays the creation price of ${Number(CHARACTER_PRICE_MIST) / 1e9} SUI plus gas, and the hero is born in its own kiosk; no other wallet pays. The name follows the game rule: ${CHARACTER_NAME_MIN_LENGTH} to ${CHARACTER_NAME_MAX_LENGTH} printable characters without spaces, stored in lower case, unique in the game. The created hero then appears in the observed characters under that name.`,
    input_schema: schema,
    parse,
    validate,
    execute: (sdk, { first_world, ...input }) => sdk.create_character(input, first_world),
  }),
}
/** The receipt names the created hero; the creation is projected once the account shows that row. */
export const character_created_projected = (receipt: Receipt, characters: readonly CharacterRow[]) => {
  const created = receipt_event(receipt, '::character::CharacterCreated')?.character
  return typeof created === 'string' && characters.some(({ id }) => id === created)
}
