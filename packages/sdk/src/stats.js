// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { experience_to_level } from './experience.js'

const LIFE_PER_LEVEL = 5
const BASE_LIFE = 30

// Worn-item rows carry the canonical Move stat vocabulary (item_stats::ItemStatistics: `action`/`movement`),
// while character documents use the ap/mp shorthand — the display lookup must accept both or gear AP/MP
// bonuses silently vanish from every non-fight stat surface.
const ITEM_STAT_ALIASES = { ap: 'action', mp: 'movement' }

/** @type {(item: import("./../types.js").SuiItem, stat: string) => number} */
function get_item_stat(item, stat) {
  return item?.[stat] ?? item?.[ITEM_STAT_ALIASES[stat]] ?? 0
}

function get_base_stat(character, stat) {
  switch (stat) {
    case STATISTICS.ACTION:
      return 6
    case STATISTICS.MOVEMENT:
      return 3
    case STATISTICS.CRITICAL:
      return Math.round(get_total_stat(character, STATISTICS.AGILITY) / 40)
    // range, raw damage + the 4 resistances have no on-character base (equipment only) — pure equipment sums.
    case STATISTICS.RANGE:
    case STATISTICS.RAW_DAMAGE:
    case STATISTICS.EARTH_RESISTANCE:
    case STATISTICS.FIRE_RESISTANCE:
    case STATISTICS.WATER_RESISTANCE:
    case STATISTICS.AIR_RESISTANCE:
      return 0
    default:
      return character[stat]
  }
}

/** @type {(character: import("./../types.js").SuiCharacter, stat: string) => number} */
export function get_total_stat(character, stat) {
  const {
    hat,
    amulet,
    cloak,
    left_ring,
    right_ring,
    belt,
    boots,
    pet,
    weapon,
    relic_1,
    relic_2,
    relic_3,
    relic_4,
    relic_5,
    relic_6,
    title,
  } = character

  const items = [
    hat,
    amulet,
    cloak,
    left_ring,
    right_ring,
    belt,
    boots,
    pet,
    weapon,
    relic_1,
    relic_2,
    relic_3,
    relic_4,
    relic_5,
    relic_6,
    title,
  ]
  const item_stats = items.map(item => get_item_stat(item, stat))
  return (
    get_base_stat(character, stat) +
    item_stats.reduce((acc, val) => acc + val, 0)
  )
}

/** @type {(character: import("./../types.js").SuiCharacter) => number} */
export function get_max_health(character) {
  const level = experience_to_level(character.experience)
  const vitality = get_total_stat(character, 'vitality')
  // it's okay to include lvl 1 here, let's start at 25
  const life_level_bonus = level * LIFE_PER_LEVEL
  return BASE_LIFE + life_level_bonus + vitality
}

/**
 * One read-only derived secondary stat surfaced in the stats menu (not allocatable).
 * @typedef {object} SecondaryStat
 * @property {string} key    stable id (matches STATISTICS where one exists)
 * @property {string} label  display label
 * @property {number} value  computed value (base + equipment)
 * @property {'unit' | 'percent'} unit
 */

/**
 * Derived secondary stats — READ ONLY. SSOT for the stats menu's "Secondary" section.
 * Faithful to the reference corpus ("Derived stats ... come from equipment at runtime"):
 * raw damage + heal + the 4 elemental resistances are pure equipment sums (`get_total_stat`),
 * critical hit follows the existing SDK base formula (agility / 40 + equipment).
 * NO pods row — inventory is unlimited, carry weight is retired (SPEC §, design ruling 2026-07-15).
 *
 * NO initiative row — §17.28 turn order is a stat-free GLOBAL INTERLEAVE (join/placement order breaks ties),
 * so there is no initiative stat to surface (see @aresrpg/sim `generate_turn_order`).
 * @type {(character: import("./../types.js").SuiCharacter) => SecondaryStat[]}
 */
export function get_secondary_stats(character) {
  return [
    {
      key: STATISTICS.CRITICAL,
      label: 'Critical hit',
      value: get_total_stat(character, STATISTICS.CRITICAL),
      unit: 'percent',
    },
    {
      key: STATISTICS.RAW_DAMAGE,
      label: 'Raw damage',
      value: get_total_stat(character, STATISTICS.RAW_DAMAGE),
      unit: 'unit',
    },
    {
      key: STATISTICS.EARTH_RESISTANCE,
      label: 'Earth resist',
      value: get_total_stat(character, STATISTICS.EARTH_RESISTANCE),
      unit: 'percent',
    },
    {
      key: STATISTICS.FIRE_RESISTANCE,
      label: 'Fire resist',
      value: get_total_stat(character, STATISTICS.FIRE_RESISTANCE),
      unit: 'percent',
    },
    {
      key: STATISTICS.WATER_RESISTANCE,
      label: 'Water resist',
      value: get_total_stat(character, STATISTICS.WATER_RESISTANCE),
      unit: 'percent',
    },
    {
      key: STATISTICS.AIR_RESISTANCE,
      label: 'Air resist',
      value: get_total_stat(character, STATISTICS.AIR_RESISTANCE),
      unit: 'percent',
    },
  ]
}

/** The 6 allocatable primary stat keys (order = display order). */
export const STATISTICS_PRIMARY = /** @type {const} */ ([
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
])

export const STATISTICS = {
  VITALITY: 'vitality',
  WISDOM: 'wisdom',
  STRENGTH: 'strength',
  INTELLIGENCE: 'intelligence',
  CHANCE: 'chance',
  AGILITY: 'agility',

  RANGE: 'range',
  MOVEMENT: 'mp',
  ACTION: 'ap',
  CRITICAL: 'critical',
  RAW_DAMAGE: 'raw_damage',
  CRITICAL_CHANCE: 'critical_chance',
  CRITICAL_OUTCOMES: 'critical_outcomes',
  EARTH_RESISTANCE: 'earth_resistance',
  FIRE_RESISTANCE: 'fire_resistance',
  WATER_RESISTANCE: 'water_resistance',
  AIR_RESISTANCE: 'air_resistance',
}
