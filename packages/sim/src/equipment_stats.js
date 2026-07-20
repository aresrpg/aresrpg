// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AresRPG equipment snapshot fold. Item stats are centered u16 values: 32768 is neutral, values above add,
// and values below subtract. Deltas are summed before the zero floor so the result is independent of item order.

export const ITEM_STAT_SHIFT = 32_768

export const ITEM_STAT_CATALOG_ORDER = Object.freeze([
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'critical_chance',
  'critical_outcomes',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
])

/** @type {Readonly<Record<string, keyof import('./fight_state.js').Stats | null>>} */
export const ITEM_STAT_FOLD_MAPPING = Object.freeze({
  vitality: 'vitality',
  wisdom: 'wisdom',
  strength: 'strength',
  intelligence: 'intelligence',
  chance: 'chance',
  agility: 'agility',
  range: 'range',
  movement: 'mp_bonus',
  action: 'ap_bonus',
  critical: 'critical_hit',
  raw_damage: 'raw_damage',
  critical_chance: null,
  critical_outcomes: null,
  earth_resistance: 'earth_resistance',
  fire_resistance: 'fire_resistance',
  water_resistance: 'water_resistance',
  air_resistance: 'air_resistance',
})

/** @typedef {Partial<Record<(typeof ITEM_STAT_CATALOG_ORDER)[number], number>> | number[]} CenteredItemStats */

const centered_value = (item, key, index) =>
  Number((Array.isArray(item) ? item[index] : item[key]) ?? ITEM_STAT_SHIFT)

/**
 * Fold centered equipment blocks into the immutable fight-start snapshot and AP/MP refill scalars.
 * The corpus-only `critical_chance` and `critical_outcomes` fields are deliberately not combat consumers.
 * @param {import('./fight_state.js').Stats} base_stats
 * @param {number} base_ap
 * @param {number} base_mp
 * @param {CenteredItemStats[]} centered_items
 * @returns {{ stats: import('./fight_state.js').Stats, ap_max: number, mp_max: number }}
 */
export const fold_equipment_snapshot = (
  base_stats,
  base_ap,
  base_mp,
  centered_items,
) => {
  /** @type {Record<string, number>} */
  const deltas = {}
  let ap_delta = 0
  let mp_delta = 0

  for (const item of centered_items) {
    ITEM_STAT_CATALOG_ORDER.forEach((key, index) => {
      const target = ITEM_STAT_FOLD_MAPPING[key]
      if (target === null) return
      const delta = centered_value(item, key, index) - ITEM_STAT_SHIFT
      if (target === 'ap_bonus') ap_delta += delta
      else if (target === 'mp_bonus') mp_delta += delta
      deltas[target] = (deltas[target] ?? 0) + delta
    })
  }

  const stats = /** @type {import('./fight_state.js').Stats} */ (
    Object.fromEntries(
      Object.entries(base_stats).map(([key, value]) => [
        key,
        Math.max(0, value ?? 0),
      ]),
    )
  )
  for (const [key, delta] of Object.entries(deltas)) {
    const stat = /** @type {keyof import('./fight_state.js').Stats} */ (key)
    stats[stat] = Math.max(0, (stats[stat] ?? 0) + delta)
  }

  return {
    stats,
    ap_max: Math.max(0, base_ap + ap_delta),
    mp_max: Math.max(0, base_mp + mp_delta),
  }
}
