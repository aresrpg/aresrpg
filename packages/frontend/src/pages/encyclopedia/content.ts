// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seeded content source for the encyclopedia (PHASE 3 meta-tab swap). The AresRPG companion
// encyclopedia originally read its item/mob/dungeon/class/npc templates from the template server via
// `use_ws()`; this module is a drop-in `use_content()` that serves the SAME shapes from the seeded
// @aresrpg/sdk content instead, so the tabs render the seeded data with ZERO layout changes.
//
// SSOT, no reinvention: the seeded JSON casts + the derived browse lists + the recipe/loot
// cross-references already live in `../../game/screens/hud/encyclopedia-data.js` (the in-game
// encyclopedia data builder). We import those and only RESHAPE the seed fields into the companion
// template field names (e.g. `min_level` -> `minLevel`, `quality` -> `rarity`, snake_case stats ->
// camelCase, `recipes.json` -> a `recipeJson` string). Class spell details bypass this static adapter
// and read the runtime-published catalog directly in classes_tab.tsx.

import { GATHER_RESOURCES, job_for_recipe } from '@aresrpg/sdk/jobs'
import npcs_json from '@aresrpg/sdk/npcs' with { type: 'json' }

import { ITEM_LIST, MOB_LIST, CLASS_LIST, RECIPES } from '../../game/screens/hud/encyclopedia-data.js'

// ── seeded shapes (the SDK JSON carries fields the in-game typedefs don't model) ──────────────
type Stats = Record<string, number | [number, number]>

interface RawItem {
  id: string
  name: string
  category: string
  weapon_class: string | null
  quality: string
  level: number
  appearance: string | null
  stats: Stats
  damages: { element: string; min: number; max: number }[]
  icon: string
  description?: string
  i18n?: { name?: Record<string, string>; description?: Record<string, string> }
}

interface RawClass {
  id: string
  name: string
  title: string
  health: number
  weapon_category: string
  starter_weapon: string
}

interface RawNpc {
  id: string
  name: string
  type: string
  appearance: string | null
  dialog_text: string | null
  item_in_hand: string | null
}

const ITEM_LIST_RAW = ITEM_LIST as unknown as RawItem[]
const CLASS_LIST_RAW = CLASS_LIST as unknown as RawClass[]
const NPCS_RAW = npcs_json as unknown as Record<string, RawNpc>

// ── stat key mapping (seed snake_case -> companion camelCase the stat helpers expect) ─────────
const STAT_KEY_MAP: Record<string, string> = {
  raw_damage: 'rawDamage',
  critical: 'criticalHit',
  critical_chance: 'criticalChance',
  critical_outcomes: 'criticalOutcomes',
  fire_resistance: 'fireResistance',
  water_resistance: 'waterResistance',
  earth_resistance: 'earthResistance',
  air_resistance: 'airResistance',
}

// Exported: item_catalog.ts (the fresh seed-sourced item stat join) reuses this SAME snake_case -> camelCase
// remap rather than duplicating it, so there is one home for "which stat keys need companion-style casing."
export function map_stats(stats: Stats | undefined): Stats {
  const out: Stats = {}
  for (const [key, value] of Object.entries(stats ?? {})) out[STAT_KEY_MAP[key] ?? key] = value
  return out
}

// ── crafting / gathering cross-refs (recipes.json + the gather resource tables) ────────────────
const GATHER_JSON_BY_ITEM: Record<string, string> = {}
for (const [job, resources] of Object.entries(GATHER_RESOURCES))
  for (const resource of resources)
    GATHER_JSON_BY_ITEM[resource.id] = JSON.stringify({
      jobType: job.toUpperCase(),
      tier: resource.tier,
    })

function recipe_json_for(item: RawItem): string | undefined {
  const recipe = RECIPES[item.id]
  if (!recipe) return undefined
  const job = job_for_recipe(item.id, item.category)
  return JSON.stringify({
    jobType: job ? job.id.toUpperCase() : null,
    ingredients: recipe.ingredients.map((ing) => ({
      templateKey: ing.id,
      quantity: ing.qty,
    })),
  })
}

// ── template builders (seed shape -> companion template field names) ──────────────────────────
const items_t = ITEM_LIST_RAW.map((item) => ({
  id: item.id,
  name: item.name,
  i18nJson: item.i18n ? JSON.stringify(item.i18n) : undefined,
  category: item.category.toUpperCase(),
  rarity: item.quality,
  level: item.level ?? 0,
  appearance: item.appearance ?? undefined,
  stats: map_stats(item.stats),
  damages: (item.damages ?? []).map((d) => ({
    element: d.element.toUpperCase(),
    from: d.min,
    to: d.max,
  })),
  description: item.description ?? '',
  recipeJson: recipe_json_for(item),
  gatheringJson: GATHER_JSON_BY_ITEM[item.id],
  weapon_class: item.weapon_class ?? undefined,
}))

const mobs_t = MOB_LIST.map((mob) => ({
  id: mob.id,
  name: mob.name,
  element: mob.element,
  minLevel: mob.min_level,
  maxLevel: mob.max_level,
  health: mob.health,
  xpReward: mob.xp_reward,
  boss: mob.boss,
  stats: map_stats(mob.stats as Stats),
  earthResistance: mob.stats?.earth_resistance ?? 0,
  fireResistance: mob.stats?.fire_resistance ?? 0,
  waterResistance: mob.stats?.water_resistance ?? 0,
  airResistance: mob.stats?.air_resistance ?? 0,
}))

const classes_t = CLASS_LIST_RAW.map((cls) => ({
  id: cls.id,
  displayName: cls.name,
  title: cls.title,
  health: cls.health,
  starterWeapon: cls.starter_weapon,
  draft: false,
}))

const npcs_t = Object.values(NPCS_RAW).map((npc) => ({
  id: npc.id,
  name: npc.name,
  type: npc.type,
  dialogText: npc.dialog_text,
  appearance: npc.appearance,
}))

// ── the drop-in store slice (mirrors the `use_ws()` API the encyclopedia consumed) ─────────────
// T8 (board ticket #8): the `dungeon` field was removed — it was a hardcoded-empty stub (the seed has no
// dungeon content) feeding a DUNGEONS encyclopedia tab that has since been deleted for showing nothing
// but that stub as if it were real. Nothing else reads `templates.dungeon` from this module.
// The marketplace price chart is STUBBED null (no companion price feed for these listings yet).
const noop = (() => {}) as (...args: unknown[]) => void

const CONTENT = {
  templates: {
    item: items_t,
    mob: mobs_t,
    class: classes_t,
    npc: npcs_t,
  },
  templates_loading: false,
  fetch_templates: noop,
  fetch_marketplace_chart: noop,
  marketplace_chart: null,
  marketplace_chart_loading: false,
}

export function use_content(): typeof CONTENT {
  return CONTENT
}
