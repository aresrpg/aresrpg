// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'
import type { Receipt } from '@aresrpg/sdk/cache'

import { object_schema, identifier, nonempty, decode } from './gameplay_schema.ts'
import { owned_character, custody_of, type GameplayContext } from './gameplay_context.ts'
import { catalog_spell, learned_spell_rank, spell_upgrade_quote } from './spell_catalog.ts'

type Payload = Readonly<{ character_id: string; spell: string }>
const schema = object_schema({ character_id: identifier, spell: nonempty })
export const RAISE_SPELL_ACTION = Object.freeze({
  description:
    'Spend spell points to raise one learned spell by one rank on an owned kiosk-held character. Rank n to n+1 costs n spell points; the authored rank count is the cap. Discover exact spell names, unlock levels, learned ranks, point balances and upgrade quotes with bot_observe spells. Requires current class/unlock eligibility, sufficient points and no active fight. Uses the ordinary SDK transaction lane; inspect bot_status and observe the upgraded rank before continuing. Never retry an executed or uncertain transaction.',
  input_schema: schema,
  parse: (value: unknown) => {
    const payload = decode<Payload>(schema, value)
    if (!catalog_spell(payload.spell)) throw new Error('unknown_combat_spell')
    return payload
  },
})
export const validate_spell_allocation = (context: GameplayContext) => {
  const payload = RAISE_SPELL_ACTION.parse(context.command.payload)
  const character = owned_character(context, payload.character_id)
  if (character.custody !== 'kiosk' || character.active_fight) throw new Error('character_not_available')
  if (learned_spell_rank(payload.spell, character) === null) throw new Error('spell_not_learned')
  const quote = spell_upgrade_quote(payload.spell, character)
  if (!quote) throw new Error('spell_rank_capped')
  if (!Number.isSafeInteger(character.available_spell_points) || character.available_spell_points < 0)
    throw new Error('needs_resync')
  if (character.available_spell_points < quote.cost) throw new Error('insufficient_spell_points')
  return {
    kind: 'raise_spell' as const,
    input: { ...payload, custody: custody_of(character) },
  }
}
export type SpellAllocationPlan = ReturnType<typeof validate_spell_allocation>
/** Native completion versions admit later owner edits without requiring an intermediate spellbook.
 * Missing or partial projections remain unknown, even when their values happen to match. */
export const spell_projected = (receipt: Receipt, character: CharacterRow): boolean => {
  const written = receipt.Transaction?.effects?.changedObjects?.find(
    (row) => row.objectId === character.id && row.outputState === 'ObjectWrite'
  )
  const expected = String(written?.outputVersion ?? '')
  const observed = character.version ?? ''
  return [expected, observed].every((version) => /^\d+$/.test(version)) && BigInt(observed) >= BigInt(expected)
}
