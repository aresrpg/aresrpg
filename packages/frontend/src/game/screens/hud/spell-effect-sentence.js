// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Move effect-id → `stat.*` i18n leaf maps that seed-effect-line's STAT_VIEW/POINT_VIEW derive from.

/** The one home for POINT_AP/POINT_MP id → `stat.*` i18n leaf — seed-effect-line's POINT_VIEW derives from it. */
export const point_keys = Object.freeze({
  0: 'stat.action',
  1: 'stat.movement',
})

/** The one home for Move STAT_* id (spell_effect.move:135-149) → `stat.*` i18n leaf — STAT_VIEW derives from it. */
export const stat_keys = Object.freeze({
  0: 'stat.strength',
  1: 'stat.intelligence',
  2: 'stat.chance',
  3: 'stat.agility',
  4: 'stat.wisdom',
  5: 'stat.vitality',
  6: 'stat.range',
  7: 'stat.critical_hit',
  8: 'stat.percent_damage',
  9: 'stat.raw_damage',
  10: 'stats.health',
  11: 'stat.heal',
})
