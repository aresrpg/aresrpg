// --- Constants ---

import { QUALITY_COLOR } from '../game/screens/hud/quality'
import { game_log } from '../core/log.js'

// Rarity → text/edge hue. RECONCILED to the ONE canonical ramp: QUALITY_COLOR (quality.js), the design
// SSOT (spec_rarity_tint.md). This is now a pure ALIAS — the old local table's `common: #ffffff` was the
// root D11 defect (white item borders/edges); the canonical common is steel #a9b4c4. Every consumer of
// RARITY_COLORS (name text, row-accent stripes, canvas labels) now reads the same hues the HUD does.
export const RARITY_COLORS: Record<string, string> = QUALITY_COLOR

export const STAT_COLORS: Record<string, string> = {
  strength: '#8b6914',
  intelligence: '#ff4500',
  chance: '#1e90ff',
  agility: '#01be44',
  vitality: '#ff66b2',
  wisdom: '#b366ff',
  speed: '#00cccc',
  criticalHit: '#ffee00',
  criticalChance: '#ffdd00',
  criticalOutcomes: '#ffaa00',
  range: '#7dd3fc',
  rawDamage: '#ffffff',
  stamina: '#ffcc00',
  earthResistance: '#8b6914',
  fireResistance: '#ff4500',
  waterResistance: '#1e90ff',
  airResistance: '#01be44',
  heal: '#ff66b2',
}

export const ELEMENT_COLORS: Record<string, string> = {
  earth: '#8b6914',
  fire: '#ff4500',
  water: '#1e90ff',
  air: '#01be44',
  EARTH: '#8b6914',
  FIRE: '#ff4500',
  WATER: '#1e90ff',
  AIR: '#01be44',
}

export const RANK_COLORS: Record<string, string> = {
  DEFAULT: '#aaaaaa',
  MEMBER: '#55aaff',
  VETERAN: '#55ff55',
  BUILDER: '#ffaa00',
  ADMIN: '#ff5555',
}

export const CATEGORY_COLORS: Record<string, string> = {
  HELMET: '#4a9eff',
  CHESTPLATE: '#4a9eff',
  BELT: '#4a9eff',
  GAUNTLETS: '#4a9eff',
  PANTS: '#4a9eff',
  BOOTS: '#4a9eff',
  LONGSWORD: '#c8963c',
  DAGGERS: '#c8963c',
  BOW: '#c8963c',
  STAFF: '#c8963c',
  AXE: '#c8963c',
  SPELLBOOK: '#c8963c',
  BATTLEAXE: '#c8963c',
  SWORD: '#c8963c',
  CLUB: '#c8963c',
  SPEAR: '#c8963c',
  AMULET: '#c084fc',
  RING: '#c084fc',
  PET: '#4ade80',
  RELIC: '#fbbf24',
  TOOL_HERBALIST: '#22c55e',
  TOOL_PAYSAN: '#22c55e',
  TOOL_MINER: '#22c55e',
  CONSUMABLE: '#6b7280',
  RESOURCE: '#6b7280',
}

// --- Stat label i18n keys ---

export const STAT_LABEL_KEYS: Record<string, string> = {
  vitality: 'stat.vitality',
  stamina: 'stat.stamina',
  wisdom: 'stat.wisdom',
  strength: 'stat.strength',
  intelligence: 'stat.intelligence',
  chance: 'stat.chance',
  agility: 'stat.agility',
  heal: 'stat.heal',
  criticalHit: 'stat.critical_hit',
  criticalChance: 'stat.critical_chance',
  criticalOutcomes: 'stat.critical_outcomes',
  range: 'stat.range',
  rawDamage: 'stat.raw_damage',
  fireResistance: 'stat.fire_resistance',
  waterResistance: 'stat.water_resistance',
  earthResistance: 'stat.earth_resistance',
  airResistance: 'stat.air_resistance',
}

// --- Helpers ---

export function format_stat_name(key: string): string {
  const stripped = key.replace(/^stat/, '')
  // Handles camelCase (criticalHit -> critical Hit) AND snake/kebab-case (crit_rate -> crit rate) —
  // any future stat key shape still humanizes into Title Case words, never a raw key with underscores.
  const words = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
  if (words.length === 0) return stripped
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

export function stat_color_key(key: string): string {
  const stripped = key.replace(/^stat/, '')
  return stripped.charAt(0).toLowerCase() + stripped.slice(1)
}

const warned_stat_keys = new Set<string>()

/**
 * Resolve a stat's display label for the given i18n `t`. Keys missing from STAT_LABEL_KEYS (a seed/
 * validation stat added without updating this map) log ONCE per key
 * (dev signal only) and fall back to a humanized name — NEVER the raw statsJson key reaching the UI.
 */
export function stat_label(t: (key: string, options?: Record<string, unknown>) => string, key: string): string {
  const ck = stat_color_key(key)
  const i18n_key = STAT_LABEL_KEYS[ck]
  if (!i18n_key && !warned_stat_keys.has(key)) {
    warned_stat_keys.add(key)
    game_log('entity_colors', `unmapped stat key "${key}" — add it to STAT_LABEL_KEYS`)
  }
  return t(i18n_key ?? '', { defaultValue: format_stat_name(key) })
}

// NOTE: on-chain item stats are biased +32768, but the decode is the SINGLE responsibility of
// read_templates.js normalize_item_template (see chain/stat_bias.js). statsJson is real-valued
// everywhere it reaches this file, so there is intentionally no display-layer decode here — every
// stat_entries helper below assumes plain (unbiased) numbers.

const STAT_DISPLAY_ORDER: Record<string, number> = {
  vitality: 0,
  stamina: 0,
  wisdom: 0,
  strength: 1,
  intelligence: 1,
  chance: 1,
  agility: 1,
  heal: 2,
  criticalHit: 2,
  criticalChance: 2,
  criticalOutcomes: 2,
  range: 2,
  rawDamage: 2,
  fireResistance: 3,
  waterResistance: 3,
  earthResistance: 3,
  airResistance: 3,
}

export function sort_stat_entries(entries: [string, any][]): [string, any][] {
  return [...entries].sort((a, b) => {
    const ga = STAT_DISPLAY_ORDER[stat_color_key(a[0])] ?? 4
    const gb = STAT_DISPLAY_ORDER[stat_color_key(b[0])] ?? 4
    if (ga !== gb) return ga - gb
    return format_stat_name(a[0]).localeCompare(format_stat_name(b[0]), undefined, { sensitivity: 'base' })
  })
}
