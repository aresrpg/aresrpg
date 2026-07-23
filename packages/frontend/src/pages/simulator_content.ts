// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Build-simulator content source. Maps the seeded content (@aresrpg/sdk classes / items / spells)
// into the exact template shapes pages/simulator.tsx consumes, so the simulator runs fully on local
// data with no server round-trip. The simulator's own balance math (constants/simulator.ts) reads a
// camelCase stat vocabulary (criticalHit / rawDamage / earthResistance); the seed is snake_case
// (critical / raw_damage / fire_resistance), so the only real adaptation here is the stat-key bridge
// plus an UPPERCASE category bridge (the seed is lowercase, the simulator's SLOT_CATEGORIES uppercase)
// and folding each spell's per-level array into the levelsJson keyframe string interpolate_levels expects.

import classes_json from '@aresrpg/sdk/classes' with { type: 'json' }
import spells_json from '@aresrpg/sdk/spells' with { type: 'json' }

// classes + spells are tiny (static imports). items.json is the heavy cast (~2.3 MB), so it loads via a
// dynamic import (its own async chunk) and never weighs down the eagerly-bundled main chunk.

// ── seeded JSON shapes (no .d.ts ships with the seed, so cast through unknown) ────────────────────
type StatRange = [number, number]

interface SeedItem {
  id: string
  name: string
  category: string
  appearance: string | null
  weapon_class: string | null
  quality: string
  level: number
  stats: Record<string, StatRange>
  damages: { element: string; min: number; max: number }[]
  description?: string
  i18n?: { name?: Record<string, string>; description?: Record<string, string> }
}

interface SeedClass {
  name: string
  title: string
  health: number
  stamina: number
  weapon_category: string
}

interface SeedSpellEffect {
  type: string
  element?: string
  min?: number
  max?: number
  turns?: number
  statistic?: string
}

interface SeedSpellLevel {
  cost?: number
  area?: number
  turns_to_recast?: number
  base_effects?: SeedSpellEffect[]
}

interface SeedSpell {
  name: string
  levels: SeedSpellLevel[]
}

const CLASSES = classes_json as unknown as Record<string, SeedClass>
const SPELLS = spells_json as unknown as Record<string, Record<string, SeedSpell>>

// ── stat-key bridge: seed snake_case -> the simulator math's camelCase (only the keys that differ;
// vitality / strength / wisdom / agility / intelligence / chance / ap / mp / summons / heal pass through). ──
const STAT_KEY_MAP: Record<string, string> = {
  critical: 'criticalHit',
  raw_damage: 'rawDamage',
  earth_resistance: 'earthResistance',
  fire_resistance: 'fireResistance',
  water_resistance: 'waterResistance',
  air_resistance: 'airResistance',
}
const map_stat_key = (key: string): string => STAT_KEY_MAP[key] ?? key

// ── template shapes the simulator UI reads (mirrors the old WS template fields it consumed) ───────
export interface SimItemTemplate {
  id: string
  name: string
  description: string
  i18nJson: string
  category: string
  rarity: string
  level: number
  appearance: string
  stats: Record<string, StatRange>
  damages: { element: string; from: number; to: number }[]
  weaponClass: string
}

export interface SimClassTemplate {
  id: string
  displayName: string
  title: string
  weaponCategory: string
  health: number
  stamina: number
}

export interface SimSpellTemplate {
  id: string
  name: string
  element: string
  levelsJson: string
}

// ── items ────────────────────────────────────────────────────────────────────────────────────────
const map_item = (it: SeedItem): SimItemTemplate => {
  const stats: Record<string, StatRange> = {}
  for (const [key, range] of Object.entries(it.stats ?? {})) stats[map_stat_key(key)] = range
  return {
    id: it.id,
    name: it.name ?? it.id,
    description: it.description ?? '',
    i18nJson: it.i18n ? JSON.stringify(it.i18n) : '{}',
    category: (it.category ?? '').toUpperCase(),
    rarity: it.quality ?? 'common',
    level: it.level ?? 0,
    appearance: it.appearance ?? '',
    stats,
    damages: (it.damages ?? []).map((d) => ({ element: d.element, from: d.min, to: d.max })),
    weaponClass: it.weapon_class ?? '',
  }
}

export const load_seed_items = async (): Promise<SimItemTemplate[]> => {
  const mod = await import('@aresrpg/sdk/items-data')
  const items = ((mod as { default?: unknown }).default ?? mod) as unknown as Record<string, SeedItem>
  return Object.values(items).map(map_item)
}

// ── classes ────────────────────────────────────────────────────────────────────────────────────────
export const SEED_CLASSES: SimClassTemplate[] = Object.entries(CLASSES).map(([id, c]) => ({
  id,
  displayName: c.name,
  title: c.title,
  weaponCategory: (c.weapon_category ?? '').toUpperCase(),
  health: c.health,
  stamina: c.stamina,
}))

// ── spells: fold the per-level array into a keyframe map, transforming each effect into the shape
// interpolate_levels + the simulator's spell_damage_infos expect (a `damages: [min, max]` array that
// build_level turns into damageMin/damageMax; stat buffs into stat/amount/duration). ───────────────
const derive_element = (spell: SeedSpell): string => {
  for (const lvl of spell.levels ?? []) for (const eff of lvl.base_effects ?? []) if (eff.element) return eff.element
  return 'earth'
}

const map_effect = (eff: SeedSpellEffect, fallback_element: string): Record<string, unknown> | null => {
  const element = eff.element ?? fallback_element
  const damages: StatRange = [eff.min ?? 0, eff.max ?? 0]
  if (eff.type === 'damage') return { type: 'damage', element, damages }
  if (eff.type === 'steal' && eff.statistic === 'health') return { type: 'life_steal', element, damages }
  if (eff.type === 'heal') return { type: 'heal', element, damages }
  if (eff.type === 'add')
    return {
      type: 'add',
      stat: map_stat_key(eff.statistic ?? ''),
      amount: eff.max ?? eff.min ?? 0,
      duration: eff.turns ?? 0,
    }
  return null
}

const map_spell = (class_id: string, key: string, spell: SeedSpell): SimSpellTemplate => {
  const element = derive_element(spell)
  const keyframes: Record<string, unknown> = {}
  ;(spell.levels ?? []).forEach((lvl, i) => {
    keyframes[String(i + 1)] = {
      cooldown: lvl.turns_to_recast ?? 0,
      stamina_cost: lvl.cost ?? 0,
      aoe: lvl.area ?? 0,
      effects: (lvl.base_effects ?? []).map((e) => map_effect(e, element)).filter(Boolean),
    }
  })
  return { id: `${class_id}_${key}`, name: spell.name ?? key, element, levelsJson: JSON.stringify(keyframes) }
}

const SPELLS_BY_CLASS: Record<string, SimSpellTemplate[]> = Object.fromEntries(
  Object.entries(SPELLS).map(([class_id, spells]) => [
    class_id,
    Object.entries(spells).map(([key, spell]) => map_spell(class_id, key, spell)),
  ])
)

export const seed_spells_for_class = (class_id: string): SimSpellTemplate[] => SPELLS_BY_CLASS[class_id] ?? []
