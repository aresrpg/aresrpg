// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spell_level_of, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import { catalog_spell, learned_spell_rank } from './catalog.ts'
import { decode, nonempty, object_schema, type Schema } from './gameplay_schema.ts'

/** A cast marked `if_learned` is skipped while its hero has not learned the spell; any other cast of
 * an unlearned spell stops the hero, so its author hears about it. */
type Cast = Readonly<{ type: 'cast'; spell: string; if_learned?: true }>
export type CombatStep =
  | (Cast &
      Readonly<{
        position?: 'best_damage'
        target: 'self' | 'nearest_enemy' | 'lowest_hp_enemy' | 'highest_damage_enemy' | 'trap_near_enemy'
      }>)
  | (Cast & Readonly<{ target: 'most_allies' | 'lowest_hp_ally'; position?: never }>)
  | Readonly<{
      type: 'strike'
      position?: 'best_damage'
      target: 'nearest_enemy' | 'lowest_hp_enemy' | 'highest_damage_enemy'
    }>
  /** The most damaging legal action among the weapon and every spell the hero has learned, whatever
   * its class: a profile that names no spell still fights with all of them. `repeat` spends the turn's
   * remaining action points on further attacks. */
  | Readonly<{
      type: 'attack'
      position?: 'best_damage'
      target: 'nearest_enemy' | 'lowest_hp_enemy' | 'highest_damage_enemy'
      repeat?: true
    }>
  | Readonly<{ type: 'move'; direction: 'retreat' | 'approach' }>
export type CombatCondition =
  | Readonly<{ type: 'always' }>
  | Readonly<{ type: 'hp_below'; percent: number }>
  | Readonly<{ type: 'enemy_within'; cells: number }>
  | Readonly<{ type: 'ally_present' }>
  | Readonly<{ type: 'ally_hp_below'; percent: number }>
  /** The hero has hit no enemy yet this turn: for what is worth doing only when no attack landed. */
  | Readonly<{ type: 'no_hit_yet' }>
export type CombatProfile = Readonly<{
  version: '1'
  intent: string
  combos: readonly Readonly<{ name: string; steps: readonly CombatStep[] }>[]
  rules: readonly Readonly<{ when: CombatCondition; combo: string }>[]
  fallback: 'end_turn' | 'awaiting_ai'
}>
const choices = (...values: readonly string[]): Schema => ({ oneOf: values.map((value) => ({ const: value })) })
const enemy_target = choices('nearest_enemy', 'lowest_hp_enemy', 'highest_damage_enemy')
const cast = { type: { const: 'cast' }, spell: nonempty, if_learned: { const: true } } as const
const cast_schema = (properties: Readonly<Record<string, Schema>>): Schema => ({
  ...object_schema({ ...cast, ...properties }),
  required: ['type', 'spell', 'target'],
})
const step_schema: Schema = {
  oneOf: [
    cast_schema({
      target: choices('self', 'nearest_enemy', 'lowest_hp_enemy', 'highest_damage_enemy', 'trap_near_enemy'),
      position: { const: 'best_damage' },
    }),
    cast_schema({ target: choices('most_allies', 'lowest_hp_ally') }),
    {
      ...object_schema({ type: { const: 'strike' }, target: enemy_target, position: { const: 'best_damage' } }),
      required: ['type', 'target'],
    },
    {
      ...object_schema({
        type: { const: 'attack' },
        target: enemy_target,
        position: { const: 'best_damage' },
        repeat: { const: true },
      }),
      required: ['type', 'target'],
    },
    object_schema({ type: { const: 'move' }, direction: choices('retreat', 'approach') }),
  ],
}
const percent: Schema = { type: 'integer', minimum: 1, maximum: 100 }
const condition_schema: Schema = {
  oneOf: [
    object_schema({ type: { const: 'always' } }),
    object_schema({ type: { const: 'no_hit_yet' } }),
    object_schema({ type: { const: 'hp_below' }, percent }),
    object_schema({ type: { const: 'ally_present' } }),
    object_schema({ type: { const: 'ally_hp_below' }, percent }),
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
const casts = (profile: CombatProfile): readonly Cast[] =>
  profile.combos.flatMap(({ steps }) => steps.flatMap((step) => (step.type === 'cast' ? [step] : [])))
const spell_names = (steps: readonly Cast[]): readonly string[] => [...new Set(steps.map(({ spell }) => spell))]
/** The spells whose absence stops the hero: every cast not marked `if_learned`. */
const required_spells = (profile: CombatProfile) => spell_names(casts(profile).filter((step) => !step.if_learned))

/** The `boost` step was removed (owner, 2026-11-23): an AI casts its boosts as its own `cast` steps.
 * A profile that still names it is refused by this code, at validation and at its next turn. */
export const BOOST_REMOVED = 'combat_boost_removed'
export const names_removed_step = (profile: unknown): boolean =>
  Array.isArray((profile as { combos?: unknown } | null)?.combos) &&
  (profile as { combos: readonly { steps?: unknown }[] }).combos.some(
    (combo) => Array.isArray(combo?.steps) && combo.steps.some((step) => (step as { type?: unknown })?.type === 'boost')
  )
/** Saved preferences are data. They never allocate capital, equip gear or authorize a fight. */
export const parse_combat_profile = (value: unknown): CombatProfile => {
  if (names_removed_step(value)) throw new Error(BOOST_REMOVED)
  const profile = decode<CombatProfile>(COMBAT_PROFILE_SCHEMA, value)
  const names = new Set(profile.combos.map(({ name }) => name))
  if (names.size !== profile.combos.length) throw new Error('duplicate_combo')
  if (spell_names(casts(profile)).some((name) => !catalog_spell(name))) throw new Error('unknown_combat_spell')
  if (profile.rules.some(({ combo }) => !names.has(combo))) throw new Error('unknown_combo')
  return profile
}
export const validate_profile_character = (
  profile: CombatProfile,
  character: Readonly<Pick<CharacterRow, 'classe' | 'level' | 'spells'>>
): readonly string[] => required_spells(profile).filter((name) => learned_spell_rank(name, character) === null)
export const validate_profile_checkpoint = (
  profile: CombatProfile,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  seat: bigint
): readonly string[] => required_spells(profile).filter((name) => !spell_level_of(checkpoint, seat, name))
