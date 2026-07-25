// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SIMULATOR CONTENT — the chain-free builders that turn published content into the numbers a local fight
// needs (docs/design/simulator_rebuild_spec.md §5). PURE: no fetch, no chain read, no store. Every rule here
// is CONSUMED, never re-implemented — max roll is the catalog's own range ceiling, the gear fold is
// @aresrpg/sim's `fold_equipment_snapshot`, hp is @aresrpg/sdk's `get_max_health`, mob hp is the mob_ai.move
// twin (`scaled_hp`), and spell templates come out of the same normalizer the live game uses. This module
// owns exactly one thing: the WIRING between them.
//
// It deliberately holds NO budget/clamp law (the level, stat-point and spell-point budgets are the page
// reducer's — one home). It refuses out-of-domain input loudly instead of silently coercing it.

import CLASSES_JSON from '@aresrpg/sdk/classes' with { type: 'json' }
import ITEMS_JSON from '@aresrpg/sdk/items-data' with { type: 'json' }
import { experience_to_level, level_to_experience } from '@aresrpg/sdk/experience'
import { STATISTICS, get_equipment_stat, get_max_health, get_total_stat } from '@aresrpg/sdk/stats'
import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'
import { ITEM_STAT_CATALOG_ORDER, ITEM_STAT_SHIFT, fold_equipment_snapshot } from '@aresrpg/sim/equipment_stats'
import { scaled_hp } from '@aresrpg/sim/mob_stats'

import { fight_spells_data } from '../game/screens/hud/fight-spells.js'
import { equip_item } from '../game/screens/hud/simulator-equip.js'

// The simulator's paper-doll vocabulary IS the inventory's — re-exported through this door so the page never
// re-derives a second slot list (`items_for_slot` fills each slot's picker from the same catalog).
export { EQUIPMENT_SLOTS, EQUIPPABLE_SLOTS, SLOT_LABEL, items_for_slot } from '../game/screens/hud/simulator-equip.js'

/** @typedef {import('../game/screens/hud/encyclopedia-data.js').ItemDef} ItemDef */
/** @typedef {import('../pages/encyclopedia/world_corpus').CorpusMob} CorpusMob */
/** @typedef {import('../pages/encyclopedia/world_corpus').CorpusMobSpell} CorpusMobSpell */

// ── classes ──────────────────────────────────────────────────────────────────────────────────────

/** The 12 seeded classes, id-carrying. Weapon category gates the weapon slot's picker. */
export const SIMULATOR_CLASSES = Object.entries(CLASSES_JSON).map(([id, def]) => ({
  id,
  .../** @type {Record<string, unknown>} */ (def),
}))

// ── base pools ───────────────────────────────────────────────────────────────────────────────────
// Base AP 6 / MP 3 are the SDK's, DERIVED off an empty character rather than copied as literals — a chain
// rebalance of the base pools reaches the simulator with no edit here.
export const BASE_AP = get_total_stat(/** @type {any} */ ({}), STATISTICS.ACTION)
export const BASE_MP = get_total_stat(/** @type {any} */ ({}), STATISTICS.MOVEMENT)

/** The top of the on-chain xp curve (character_xp.move MAX_LEVEL, via the SDK's own table). */
const MAX_CHARACTER_LEVEL = experience_to_level(Number.MAX_SAFE_INTEGER)

// ── items: max roll → the centered wire the fold reads ────────────────────────────────────────────
// The catalog's stat vocabulary is the SDK's (`ap`/`mp`), the fold's is the Move item_stats one
// (`action`/`movement`); `get_equipment_stat` already reads either spelling, so the bridge is a lookup, not
// a second alias table.
const CATALOG_TO_STATISTIC = /** @type {Record<string, string>} */ ({
  action: STATISTICS.ACTION,
  movement: STATISTICS.MOVEMENT,
})

/**
 * One catalog item → its centered max-roll row, in ITEM_STAT_CATALOG_ORDER positions (32768 = neutral).
 * MAX ROLL is `equip_item`'s range ceiling — the same flattening the build planner equips, so the simulator
 * and the planner can never disagree about what an item is worth.
 * @param {ItemDef} item
 * @returns {number[]}
 */
export const centered_max_roll = (item) => {
  const worn = /** @type {Record<string, unknown>} */ ({ equipment_stats: equip_item(item) })
  return ITEM_STAT_CATALOG_ORDER.map(
    (key) => ITEM_STAT_SHIFT + get_equipment_stat(/** @type {any} */ (worn), CATALOG_TO_STATISTIC[key] ?? key)
  )
}

/**
 * The gear-only aggregate under the SDK stat names — the `equipment_stats` field the production HUD's
 * `stats_of` reads, so the seeded engine-store character records feed `predict_cast` exactly as a chain
 * character does. RAW sums: the zero floor is the fold's job, not this projection's.
 * @param {ItemDef[]} items
 * @returns {Record<string, number>}
 */
const equipment_aggregate = (items) =>
  items.reduce((totals, item) => {
    const worn = /** @type {any} */ ({ equipment_stats: equip_item(item) })
    return ITEM_STAT_CATALOG_ORDER.reduce((carried, key) => {
      const stat = CATALOG_TO_STATISTIC[key] ?? key
      return { ...carried, [stat]: (carried[stat] ?? 0) + get_equipment_stat(worn, stat) }
    }, totals)
  }, /** @type {Record<string, number>} */ ({}))

/**
 * A stored loadout (slot → item template id, the reducer's `SimCharacter.loadout`) → the catalog rows to
 * fold. Unresolvable ids come back as `unresolved` rather than vanishing: the catalog ships EMPTY in this
 * repo (MISSING-ARTIFACT #117), so a silent drop would render every build naked with no explanation.
 * @param {Record<string, string>} [loadout]
 * @returns {{ items: ItemDef[], unresolved: Array<{ slot: string, template_id: string }> }}
 */
/**
 * One catalog row by template id — `items_for_slot`'s inverse (the picker hands out ids, the loadout stores
 * them, the doll needs the row back). `slug` is joined on so the paper doll's own icon resolver
 * (`inventory_item_icon`) finds the authored art: a catalog row's identity IS its id.
 * @param {string | null | undefined} template_id
 * @returns {(ItemDef & { slug: string }) | undefined}
 */
export const catalog_item = (template_id) => {
  const catalog = /** @type {Record<string, ItemDef>} */ (/** @type {unknown} */ (ITEMS_JSON))
  const item = template_id ? catalog[template_id] : undefined
  return item ? { ...item, slug: item.id } : undefined
}

export const resolve_loadout = (loadout) => {
  const catalog = /** @type {Record<string, ItemDef>} */ (/** @type {unknown} */ (ITEMS_JSON))
  const rows = Object.entries(loadout ?? {}).map(([slot, template_id]) => ({
    slot,
    template_id,
    item: catalog[template_id],
  }))
  return {
    items: rows.filter((row) => row.item).map((row) => row.item),
    unresolved: rows.filter((row) => !row.item).map(({ slot, template_id }) => ({ slot, template_id })),
  }
}

// ── character → fight seat ───────────────────────────────────────────────────────────────────────

/**
 * A roster character + its max-rolled loadout → the numbers a fight seat starts with. `stat_alloc` is the
 * player's allocation (the reducer owns its budget); everything else is derived.
 * @param {{ level: number, stat_alloc?: Record<string, number> }} character
 * @param {ItemDef[]} [items]  the equipped catalog rows, any slot order (the fold is order-independent)
 * @returns {{ level: number, stats: Record<string, number>, hp: number, max_hp: number,
 *   ap_max: number, mp_max: number, equipment_stats: Record<string, number> }}
 */
export const build_seat = (character, items = []) => {
  const level = Number(character?.level)
  if (!Number.isInteger(level) || level < 1 || level > MAX_CHARACTER_LEVEL)
    throw new Error(`build_seat: level ${character?.level} is outside the on-chain curve [1, ${MAX_CHARACTER_LEVEL}]`)

  const folded = fold_equipment_snapshot(
    /** @type {any} */ (character.stat_alloc ?? {}),
    BASE_AP,
    BASE_MP,
    items.map(centered_max_roll)
  )
  // get_max_health is the SDK's own 30 + 5·level + total vitality; the folded vitality is already
  // allocation + gear, so it goes in as the character's base and no equipment row is passed twice.
  const max_hp = get_max_health(
    /** @type {any} */ ({ experience: level_to_experience(level), vitality: folded.stats.vitality ?? 0 })
  )
  return {
    level,
    stats: /** @type {Record<string, number>} */ (folded.stats),
    hp: max_hp, // a seat enters placement at full health
    max_hp,
    ap_max: folded.ap_max,
    mp_max: folded.mp_max,
    equipment_stats: equipment_aggregate(items),
  }
}

// ── spells ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The sim template map for every published CLASS spell, keyed by NAME_KEY. Derived off the live corpus
 * projection the game itself resolves casts through (fight-spells.js), so a simulated cast and a real one
 * read the same template. name_key — not the object id — is the key on purpose: it is the id the reducer's
 * `spell_levels` store, the id the fight store's hand carries, and the only one stable across a republish.
 * Empty until the corpus blob loads — inert, never a stub.
 * @returns {Map<string, object>}
 */
export const class_spell_templates = () =>
  new Map(fight_spells_data.spells.filter((spell) => spell.template).map((spell) => [spell.name_key, spell.template]))

/**
 * The sim-local id of a mob's authored spell. Mirrors the SDK's `mob_attack_spell_id` idiom (a mob-scoped
 * prefix): authored kit rows carry no id of their own, and the sim needs one to key deck/templates.
 * @param {string} mob_template_id @param {number} index
 */
export const mob_spell_id = (mob_template_id, index) => `mob_spell_${mob_template_id}_${index}`

// The authored effect writes its magnitude as `base`; the chain field is `value` (world_corpus.ts
// CorpusMobSpellEffect: "`base ?? value` becomes the chain `value`"). Everything else is already chain-shaped.
const chain_effect = (effect) => ({ ...effect, value: effect.base ?? effect.value ?? 0 })

// The seeder's PHASE 5 `spellLevel` mapping, inverted: ap/rmin/rmax/cd/crit pass through to their chain
// names, `los` defaults to true (world_corpus.ts CorpusMobSpell). Every field it does not carry keeps
// normalize_spell_templates' own default — this adapter invents none.
const mob_spell_level = (spell) => ({
  ap_cost: spell.ap ?? 0,
  range_min: spell.rmin ?? 0,
  range_max: spell.rmax ?? 0,
  cooldown_turns: spell.cd ?? 0,
  crit_rate: spell.crit ?? 0,
  line_of_sight: spell.los !== false,
  effects: (spell.effects ?? []).map(chain_effect),
  crit_effects: (spell.crit_effects ?? []).map(chain_effect),
})

/**
 * One mob's authored kit → sim spell templates, through the same normalizer the class corpus uses.
 * @param {string} mob_template_id
 * @param {CorpusMobSpell[]} [spells]  `mob_corpus_of(id)?.spells` — the real minted SpellLevels
 * @returns {Map<string, object>}
 */
export const build_mob_spell_templates = (mob_template_id, spells) => {
  const rows = (spells ?? []).map((spell, index) => ({
    id: mob_spell_id(mob_template_id, index),
    name: mob_spell_id(mob_template_id, index),
    levels: [mob_spell_level(spell)],
  }))
  const templates = normalize_chain_spell_corpus(rows)
  return /** @type {Map<string, object>} */ (templates)
}

// ── mobs ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The placeholder base hp used when a mob's combat block is UNPUBLISHED (spec §3 seam S2). It is a declared
 * stand-in, never presented as chain truth: `build_mob` flags the row so the picker badges it.
 */
export const MOB_FALLBACK_HP_PER_LEVEL = 50

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

/**
 * A corpus mob row + a chosen level → the fight numbers it spawns with. `base_hp` is what a fight cannot
 * fake, so its absence is what marks the block unpublished — an authored ap/mp still wins over the fallback.
 * @param {CorpusMob} mob
 * @param {number} level  clamped into the authored band (the band is the row's own law)
 * @returns {{ template_id: string, name: string, element: string | null, role: string | null,
 *   level: number, min_level: number, max_level: number, hp: number, max_hp: number, ap: number,
 *   mp: number, stats: Record<string, number>, combat_block_published: boolean }}
 */
export const build_mob = (mob, level) => {
  const min_level = mob.minLevel ?? 0
  const max_level = Math.max(min_level, mob.maxLevel ?? 0)
  const rolled = clamp(Math.trunc(Number(level)), min_level, max_level)
  const combat_block_published = mob.base_hp != null
  const base_hp = mob.base_hp ?? MOB_FALLBACK_HP_PER_LEVEL * max_level
  const hp = scaled_hp(base_hp, min_level, max_level, rolled)
  return {
    template_id: mob.id,
    name: mob.name,
    element: mob.element,
    role: mob.role,
    level: rolled,
    min_level,
    max_level,
    hp,
    max_hp: hp,
    ap: mob.ap ?? BASE_AP,
    mp: mob.mp ?? BASE_MP,
    stats: mob.stats ?? {},
    combat_block_published,
  }
}
