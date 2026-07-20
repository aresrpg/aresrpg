// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export interface ClassDef {
  id: string
  display: string
  title: string
  weapon: string
  health: number
  stamina: number
}

export const CLASSES: ClassDef[] = [
  { id: 'SENSHI', display: 'Senshi', title: 'Warrior', weapon: 'LONGSWORD', health: 70, stamina: 80 },
  { id: 'YAJIN', display: 'Yajin', title: 'Assassin', weapon: 'DAGGERS', health: 45, stamina: 120 },
  { id: 'IKARI', display: 'Ikari', title: 'Berserker', weapon: 'BATTLEAXE', health: 120, stamina: 40 },
  { id: 'MORI', display: 'Mori', title: 'Druid', weapon: 'SPEAR', health: 55, stamina: 90 },
  { id: 'TOKEI', display: 'Tokei', title: 'Chronomancer', weapon: 'STAFF', health: 45, stamina: 120 },
  { id: 'SHUGO', display: 'Shugo', title: 'Guardian', weapon: 'SPELLBOOK', health: 50, stamina: 80 },
  { id: 'YOGEN', display: 'Yogen', title: 'Archer', weapon: 'BOW', health: 30, stamina: 90 },
  { id: 'ROJIN', display: 'Rojin', title: 'Prospector', weapon: 'AXE', health: 50, stamina: 60 },
  { id: 'SHUSEN', display: 'Shusen', title: 'Brawler', weapon: 'MACE', health: 65, stamina: 70 },
  { id: 'TOMODA', display: 'Tomoda', title: 'Tomoda', weapon: 'CLUB', health: 30, stamina: 110 },
  { id: 'ASOBI', display: 'Asobi', title: 'Gambler', weapon: 'SWORD', health: 55, stamina: 70 },
  { id: 'IYASHI', display: 'Iyashi', title: 'Healer', weapon: 'STAFF', health: 50, stamina: 120 },
]

export const EQUIPMENT_SLOTS = [
  'HEAD',
  'CHEST',
  'AMULET',
  'RING1',
  'RING2',
  'BELT',
  'FEET',
  'WEAPON',
  'HANDS',
  'PET',
  'RELIC1',
  'RELIC2',
  'RELIC3',
  'RELIC4',
  'RELIC5',
  'RELIC6',
  'LEGS',
] as const

export const SLOT_CATEGORIES: Record<string, string[]> = {
  HEAD: ['HELMET'],
  CHEST: ['CHESTPLATE'],
  AMULET: ['AMULET'],
  RING1: ['RING'],
  RING2: ['RING'],
  BELT: ['BELT'],
  FEET: ['BOOTS'],
  WEAPON: ['LONGSWORD', 'DAGGERS', 'BOW', 'SPEAR', 'STAFF', 'AXE', 'SPELLBOOK', 'BATTLEAXE', 'SWORD', 'CLUB', 'MACE'],
  HANDS: ['GAUNTLETS'],
  PET: ['PET'],
  RELIC1: ['RELIC'],
  RELIC2: ['RELIC'],
  RELIC3: ['RELIC'],
  RELIC4: ['RELIC'],
  RELIC5: ['RELIC'],
  RELIC6: ['RELIC'],
  LEGS: ['PANTS'],
}

export const BASE_STATS = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility'] as const
export type BaseStats = Record<(typeof BASE_STATS)[number], number>

export const ELEMENT_STAT_MAP: Record<string, string> = {
  earth: 'strength',
  EARTH: 'strength',
  fire: 'intelligence',
  FIRE: 'intelligence',
  water: 'chance',
  WATER: 'chance',
  air: 'agility',
  AIR: 'agility',
}

/** Extract max stats from a template's stats object. Stats are stored as [min, max] ranges or plain numbers. */
export function max_stats_from_template(stats: Record<string, number | [number, number]>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(stats)) {
    result[key] = Array.isArray(val) ? val[1] : val
  }
  return result
}

/** Sum all equipment stats + base stat allocations into a single stat map */
export function compute_total_stats(
  base_stats: BaseStats,
  equipment_stats: Record<string, number>[]
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const [key, val] of Object.entries(base_stats)) {
    totals[key] = (totals[key] || 0) + val
  }
  for (const eq of equipment_stats) {
    for (const [key, val] of Object.entries(eq)) {
      totals[key] = (totals[key] || 0) + val
    }
  }
  return totals
}

/** maxHealth = classHealth + (level - 1) * 5 + totalVitality */
export function compute_max_health(class_health: number, level: number, total_vitality: number): number {
  return class_health + (level - 1) * 5 + total_vitality
}

/** maxStamina = max(5, classStamina + totalStamina) */
export function compute_max_stamina(class_stamina: number, total_stamina: number): number {
  return Math.max(5, class_stamina + total_stamina)
}

/** speed = (3 + equipmentSpeed) * (1 + clamp(agility / 10, 0, 30) / 100) */
export function compute_speed(total_agility: number, equipment_speed: number = 0): number {
  const base_speed = 3 + equipment_speed
  const bonus = Math.min(30, Math.max(0, total_agility / 10))
  return +(base_speed * (1 + bonus / 100)).toFixed(2)
}

/** healthRegen = max(1.0, (level * 2/5 + wisdom/15) / 5)  (per second) */
export function compute_health_regen(level: number, total_wisdom: number): number {
  return +Math.max(1, ((level * 2) / 5 + total_wisdom / 15) / 5).toFixed(2)
}

/** staminaRegen = level * 3 / 20  (per second) */
export function compute_stamina_regen(level: number): number {
  return +((level * 3) / 20).toFixed(2)
}

/** critDenom = max(2, 100 - critStat). Crit chance is 1/denom. */
export function compute_crit_denom(crit_stat: number): number {
  return Math.max(2, 100 - crit_stat)
}

/** Total stat points available at a given level: (level - 1) * 5 */
export function compute_stat_points(level: number): number {
  return (level - 1) * 5
}

export interface DamageOutput {
  element: string
  damage_type: string
  min_normal: number
  max_normal: number
  crit_damage: number
  crit_denom: number
}

/** Compute damage output for each damage line */
export function compute_damage(
  damages: { element: string; from: number; to: number; damage_type?: string }[],
  total_stats: Record<string, number>
): DamageOutput[] {
  const crit_stat = total_stats.criticalHit || 0
  const raw_damage = total_stats.rawDamage || 0
  const denom = Math.max(2, 100 - crit_stat)

  return damages.map(({ element, from, to, damage_type }) => {
    const stat_key = ELEMENT_STAT_MAP[element] || ''
    const element_stat = total_stats[stat_key] || 0

    const min_normal = Math.max(0, Math.floor((from * (100 + element_stat)) / 100 + raw_damage))
    const max_normal = Math.max(0, Math.floor((to * (100 + element_stat)) / 100 + raw_damage))
    const crit_damage = Math.max(0, Math.floor((to * 1.4 * (100 + element_stat)) / 100 + raw_damage))

    return {
      element,
      damage_type: damage_type || 'damage',
      min_normal,
      max_normal,
      crit_damage,
      crit_denom: denom,
    }
  })
}

export function snake_to_camel(s: string): string {
  const parts = s.split('_')
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  )
}

function build_level(def: any): any {
  const effects = (def.effects || []).map((eff: any) => {
    const out: any = {}
    for (const [k, v] of Object.entries(eff)) {
      if (k === 'damages' && Array.isArray(v)) {
        out.damageMin = Number(v[0] ?? 0)
        out.damageMax = Number(v[1] ?? 0)
      } else {
        out[snake_to_camel(k)] = v
      }
    }
    return out
  })
  return {
    cooldown: Number(def.cooldown ?? 1),
    stamina_cost: Math.round(Number(def.stamina_cost ?? 0)),
    aoe: def.aoe ?? 0,
    effects,
  }
}

function interpolate_level(lower_def: any, upper_def: any, eased: number): any {
  const cooldown =
    Math.round(
      (Number(lower_def.cooldown ?? 1) + (Number(upper_def.cooldown ?? 1) - Number(lower_def.cooldown ?? 1)) * eased) *
        100
    ) / 100
  const stamina_cost = Math.round(
    Number(lower_def.stamina_cost ?? 0) +
      (Number(upper_def.stamina_cost ?? 0) - Number(lower_def.stamina_cost ?? 0)) * eased
  )

  const lower_effects: any[] = lower_def.effects || []
  const upper_effects: any[] = upper_def.effects || []
  const effects = lower_effects.map((l_eff: any, i: number) => {
    const u_eff = i < upper_effects.length ? upper_effects[i] : l_eff
    const out: any = {}
    const all_keys = new Set([...Object.keys(l_eff), ...Object.keys(u_eff)])

    for (const key of all_keys) {
      const lv = l_eff[key]
      const uv = key in u_eff ? u_eff[key] : lv

      if (key === 'damages' && Array.isArray(lv)) {
        const l_min = Number(lv[0] ?? 0),
          l_max = Number(lv[1] ?? 0)
        const u_min = Array.isArray(uv) ? Number(uv[0] ?? 0) : l_min
        const u_max = Array.isArray(uv) ? Number(uv[1] ?? 0) : l_max
        out.damageMin = Math.round(l_min + (u_min - l_min) * eased)
        out.damageMax = Math.round(l_max + (u_max - l_max) * eased)
      } else if (typeof lv === 'number' && typeof uv === 'number') {
        const interpolated = lv + (uv - lv) * eased
        const camel = snake_to_camel(key)
        out[camel] = Number.isInteger(lv) ? Math.round(interpolated) : Math.round(interpolated * 100) / 100
      } else {
        out[snake_to_camel(key)] = lv
      }
    }
    return out
  })

  const lower_aoe = Number(lower_def.aoe ?? 0)
  const upper_aoe = Number(upper_def.aoe ?? 0)
  const aoe = Math.round(lower_aoe + (upper_aoe - lower_aoe) * eased)

  return { cooldown, stamina_cost, aoe, effects }
}

export function interpolate_levels(levels_json: string): Record<string, any> {
  let raw: Record<string, any>
  try {
    raw = JSON.parse(levels_json || '{}')
  } catch {
    return {}
  }
  if (!Object.keys(raw).length) return {}

  const keyframes = new Map<number, any>()
  for (const [k, v] of Object.entries(raw)) keyframes.set(Number(k), v)
  const sorted_keys = [...keyframes.keys()].sort((a, b) => a - b)
  if (!sorted_keys.length) return {}

  const result: Record<string, any> = {}

  for (let lvl = 1; lvl <= 10; lvl++) {
    let [lower] = sorted_keys
    let upper = sorted_keys[sorted_keys.length - 1]
    for (const k of sorted_keys) {
      if (k <= lvl) lower = k
    }
    for (let i = sorted_keys.length - 1; i >= 0; i--) {
      if (sorted_keys[i] >= lvl) upper = sorted_keys[i]
    }

    if (lower === upper) {
      result[String(lvl)] = build_level(keyframes.get(lower))
    } else {
      const t = (lvl - lower) / (upper - lower)
      const eased = Math.pow(t, 1.5)
      result[String(lvl)] = interpolate_level(keyframes.get(lower), keyframes.get(upper), eased)
    }
  }
  return result
}
