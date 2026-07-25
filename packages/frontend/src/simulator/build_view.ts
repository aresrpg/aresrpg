// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/build_view.ts — the PURE projections the character/mob editors render, and nothing else.
//
// Every fact here is READ from an existing home, never re-derived: the spell rows are the grimoire's own
// projection (`spellbook-data.js grimoire` — the same rows the in-game spellbook lists), the affordability is
// the reducer's own `spell_points_left` (the same number its `spell_level_set` arm clamps with), and the
// equipment vocabulary is the paper doll's, reached through the content door. This module owns exactly one
// thing: the JOIN between the simulator's persisted keys and those homes.
//
// The join exists because the two sides key spells differently, deliberately: the simulator persists by
// `name_key` (stable across republishes), the grimoire keys by the SpellTemplate object id (the spend PTB's
// target). Neither is wrong; the translation belongs here rather than in either home.

import { class_spells } from '../game/screens/hud/fight-spells.js'
import { grimoire } from '../game/screens/hud/spellbook-data.js'

import { spell_budget, spell_cost, spell_points_left, spells_spent, type SimCharacter } from './reducer'

/** One chain SpellLevel, as far as this module reads it. */
type SpellLevel = { min_char_level: number }

/** A grimoire row, as far as this module reads it. */
export type GrimoireRow = {
  id: string
  name: string
  name_key: string
  icon: string
  color: string
  levels: readonly SpellLevel[]
  unlock_tier: number
  unlocked: boolean
  current_level: number
  subline_kind: string
  subline_descriptor: string
}

/** One selectable level in a spell's dropdown: what it costs in total, and whether the budget can pay it. */
export type SpellLevelOption = { level: number; cost: number; affordable: boolean }

/**
 * The highest level of a spell this character may reach — the SAME two chain gates `raise_spell_level`
 * asserts: the spell must be unlocked, and each level of the template carries its own `min_char_level`.
 * Never below 1: level 1 is the free baseline an unlocked spell always sits at.
 */
export const reachable_level = (row: Readonly<GrimoireRow>, char_level: number): number =>
  Math.max(1, row.levels.filter(({ min_char_level }) => min_char_level <= char_level).length)

/**
 * The options a spell's level dropdown offers. EVERY reachable level is listed — an unaffordable one is
 * shown DISABLED with its cost rather than hidden, because "you cannot afford level 5 yet" is the answer the
 * player is looking for; a silently short list is not.
 */
export const spell_level_options = (
  character: Readonly<SimCharacter>,
  row: Readonly<GrimoireRow>
): SpellLevelOption[] => {
  const left = spell_points_left(character, row.name_key)
  return Array.from({ length: reachable_level(row, character.level) }, (_, index) => index + 1).map((level) => ({
    level,
    cost: spell_cost(level),
    affordable: spell_cost(level) <= left,
  }))
}

/** The spell points this character has NOT spent — the editor's header figure. */
export const spell_points_free = (character: Readonly<SimCharacter>): number =>
  Math.max(0, spell_budget(character.level) - spells_spent(character))

/**
 * This character's spell rows, straight off the grimoire projection with the simulator's own invested levels
 * folded in. Rows whose template has no deployment receipt yet (`object_id === null`) are dropped rather than
 * collapsed onto one key — a shared null key would cross-assign one spell's level to another's row.
 */
export const character_spell_rows = (character: Readonly<SimCharacter>): GrimoireRow[] => {
  const invested = Object.fromEntries(
    (class_spells(character.class_id) as { object_id: string | null; name_key: string }[])
      .filter(({ object_id }) => !!object_id)
      .map(({ object_id, name_key }) => [String(object_id), character.spell_levels[name_key] ?? 1])
  )
  const rows = grimoire(character.class_id, character.level, spell_points_free(character), invested) as {
    rows: GrimoireRow[]
  }
  return rows.rows.filter((row) => row.unlocked)
}
