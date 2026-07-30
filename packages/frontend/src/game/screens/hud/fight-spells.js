// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT SPELL RESOLVER — the ONE home mapping a character's (class, level) to the on-chain spells it can cast.
//
// Rows derive from the authored spell corpus, fetched at RUNTIME as ONE published asset-host blob
// (game/data/spell_corpus.js — the same asset-url pattern the mob catalog uses). Each row carries the spell's
// `object_id` — the `aresrpg_spells::spell_template::SpellTemplate` SHARED object the `act_cast` PTB references
// (§7) — plus display facts and every authored SpellLevel. The blob is the seed ceremony's merged projection
// (authored rows joined to the deployment receipt); the client never bundles the content. The chain is the
// referee: it enforces AP cost, range, LoS and the per-level `min_char_level` unlock at cast time; the bar only
// SHOWS what a character can reach (unlock_level ≤ char level), never gates beyond UX.
//
// One home per fact: the fight bar (DeckCluster via fight.js spell_card), the board's cast gate + dispatch
// (DungeonBoard) and the voxel cast wash (voxel_fight_folds) all resolve spell facts + the cast object id from
// HERE, keyed by `name_key`. A class with no seeded spells resolves to [] (weapon + move only — the honest
// on-chain state), so nothing renders a stub.
//
// The corpus loads ASYNC at boot (load_spell_corpus, main.tsx). Reads are LIVE: the projection below re-derives
// when the loaded rows change and stays [] until the blob arrives — an absent/unpublished blob DEGRADES loudly
// (one console.error, at the loader) and leaves every surface inert, never crashing the client (issue #106).

import { get_spell_corpus } from '../../data/spell_corpus.js'

import { build_fight_spells } from './fight-spells-core.js'

// Re-exported from the pure core so existing consumers keep importing them from here (single public door).
export { cast_requires_occupant, project_spell_effect, project_spell_level } from './fight-spells-core.js'

// LIVE projection over the runtime-loaded corpus. get_spell_corpus() returns the same array reference until the
// blob (re)loads, so this memo re-derives exactly once per corpus change — the O(1) read the hot paths need.
let cached_corpus = null
let cached = { spells: [], by_key: new Map() }
function project() {
  const corpus = get_spell_corpus()
  if (corpus === cached_corpus) return cached
  cached_corpus = corpus
  const { spells } = build_fight_spells(corpus)
  // ONE index over every id space a card can name its row by (#1041): the `name_key` the world deals, the
  // corpus `template_id`, and the SpellTemplate OBJECT ID the local-chain surface deals (#1025 — fight_start.js
  // `cast_id_of`). They are three names for the SAME row, so resolving them here is what keeps `icon_key` (and
  // the display name, AP, range, crit) a single fact: a surface holding only an object id derives the art key
  // through this door instead of guessing a second URL shape — the whole #1041 404 flood.
  cached = {
    spells,
    by_key: new Map(
      spells.flatMap((spell) =>
        [spell.name_key, spell.template_id, spell.object_id].filter(Boolean).map((key) => [key, spell])
      )
    ),
  }
  return cached
}

// Live view of the projected rows — a getter so every consumer reading `.spells` sees the current corpus
// (empty until load_spell_corpus resolves, then the full set; never a stale module-load snapshot).
export const fight_spells_data = {
  get spells() {
    return project().spells
  },
}

/**
 * @typedef {object} FightSpell
 * @property {string | null} object_id  the on-chain SpellTemplate shared object id (the act_cast target);
 *   null when the corpus row shipped before its deployment receipt — display-only, not castable
 * @property {string} class         lowercase class id ('senshi' …)
 * @property {number} unlock_level  the character level that unlocks the spell
 * @property {string} name          the on-chain display name ('Ember Strike')
 * @property {string} name_key      stable slug — the arm id + spell-icon key ('ember_strike')
 * @property {string} kind          'dmg' | 'heal'
 * @property {string} role          VFX-variant family key (damage/heal/dot/trap/punishment/… — vfx_variants.variant_for); derived from kind for plain seed content
 * @property {string | null} element
 * @property {Array<{ min_char_level: number, ap: number, mp: number, range: [number, number],
 *   modifiable_range: boolean, line_of_sight: boolean, linear: boolean, free_cell: boolean,
 *   casts_per_turn: number, casts_per_target: number, cooldown: number, crit_rate: number,
 *   effects: Array<{ kind: string, element?: string, base: number, crit_base?: number,
 *     chance: number, turns: number, area_shape: string, area_size: number }> }>} levels
 *   all 6 on-chain SpellLevels (SpellTemplate.levels — spell_effect.move's SpellLevel/Effect fields
 *   projected 1:1 above). Fight resolution reads the SEAT'S rank since #1077 — `seat_spell_row` below is the
 *   one door every live spell number comes through; the encyclopedia (classes_tab.tsx) renders every level.
 *   casts_per_turn/casts_per_target == 255 means unlimited (spell_bands::CASTS_UNLIMITED).
 */

/**
 * The on-chain spells a character of `class_id` at `char_level` can cast — every seeded class spell whose
 * `unlock_level ≤ char_level`, sorted by unlock level. Empty for a class with no seed / an unknown class.
 * @param {string | null | undefined} class_id  lowercase class id
 * @param {number} char_level
 * @returns {FightSpell[]}
 */
export function resolve_class_spells(class_id, char_level) {
  if (!class_id) return []
  const cls = String(class_id).toLowerCase()
  const lvl = Number.isFinite(char_level) ? char_level : 0
  return project()
    .spells.filter((spell) => spell.class === cls && spell.unlock_level <= lvl)
    .sort((a, b) => a.unlock_level - b.unlock_level)
}

/**
 * EVERY seeded spell of a class — locked ones included — sorted by unlock level. The GRIMOIRE's row source
 * (the spells tab shows the whole book, locked rows with their unlock chip). Empty for an unseeded class —
 * the honest on-chain state, never a stub.
 * @param {string | null | undefined} class_id  lowercase class id
 * @returns {FightSpell[]}
 */
export function class_spells(class_id) {
  if (!class_id) return []
  const cls = String(class_id).toLowerCase()
  return project()
    .spells.filter((spell) => spell.class === cls)
    .sort((a, b) => a.unlock_level - b.unlock_level)
}

/** The on-chain spell row a card id names — its `name_key` (the armed/hand id), its corpus `template_id`, or
 *  its SpellTemplate object id — else null. @param {string | null | undefined} key */
export function fight_spell(key) {
  return (key && project().by_key.get(key)) || null
}

/**
 * THE LEVEL A SEAT CASTS A SPELL AT (#1077) — read off the seat's COMPOSED BUILD, the `spell_levels` map its
 * escrow row and its fight-view row both carry (participant.move snapshots it at join; the simulator's book
 * re-keys onto the same space). The key is the SpellTemplate OBJECT id, because that is the id a cast names on
 * chain — `name_key` is the display/selection identity and never appears in that map. An absent entry is
 * level 1, the free unlock; a level past the authored ladder clamps to its last row rather than reading
 * undefined. Pure.
 * @param {{ spell_levels?: Record<string, number> } | null | undefined} seat  escrow row or fight-view fighter
 * @param {{ object_id?: string | null, levels?: unknown[] } | null | undefined} spell  a FightSpell row
 * @returns {number} 1-based level
 */
export function seat_spell_level(seat, spell) {
  const learned = Number(seat?.spell_levels?.[String(spell?.object_id ?? '')] ?? 1)
  const authored = spell?.levels?.length || 1
  return Number.isFinite(learned) ? Math.min(Math.max(1, Math.trunc(learned)), authored) : 1
}

/**
 * The SpellLevel row a seat actually casts a spell at — the ONE door every fight surface reads a live spell
 * number through (range, AP cost, cooldown, per-turn caps, effects), so a floater, a range highlight and a
 * greyed socket can never disagree about which rank they are describing. Null for an unresolved spell.
 * @param {{ spell_levels?: Record<string, number> } | null | undefined} seat
 * @param {{ object_id?: string | null, levels?: any[] } | null | undefined} spell  a FightSpell row
 * @returns {any | null}
 */
export function seat_spell_row(seat, spell) {
  return spell?.levels?.[seat_spell_level(seat, spell) - 1] ?? null
}

/** The normalized sim template for a live on-chain spell name_key, or null. */
export function fight_spell_template(key) {
  return fight_spell(key)?.template ?? null
}

/** The SpellTemplate object id to stage in `act_cast` for a `name_key`, or null. @param {string | null | undefined} key */
export function spell_object_id(key) {
  return fight_spell(key)?.object_id ?? null
}
