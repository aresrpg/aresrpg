// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spellbook (GRIMOIRE) data derivations — NO JSX. The single home for the character-detail SPELLS tab's
// list + per-level detail + upgrade-state logic. The grimoire renders EXACTLY the spells DEPLOYED on-chain:
// its rows/levels come from the fight-spells.js projection over the authored corpus + seed receipt, each row
// carrying the spell's `object_id` (the shared `SpellTemplate` the spend PTB references) and all 6 chain
// levels with their per-level `min_char_level` gates. The old `spellbook-seed.json` source (the DEPRECATED
// spell_registry system — spells that were never deployed) no longer feeds the grimoire; it survives only for
// the template non-dungeon fight fallback (core/modules/fight.js) + the D113 effect-render coverage test.
//
// The on-chain model (spell_level.move + spell_template.move + character_link.move): every SpellTemplate has
// exactly 6 levels; a class spell is usable at level 1 for FREE (absent DF = baseline 1) and raising to
// `target` costs `target − 1 = current` spell points, gated by the TARGET level's own `min_char_level` (the
// seed mints [1, 20, 40, 60, 80, unlock + 100]). Unspent points are DERIVED: (character level − 1) − spent.
// Damage is a FIXED value per level (`base`) with a SEPARATE fixed crit (`crit_base`) — never a rolled range.

import { spell_upgrade_cost } from '@aresrpg/sdk/progression'

import { element_color } from './element-colors.js'
import { class_spells, seat_spell_level, seat_spell_row } from './fight-spells.js'
import { spell_category } from './spell-category.js'
// The house heal-pink grammar — ONE home in seed-effect-line.js (the effect-line tone SSOT).
import { HEAL_PINK } from './seed-effect-line.js'

export const MAX_SPELL_LEVEL = 6

/** The spell-point COST to raise a spell FROM `current` to `current+1` — the on-chain rule (target − 1 =
 *  current), owned by @aresrpg/sdk/progression and re-exported here so the grimoire's legacy import surface
 *  stays stable. The simulator's cumulative `spell_cost` is Σ of this same function — one home, two views. */
export { spell_upgrade_cost as upgrade_cost } from '@aresrpg/sdk/progression'

const GOLD = 'var(--color-gold)'

/**
 * The token colour for one seed effect (D49b): elemental damage takes its element hue; HEAL is the house pink;
 * every buff / control / resource / placement effect takes the house gold. PLACE_TRAP carries no element of its
 * own (the corpus's trap payload is a bare placement flag — the real damage is a SEPARATE sibling DAMAGE effect
 * in the same level, coloured by its own row), so it falls through to gold like any other non-elemental effect —
 * the old `e.payload?.element` read a field the live spell projection never carries (S-64 audit). Pulled
 * from the element-colors SSOT the fight board reads, so the grimoire's palette never drifts from the floating
 * numbers. @param {{ kind: string, element?: string }} e
 */
const effect_color = e => {
  if (e.kind === 'DAMAGE') return element_color(e.element)
  if (e.kind === 'HEAL') return HEAL_PINK
  return GOLD
}

/** Crit CHANCE as a percentage from the seed's 1-in-N `crit_rate` (0 = non-critable). */
export const crit_pct = level =>
  level?.crit_rate > 0 ? Math.max(1, Math.round(100 / level.crit_rate)) : 0

/**
 * One spell LEVEL's effects for the detail panel: the seed's true-taxonomy effects, each tagged with its token
 * colour. Pure data — no JSX, no i18n (the component maps each `kind` to a localized one-liner so all 6 locales
 * resolve). @param {{ effects?: Array<object> } | null | undefined} level
 */
export const spell_effects = level =>
  (level?.effects ?? []).map(e => ({
    ...e,
    ...(level?.crit_rate > 0 ? {} : { crit_base: undefined, crit_effect: undefined }),
    color: effect_color(e),
  }))

/** A short targeting descriptor for the list subline ('self' / 'melee' / 'ranged'). @param {{ range?: number[], effects?: Array<object> }} level */
const descriptor = level => {
  const rmax = level?.range?.[1] ?? 0
  if (rmax === 0) return 'self'
  const deals_damage = (level?.effects ?? []).some(
    e => e.kind === 'DAMAGE' || e.kind === 'PLACE_TRAP',
  )
  if (rmax <= 1) return deals_damage ? 'melee' : 'self'
  return 'ranged'
}

/**
 * The full grimoire for a class at a character level — rows are the DEPLOYED class spells (fight-spells.js;
 * an unseeded class yields an honest empty book). Each row carries its list-render data + everything the
 * detail panel needs, so the component is pure presentation. `row.id` is the spell's on-chain `SpellTemplate`
 * OBJECT id — the exact object the spend PTB (`raise_spell_level`) references AND the key of `invested`.
 * `invested` = the chain-true per-spell levels off read_spell_state (absent spell = baseline 1); `points` =
 * the derived unspent points, threaded by the caller. `name` is the on-chain display name — the component
 * renders i18n-first (`spells.spell_<name_key>`) with `name` as the honest fallback (the spell_card rule).
 * @param {string} class_id  lowercase class ('senshi' …) @param {number} char_level @param {number} points
 * @param {Record<string, number>} [invested]  SpellTemplate object id → invested level (read_spell_state)
 */
export const grimoire = (class_id, char_level, points, invested = {}) => {
  const seat = { spell_levels: invested }
  const rows = class_spells(class_id).map(sp => {
    const unlocked = char_level >= sp.unlock_level
    // Chain truth: an unlocked class spell is ALWAYS at least level 1 (free baseline — absent DF reads 1);
    // a locked one renders 0 (not yet usable). `invested` overrides with the real raised level.
    const current_level = unlocked ? seat_spell_level(seat, sp) : 0
    const level = unlocked ? seat_spell_row(seat, sp) : sp.levels[0]
    const kind = spell_category(level)
    return {
      id: sp.object_id, // the shared SpellTemplate object id — the spend PTB target
      name: sp.name, // on-chain display name (the i18n fallback)
      name_key: sp.name_key,
      icon: sp.icon_key, // spell-art key (#884: the id shape, one home in fight-spells-core); honest-fallback
      levels: sp.levels, // all 6 chain levels (ap/range/crit/effects + per-level min_char_level)
      unlock_tier: sp.unlock_level,
      unlocked,
      current_level,
      color: kind.color,
      subline_kind: kind.key,
      subline_descriptor: descriptor(level),
    }
  })
  const unlocked_count = rows.filter(r => r.unlocked).length
  return { rows, unlocked_count, total: rows.length, points, char_level }
}

/** UPGRADE STATE — resolves to exactly one honest state (D30 §UPGRADE). The char-level gate reads the TARGET
 * level's own `min_char_level` straight off the chain row (the same fact `raise_spell_level` asserts on-chain).
 * A LOCKED row (display current_level 0) gates on its unlock tier FIRST — on-chain the baseline is already 1,
 * so its real next target is 2 (gate ≥ 20): enabling a "free" raise there would only buy a guaranteed abort.
 * @returns state + the numbers the UI needs. */
export const upgrade_state = (row, char_level, points) => {
  if (!row.unlocked)
    return { state: 'char_short', req: row.unlock_tier, next: 1, cost: 0 }
  const cur = row.current_level
  if (cur >= MAX_SPELL_LEVEL || cur >= (row.levels?.length ?? MAX_SPELL_LEVEL))
    return { state: 'mastered' }
  const next = cur + 1
  const req = Number(row.levels?.[next - 1]?.min_char_level ?? Infinity)
  const cost = spell_upgrade_cost(cur)
  if (char_level < req) return { state: 'char_short', req, next, cost }
  if (points < cost) return { state: 'no_points', req, next, cost }
  return { state: 'enabled', req, next, cost }
}
