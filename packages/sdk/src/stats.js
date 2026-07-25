// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import CLASSES from './classes.json' with { type: 'json' }
import { experience_to_level } from './experience.js'

// ANNEX §4c, FROZEN: it rides with the immutable XP curve, it is not an admin dial.
// VERBATIM from `aresrpg_foundation::progression_math` HP_PER_LEVEL.
const HP_PER_LEVEL = 5

// Worn-item rows carry the canonical Move stat vocabulary (item_stats::ItemStatistics: `action`/`movement`),
// while character documents use the ap/mp shorthand — the display lookup must accept both or gear AP/MP
// bonuses silently vanish from every non-fight stat surface.
const ITEM_STAT_ALIASES = { ap: 'action', mp: 'movement' }

/** @type {(item: import("./../types.js").SuiItem | import("./../types.js").ItemStatistics | null | undefined, stat: string) => number} */
function get_item_stat(item, stat) {
  return item?.[stat] ?? item?.[ITEM_STAT_ALIASES[stat]] ?? 0
}

function get_base_stat(character, stat) {
  switch (stat) {
    case STATISTICS.ACTION:
      return 6
    case STATISTICS.MOVEMENT:
      return 3
    // range, critical hit, raw damage + the 4 resistances have no on-character base (equipment only) — pure
    // equipment sums. In particular, live combat never derives critical hit from agility.
    case STATISTICS.RANGE:
    case STATISTICS.CRITICAL:
    case STATISTICS.RAW_DAMAGE:
    case STATISTICS.EARTH_RESISTANCE:
    case STATISTICS.FIRE_RESISTANCE:
    case STATISTICS.WATER_RESISTANCE:
    case STATISTICS.AIR_RESISTANCE:
      return 0
    default:
      return Number(character?.[stat] ?? 0)
  }
}

/** Fight-authoritative equipment contribution, with legacy flat-slot fallbacks for simulator fixtures. */
/** @type {(character: import("./../types.js").SuiCharacter, stat: string) => number} */
export function get_equipment_stat(character, stat) {
  if (character?.equipment_stats != null)
    return get_item_stat(character.equipment_stats, stat)
  if (stat === STATISTICS.VITALITY && character?.gear_vitality != null)
    return Number(character.gear_vitality)

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
  return items.reduce((sum, item) => sum + get_item_stat(item, stat), 0)
}

/** Allocated/base value plus the exact equipment aggregate, floored like `spell::stats_sub`. */
/** @type {(character: import("./../types.js").SuiCharacter, stat: string) => number} */
export function get_total_stat(character, stat) {
  return Math.max(0, get_base_stat(character, stat) + get_equipment_stat(character, stat))
}

/**
 * Per-class BASE HP — read off the SDK's own class table, whose `health` column IS the twin of
 * `aresrpg::config` default_classes() (§17.31 / ANNEX §4); the parity test pins the two tables equal so they
 * cannot drift apart. Total function: an unknown/absent slug (a mob row, a not-yet-hydrated party card) falls
 * back to Senshi's baseline rather than returning NaN — the same policy the client's HP surfaces already run.
 * THE off-chain home for this fact — the frontend re-exports it rather than carrying its own table (#878).
 * The rows are the on-chain INIT defaults; they stay chain-truthful only while no `config::set_class_base_hp`
 * is ever composed (none is, on any surface), since the indexer projects `ClassRowSet` events and never the
 * init defaults — the first admin tune makes a `/v1/config.classes[class_id]` override the required source.
 * @type {(classe: string | null | undefined) => number}
 */
export function base_hp_for_class(classe) {
  return Number(CLASSES[String(classe ?? '')]?.health ?? CLASSES.senshi.health)
}

/**
 * Max HP over a class BASE at `level` with `vitality` — VERBATIM from `progression_math::max_hp_from_base`
 * (ANNEX §4c, FROZEN): base, plus 5 per level GAINED (level 1 grants none), plus the vitality TOTAL folded
 * into the pool. THE off-chain home for this kernel; the frontend re-exports it (#878).
 * @type {(base_hp: number, level: number, vitality: number) => number}
 */
export function max_hp_from_base(base_hp, level, vitality) {
  const growth = level > 1 ? (level - 1) * HP_PER_LEVEL : 0
  return base_hp + growth + vitality
}

/**
 * Max HP — the deterministic twin of `aresrpg::progression::max_hp` (progression.move:34), i.e.
 * `progression_math::max_hp_from_base(config::base_hp(row), level, vitality)`, over total effective vitality
 * (allocated + the signed equipment aggregate, floored at zero). The class base is the whole point — a
 * class-blind flat base put the client 35 points under the chain for a level-1 Senshi (#867).
 * @type {(character: import("./../types.js").SuiCharacter) => number}
 */
export function get_max_health(character) {
  const level = experience_to_level(character.experience)
  return max_hp_from_base(base_hp_for_class(character?.classe), level, get_total_stat(character, 'vitality'))
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
 * critical hit + raw damage + the 4 elemental resistances are pure equipment sums (`get_total_stat`).
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
      unit: 'unit',
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
