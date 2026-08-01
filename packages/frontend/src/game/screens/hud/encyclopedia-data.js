// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Encyclopedia content data + helpers (NO JSX). The single home for seeded identity/content casts,
// derived browse lists, and the small formatting/colour helpers the panes share. Class spells deliberately
// do not live here: the class tab reads the runtime-published catalog through fight-spells.js.

import classes_json from '@aresrpg/sdk/classes' with { type: 'json' }
import items_json from '@aresrpg/sdk/items-data' with { type: 'json' }
import mobs_json from '@aresrpg/sdk/mobs' with { type: 'json' }
import recipes_json from '@aresrpg/sdk/recipes' with { type: 'json' }
import { is_developer_item } from '@aresrpg/sdk/jobs'
import { WEAPON_FAMILIES } from '@aresrpg/fight/weapon_lines'

// ── content typedefs (the seeded JSON shapes) ────────────────────────────────
/**
 * @typedef {{ id: string, name: string, category: string, weapon_class: string | null,
 *   quality: string, level: number, stackable: boolean,
 *   stats: Record<string, [number, number]>,
 *   damages: { element: string, min: number, max: number }[], icon: string }} ItemDef
 * @typedef {{ name: string, title: string, health: number, stamina: number,
 *   starter_weapon: string, weapon_category: string }} ClassDef
 * @typedef {ClassDef & { id: string }} ClassEntry
 */

// The seeded JSON has no .d.ts, so TS infers narrow literal shapes that don't overlap our typedefs;
// cast through `unknown` (sanctioned over `any`) to the documented shapes.
export const ITEMS = /** @type {Record<string, ItemDef>} */ (
  /** @type {unknown} */ (items_json)
)
export const CLASSES = /** @type {Record<string, ClassDef>} */ (
  /** @type {unknown} */ (classes_json)
)

/**
 * @typedef {{ ingredients: { id: string, qty: number }[], craft_xp: number }} RecipeDef
 */
// Crafting recipes (recipes.json), keyed by the OUTPUT item id; ingredients reference item ids. The
// SSOT the crafting system consumes — the encyclopedia only reads it for the item "Can be crafted"
// cross-reference (c220), never invents a recipe.
export const RECIPES = /** @type {Record<string, RecipeDef>} */ (
  /** @type {unknown} */ (recipes_json)
)

// quality → tint + sort order live in the shared ./quality.js SSOT (one home, imported by the panes).

// sort options (the companion SORT_OPTIONS, restyled to a house <select>).
export const SORT_OPTIONS = /** @type {const} */ ([
  { key: 'level_asc', label: 'Level (low to high)' },
  { key: 'level_desc', label: 'Level (high to low)' },
  { key: 'name_asc', label: 'Name (A to Z)' },
])

// elements available to filter on (item .damages[].element), house tints from element-colors.js.
export const ELEMENTS = /** @type {const} */ ([
  'fire',
  'water',
  'earth',
  'air',
  'neutral',
])

// element → tint helper (the house ramp SSOT) re-exported so the encyclopedia panes share one map.
export { element_color } from './element-colors.js'

/** Title-case a snake/lower id, e.g. "fire_resistance" -> "Fire resistance". */
export const titleize = (/** @type {string} */ s) =>
  s.replace(/_/g, ' ').replace(/^\w/, m => m.toUpperCase())

// ── item category groups (the companion CATEGORY_GROUPS, restyled to tabs) ────
/** @type {{ key: string, label: string, cats: string[] | null }[]} */
export const ITEM_GROUPS = [
  { key: 'ALL', label: 'All', cats: null },
  {
    key: 'WEAPONS',
    label: 'Weapons',
    cats: [
      WEAPON_FAMILIES[0],
      'sword',
      'daggers',
      'mace',
      'bow',
      'spear',
      'staff',
      'axe',
      WEAPON_FAMILIES[2],
      'club',
      WEAPON_FAMILIES[5],
    ],
  },
  {
    key: 'ARMOR',
    label: 'Armor',
    cats: ['helmet', 'chestplate', 'gauntlets', 'pants', 'belt', 'boots'],
  },
  { key: 'JEWELS', label: 'Jewels', cats: ['amulet', 'ring', 'relic'] },
  { key: 'CONSUMABLE', label: 'Consumables', cats: ['consumable'] },
  { key: 'RESOURCE', label: 'Resources', cats: ['resource', 'rune'] },
  { key: 'PETS', label: 'Pets', cats: ['pet'] },
  {
    key: 'TOOLS',
    label: 'Tools',
    cats: ['tool_herbalist', 'tool_miner', 'tool_paysan'],
  },
]

// Developer/cheat items (category=developer, e.g. "Admin sword of doom") are excluded from the
// encyclopedia entirely — they must never be browsable.
export const ITEM_LIST = /** @type {ItemDef[]} */ (
  Object.values(ITEMS).filter(it => !is_developer_item(it))
)

export const CLASS_LIST = /** @type {ClassEntry[]} */ (
  Object.entries(CLASSES).map(([id, class_def]) => ({ id, ...class_def }))
)

/**
 * @typedef {{ id: string, name: string, element: string, boss: boolean, min_level: number,
 *   max_level: number, health: number, xp_reward: number, stats: Record<string, number>,
 *   melee_damage: { element: string, min: number, max: number },
 *   drops: { item_id: string, chance: number, min: number, max: number }[],
 *   description?: string }} MobDef
 */

// The REAL bestiary — the seeded mobs (mobs.json), the authoritative content the sim + server
// consume: names, element, level brackets, health, xp and loot tables. Replaces the old invented
// 2-mob roster + its 2D placeholder art (the wiki shows REAL mobs, not placeholder sprites).
// Kept as the FULL record so any mob id resolves (e.g. a loot-source cross-ref); the browse list
// below is filtered to the real roster.
export const MOBS = /** @type {Record<string, MobDef>} */ (
  /** @type {unknown} */ (mobs_json)
)

// c222: the bestiary shows only REAL roster mobs — pets (Item category 'pet') and spell SUMMONS
// (igris / summon_linlian) carry NO xp_reward, so this single semantic gate ("a real enemy grants
// combat XP when defeated") excludes every non-roster entity. Derived from the seeded data, no
// invented type discriminator (mobs.json has none).
/** @param {MobDef} m */
export const is_roster_mob = m => m.xp_reward > 0

export const MOB_LIST = /** @type {MobDef[]} */ (
  Object.values(MOBS)
    .filter(is_roster_mob)
    .sort((a, b) => a.min_level - b.min_level || a.name.localeCompare(b.name))
)

// ── item cross-references (c220): pure derivations over the seeded recipes + mob loot tables ──────
/**
 * The crafting recipe for an item, if one exists (recipes.json is keyed by the output item id). Each
 * ingredient is resolved to its seeded ItemDef so the caller can link to the ingredient's item card.
 * @param {string} item_id
 * @returns {{ craft_xp: number, ingredients: { id: string, qty: number, item: ItemDef | null }[] } | null}
 */
export const recipe_for = item_id => {
  const recipe = RECIPES[item_id]
  if (!recipe) return null
  return {
    craft_xp: recipe.craft_xp,
    ingredients: recipe.ingredients.map(ing => ({
      ...ing,
      item: ITEMS[ing.id] ?? null,
    })),
  }
}

/**
 * Every roster mob whose loot table drops this item, most-likely first. Derived purely from the
 * seeded mob drop tables (the read-model the sim + server consume) — never invents a source. Uses the
 * filtered MOB_LIST so a clicked source always resolves to a browsable bestiary mob.
 * @param {string} item_id
 * @returns {{ mob: MobDef, chance: number, min: number, max: number }[]}
 */
export const dropped_by = item_id =>
  MOB_LIST.flatMap(mob =>
    (mob.drops ?? [])
      .filter(d => d.item_id === item_id)
      .map(d => ({ mob, chance: d.chance, min: d.min, max: d.max })),
  ).sort((a, b) => b.chance - a.chance)
