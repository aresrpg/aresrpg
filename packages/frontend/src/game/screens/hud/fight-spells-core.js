// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT SPELL CORE — the PURE projection algebra behind fight-spells.js. Kept in its own module (no
// seed_manifest / no glob) so it is testable in isolation AND so importing it can never trip the
// content-artifact load. fight-spells.js does the effectful wiring (glob the corpus, read the seed
// receipt) and calls build_fight_spells with the loaded rows.

import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'

const kind_names = {
  0: 'DAMAGE',
  1: 'PERCENT_LIFE',
  2: 'LIFE_STEAL',
  3: 'CASTER_DAMAGE',
  4: 'PUNISHMENT',
  5: 'HEAL',
  6: 'GIVE_POINTS',
  7: 'REMOVE_POINTS',
  8: 'STEAL_POINTS',
  9: 'ALTER_STAT',
  10: 'STEAL_STAT',
  11: 'ALTER_RESIST',
  12: 'PUSH',
  13: 'PULL',
  14: 'TELEPORT',
  15: 'SWAP',
  16: 'CARRY',
  17: 'THROW',
  19: 'PLACE_TRAP',
  20: 'PLACE_GLYPH',
  21: 'APPLY_DOT',
  22: 'APPLY_STATE',
  23: 'REMOVE_STATE',
  24: 'REDUCE_DAMAGE',
  25: 'REFLECT_DAMAGE',
  26: 'DISPEL',
  27: 'INVISIBILITY',
  28: 'REVEAL',
  29: 'RETURN_SPELL',
}
const element_names = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'air', 255: 'neutral' }
const shape_names = { 0: 'POINT', 1: 'CIRCLE', 2: 'CROSS', 3: 'LINE', 4: 'TBAR', 5: 'RING', 6: 'ALLMAP', 7: 'CONE' }

export const name_key = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

export const project_spell_effect = (effect) => ({
  ...effect,
  kind_id: effect.kind,
  kind: kind_names[effect.kind] ?? String(effect.kind),
  ...(effect.element != null
    ? { element_id: effect.element, element: element_names[effect.element] ?? String(effect.element) }
    : {}),
  base: effect.value ?? 0,
  chance: effect.chance ?? 100,
  turns: effect.turns ?? 0,
  target_filter: effect.target_filter ?? 0,
  flags: effect.flags ?? 0,
  area_shape_id: effect.area_shape ?? 0,
  area_shape: shape_names[effect.area_shape ?? 0] ?? 'POINT',
  area_size: effect.area_size ?? 0,
  ...(effect.zone != null
    ? {
        zone: {
          ...effect.zone,
          shape_id: effect.zone.shape ?? 0,
          shape: shape_names[effect.zone.shape ?? 0] ?? 'POINT',
          size: effect.zone.size ?? 0,
        },
      }
    : {}),
})

export const project_spell_level = (level) => {
  const critical_by_kind = new Map()
  for (const critical of level.crit_effects ?? []) {
    const rows = critical_by_kind.get(critical.kind) ?? []
    critical_by_kind.set(critical.kind, [...rows, critical])
  }
  const occurrences = new Map()
  const effects = (level.effects ?? []).map((effect) => {
    const occurrence = occurrences.get(effect.kind) ?? 0
    occurrences.set(effect.kind, occurrence + 1)
    const critical = critical_by_kind.get(effect.kind)?.[occurrence]
    const decoded = project_spell_effect(effect)
    return critical
      ? { ...decoded, crit_base: critical.value ?? 0, crit_effect: project_spell_effect(critical) }
      : decoded
  })
  return {
    min_char_level: level.min_char_level,
    ap: level.ap_cost,
    mp: 0,
    range: [level.range_min, level.range_max],
    modifiable_range: level.modifiable_range ?? false,
    line_of_sight: level.line_of_sight !== false,
    linear: level.line_launch ?? false,
    free_cell: level.free_cell ?? false,
    casts_per_turn: level.casts_per_turn,
    casts_per_target: level.casts_per_target,
    cooldown: level.cooldown_turns,
    crit_rate: level.crit_rate,
    effects,
  }
}

/**
 * Project the runtime-loaded spell corpus (the merged blob the seed ceremony publishes — authored rows joined
 * to the deployment's on-chain object ids) into fight-spell rows. PURE and total: an empty/absent corpus
 * yields [] (the loud degrade lives at the effectful edge — spell_corpus.js — never here). A row with no
 * `object_id` (a corpus published before its deployment receipt) keeps its display facts with object_id null:
 * castable only once the receipt ships, but the encyclopedia still renders it.
 * @param {Array<Record<string, any>>} spell_corpus  the merged corpus rows (from get_spell_corpus)
 * @returns {{ spells: Array<object>, templates: Map<string, object> }}
 */
export function build_fight_spells(spell_corpus) {
  const corpus = Array.isArray(spell_corpus) ? spell_corpus : []
  const templates = normalize_chain_spell_corpus(corpus)
  const spells = corpus
    .map((spell) => ({
      object_id: spell.object_id ?? null,
      class: spell.classType,
      unlock_level: spell.unlock,
      name: spell.name,
      name_key: name_key(spell.name),
      // THE SPELL-ART KEY (issue #884) — the asset host keys spell icons by the corpus row's own id
      // (`<class>_<name>`, e.g. `spells/rojin_greed.webp`), NOT by name_key. Probed 2026-07-26 against the live
      // host: `spells/rojin_greed.webp` → 200 while `spells/greed.webp` → 404, and the content house's own upload
      // manifest lists all 240 keys in the id shape. name_key stays the display/selection identity; this is the
      // ONE home for "which file is this spell's art", so every icon surface derives it here instead of
      // re-deriving a key that resolves to nothing.
      icon_key: spell.id ?? name_key(spell.name),
      template_id: spell.id,
      template: templates.get(spell.id),
      kind: spell.role === 'heal' ? 'heal' : 'dmg',
      role: spell.role ?? 'damage',
      element: spell.element ?? null,
      levels: (spell.levels ?? []).map(project_spell_level),
    }))
    .sort((left, right) => left.class.localeCompare(right.class) || left.unlock_level - right.unlock_level)
  return { spells, templates }
}
