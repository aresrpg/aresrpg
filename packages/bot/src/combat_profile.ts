// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spell_level_of, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import spells from '../../../seed/content/spells.json'

import { decode, nonempty, object_schema, type Schema } from './gameplay_schema.ts'

export type CombatStep =
  | Readonly<{ type: 'cast'; spell: string; target: 'self' | 'nearest_enemy' | 'lowest_hp_enemy' | 'trap_near_enemy' }>
  | Readonly<{ type: 'strike'; target: 'nearest_enemy' | 'lowest_hp_enemy' }>
  | Readonly<{ type: 'move'; direction: 'retreat' | 'approach' }>
export type CombatCondition =
  | Readonly<{ type: 'always' }>
  | Readonly<{ type: 'hp_below'; percent: number }>
  | Readonly<{ type: 'enemy_within'; cells: number }>
export type CombatProfile = Readonly<{
  version: '1'
  intent: string
  combos: readonly Readonly<{ name: string; steps: readonly CombatStep[] }>[]
  rules: readonly Readonly<{ when: CombatCondition; combo: string }>[]
  fallback: 'end_turn' | 'awaiting_ai'
}>
const choices = (...values: readonly string[]): Schema => ({ oneOf: values.map((value) => ({ const: value })) })
const enemy_target = choices('nearest_enemy', 'lowest_hp_enemy')
const step_schema: Schema = {
  oneOf: [
    object_schema({
      type: { const: 'cast' },
      spell: nonempty,
      target: choices('self', 'nearest_enemy', 'lowest_hp_enemy', 'trap_near_enemy'),
    }),
    object_schema({ type: { const: 'strike' }, target: enemy_target }),
    object_schema({ type: { const: 'move' }, direction: choices('retreat', 'approach') }),
  ],
}
const condition_schema: Schema = {
  oneOf: [
    object_schema({ type: { const: 'always' } }),
    object_schema({ type: { const: 'hp_below' }, percent: { type: 'integer', minimum: 1, maximum: 100 } }),
    object_schema({
      type: { const: 'enemy_within' },
      cells: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    }),
  ],
}
export const COMBAT_PROFILE_SCHEMA = object_schema({
  version: { const: '1' },
  intent: nonempty,
  combos: {
    type: 'array',
    minItems: 1,
    items: object_schema({ name: nonempty, steps: { type: 'array', minItems: 1, items: step_schema } }),
  },
  rules: { type: 'array', minItems: 1, items: object_schema({ when: condition_schema, combo: nonempty }) },
  fallback: choices('end_turn', 'awaiting_ai'),
})
export const profile_spell_names = (profile: CombatProfile): readonly string[] => [
  ...new Set(
    profile.combos.flatMap(({ steps }) => steps.flatMap((step) => (step.type === 'cast' ? [step.spell] : [])))
  ),
]

/** Saved preferences are data. They never allocate capital, equip gear or authorize a fight. */
export const parse_combat_profile = (value: unknown): CombatProfile => {
  const profile = decode<CombatProfile>(COMBAT_PROFILE_SCHEMA, value)
  const names = new Set(profile.combos.map(({ name }) => name))
  if (names.size !== profile.combos.length) throw new Error('duplicate_combo')
  if (profile_spell_names(profile).some((name) => !spells.some((spell) => spell.name === name)))
    throw new Error('unknown_combat_spell')
  if (profile.rules.some(({ combo }) => !names.has(combo))) throw new Error('unknown_combo')
  return profile
}
export const validate_profile_character = (
  profile: CombatProfile,
  character: Readonly<Pick<CharacterRow, 'classe' | 'level' | 'spells'>>
): readonly string[] =>
  profile_spell_names(profile).filter((name) => {
    const spell = spells.find((row) => row.name === name)
    const level = character.spells[name] ?? 1
    return (
      !spell || spell.classe !== character.classe || spell.unlock_level > character.level || !spell.levels[level - 1]
    )
  })
export const validate_profile_checkpoint = (
  profile: CombatProfile,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  seat: bigint
): readonly string[] => profile_spell_names(profile).filter((name) => !spell_level_of(checkpoint, seat, name))
