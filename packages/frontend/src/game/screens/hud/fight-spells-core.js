// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT SPELL CORE — the PURE projection algebra behind fight-spells.js. Kept in its own module (no
// seed_manifest / no glob) so it is testable in isolation AND so importing it can never trip the
// content-artifact load. fight-spells.js does the effectful wiring (glob the corpus, read the seed
// receipt) and calls build_fight_spells with the loaded rows.

import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'
import { encode_status_value, is_signed_status_kind } from '@aresrpg/fight/fight_status_snapshot'

import { build_spell_state_registry, resolve_spell_state_row } from '../../data/spell-text.js'

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
  // Wave-12 retro mechanics (spell_effect.move:74-84). Unnamed here, EVERY one of them read as the loud
  // `? 32` canary on a live effect badge, because seven of them are recordable fighter statuses (#1049).
  18: 'RESET_POSITIONS',
  30: 'GEOMETRIC_PUSH',
  31: 'CRITICAL_FAILURE',
  32: 'DAMAGE_TO_HEAL',
  33: 'FORCED_DEATH',
  34: 'TIMED_PAYLOAD',
  35: 'NAMED_DAMAGE_STACK',
  36: 'STANCE',
  37: 'REACTIVE_PUNISHMENT',
  38: 'EROSION',
  39: 'DAMAGE_REDIRECT',
  40: 'POOL_SHIELD',
}
const element_names = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'air', 255: 'neutral' }
const shape_names = { 0: 'POINT', 1: 'CIRCLE', 2: 'CROSS', 3: 'LINE', 4: 'TBAR', 5: 'RING', 6: 'ALLMAP', 7: 'CONE' }

export const name_key = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

export const project_spell_effect = (effect, state_registry = null) => {
  const state = [22, 23].includes(Number(effect?.kind))
    ? resolve_spell_state_row(state_registry, effect?.state_id ?? effect?.value)
    : null
  return {
    ...effect,
    kind_id: effect.kind,
    kind: kind_names[effect.kind] ?? String(effect.kind),
    ...(effect.element != null
      ? { element_id: effect.element, element: element_names[effect.element] ?? String(effect.element) }
      : {}),
    ...(state ? { state } : {}),
    base: effect.value ?? 0,
    // THE AUTHORED BAND (#951). The corpus wire row carries its magnitude as `value` / `value_max`; every
    // display surface reads `damageMin` / `damageMax` (seed-effect-line's `seed_effect_value`, the one grammar
    // behind the tooltip, the grimoire and the encyclopedia). Nothing mapped the two, so every magnitude row
    // rendered its em-dash "no honest bounds" fallback — `− Earth damage · crit 5`, a spell tooltip with no
    // damage in it. A row with no `value` at all keeps that em dash rather than inventing a 0-0 band.
    ...(effect.value != null
      ? { damageMin: Number(effect.value), damageMax: Number(effect.value_max ?? effect.value) }
      : {}),
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
  }
}

export const project_spell_level = (level, state_registry = null) => {
  const base_effects = level.effects ?? []
  const critical_effects = level.crit_effects ?? []
  const kind_occurrence = (rows, index) =>
    rows.slice(0, index).filter((candidate) => candidate.kind === rows[index]?.kind).length
  const effects = base_effects.map((effect, index) => {
    const occurrence = kind_occurrence(base_effects, index)
    const critical = critical_effects.filter((candidate) => candidate.kind === effect.kind)[occurrence]
    const decoded = project_spell_effect(effect, state_registry)
    return critical
      ? { ...decoded, crit_base: critical.value ?? 0, crit_effect: project_spell_effect(critical, state_registry) }
      : decoded
  })
  // A critical list replaces the base list on-chain. Same-kind occurrences already ride their base row as the
  // compact `crit N` clause; any extra occurrence still needs an ordinary sibling row so the tooltip remains
  // lossless without inventing an "on critical" prefix. A non-critable level cannot expose an impossible row.
  const critical_only_effects =
    Number(level.crit_rate) > 0
      ? critical_effects
          .filter((critical, index) => {
            const occurrence = kind_occurrence(critical_effects, index)
            const base_count = base_effects.filter((effect) => effect.kind === critical.kind).length
            return occurrence >= base_count
          })
          .map((effect) => project_spell_effect(effect, state_registry))
      : []
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
    effects: [...effects, ...critical_only_effects],
  }
}

// ── #1741 — WHICH SPELLS NEED A VICTIM UNDER THE AIM ─────────────────────────────────────────────────────
// The effect kinds whose payload lands on the CELL rather than on whoever stands there: a trap, a glyph, a
// teleport and a board reset are all meant for empty ground, so a spell carrying one keeps its empty-cell aim
// however it is otherwise composed (a damage+teleport jump-strike must still be able to land on open floor).
const CELL_TARGET_KINDS = new Set(['PLACE_TRAP', 'PLACE_GLYPH', 'TELEPORT', 'RESET_POSITIONS'])
/** Zero-area = the footprint IS the aimed cell (project_spell_effect's POINT/0 default). */
const zero_area = (effect) => (effect?.area_size ?? 0) === 0 && (effect?.area_shape ?? 'POINT') === 'POINT'

/**
 * Does this spell LEVEL require a visible occupant under the aim? (#1741, the donor-era rule: a single-target
 * damage spell refuses empty ground — targetless whiffing is not a mechanic there; invisible-hunting is
 * deliberately the AoE/trap game.) TRUE only for the ruled scope: a zero-area spell that damages, is not
 * `free_cell`, and carries no cell-semantics effect. Every other spell — AoE, traps, glyphs, teleports, pure
 * buffs — keeps today's permissive aim. The verdict feeds `cast_range_set_dungeon`'s `occupant_cells` (the ONE
 * castability derivation) and the flush's `strike_flush_illegal`, never a second legality rule. Pure.
 * @param {{ free_cell?: boolean, effects?: { kind?: string, area_shape?: string, area_size?: number }[] } | null
 *   | undefined} level a projected spell level (project_spell_level)
 * @returns {boolean}
 */
export const cast_requires_occupant = (level) => {
  const effects = level?.effects ?? []
  if (!effects.length || level?.free_cell === true) return false
  if (!effects.some((effect) => effect?.kind === 'DAMAGE')) return false
  if (effects.some((effect) => CELL_TARGET_KINDS.has(String(effect?.kind)))) return false
  return effects.every(zero_area)
}

// ── THE PUBLISHED CORPUS SPEAKS THE AUTHORED DIALECT (#1049) ──────────────────────────────────────────────
// `spell_corpus.json` states a signed ALTER_STAT/ALTER_RESIST magnitude the way a designer writes it: `+20`
// strength, `−8` strength. The CHAIN cannot — `Effect.value` is a u64 — so the mint CENTRES those two kinds at
// 32768 (`participant::alter_delta`), and `@aresrpg/sim`'s normalizer, whose other caller feeds it rows read
// straight off a minted MobTemplate, decodes that centering at its door. Handing it the authored dialect made
// every one of the corpus' 912 alter rows fold as its own 32768-complement: a `+20 Strength · 5 turns` buff
// became a −32748 Strength DEBUFF in every prediction the client runs. Measured against the live blob
// 2026-07-26 — 906 plain-positive and 6 negative alter rows, ZERO centered — so the dialect is unambiguous.
// The door that KNOWS which dialect it holds states it: authored rows are minted here, once, on the way to the
// sim. Display keeps reading the authored row (`project_spell_effect` below), the ONE home for the signed
// magnitude a player reads.
//
// EXPORTED because it is the ONE authored→chain door, not this file's private detail (#1166). The simulator's
// START fold opens its local chain with corpus rows too (`simulator/fight_start.js`), and handing that same
// normalizer the AUTHORED dialect folded every alter row as its 32768-complement: a `+42 Raw Damage` buff
// became `-32726` on the turn card the moment the receipt retired the (correctly minted) prediction. The
// centering itself has ONE home — `fight_status_snapshot.encode_status_value`, the exact inverse of the
// decoder every wire door reads through — so this file states WHICH ROWS are authored, never how to center.

const minted_effect = (effect) => {
  if (!is_signed_status_kind(effect?.kind)) return effect
  const mint = (value) => (value == null ? value : encode_status_value(effect.kind, Number(value)))
  return {
    ...effect,
    value: mint(effect.value),
    ...(effect.value_max != null ? { value_max: mint(effect.value_max) } : {}),
  }
}

const minted_level = (level) => ({
  ...level,
  ...(level?.effects ? { effects: level.effects.map(minted_effect) } : {}),
  ...(level?.crit_effects ? { crit_effects: level.crit_effects.map(minted_effect) } : {}),
})

/**
 * ONE authored corpus spell → the row the CHAIN holds: the two signed kinds (ALTER_STAT · ALTER_RESIST) ride
 * centered at 32768, everything else verbatim. Every door that hands corpus rows to `@aresrpg/sim`'s
 * chain-dialect normalizer passes them through here first.
 * @param {Record<string, any>} spell an authored corpus row
 * @returns {Record<string, any>} the same row in the chain's dialect
 */
export const mint_authored_spell = (spell) => ({ ...spell, levels: (spell?.levels ?? []).map(minted_level) })

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
  const state_registry = build_spell_state_registry(corpus)
  const templates = normalize_chain_spell_corpus(corpus.map(mint_authored_spell))
  const spells = corpus
    .map((spell) => ({
      object_id: spell.object_id ?? null,
      class: spell.classType,
      unlock_level: spell.unlock,
      name: spell.name,
      name_key: name_key(spell.name),
      description_key: spell.description_key,
      description: spell.description,
      i18n: spell.i18n,
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
      levels: (spell.levels ?? []).map((level) => project_spell_level(level, state_registry)),
    }))
    .sort((left, right) => left.class.localeCompare(right.class) || left.unlock_level - right.unlock_level)
  return { spells, templates }
}
