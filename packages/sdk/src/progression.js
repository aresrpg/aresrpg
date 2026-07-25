// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHARACTER PROGRESSION POINTS — the frozen per-level grants and the spell-point cost curve, as pure scalar
// transforms. SSOT: packages/move/foundation/sources/progression_math.move (`points_for_level_range`) and
// packages/move/aresrpg/sources/spell_level.move (the S8 escalating raise cost). Port any change from those
// modules verbatim; never re-derive these numbers at a call site.
//
// WHY THIS FILE EXISTS: the same two facts ("5 stat + 1 spell point per level from 2" and "raising a spell to
// `target` costs `target − 1`") had four independent homes across the app — the level-up event module, the
// in-game build drawer, the spellbook, and the simulator's page reducer. A budget the world computes one way
// and the simulator computes another is a divergence by construction, so the rule lives here and every surface
// reads it. The world's spellbook spends MARGINAL points (one raise at a time, `spell_upgrade_cost`); the
// simulator authors a whole build at once and needs the CUMULATIVE sunk cost (`spell_points_invested`) — the
// latter is DERIVED from the former (Σ over the raises), never a second formula.

/** SPEC §3 — each level from 2 grants 5 stat points (progression_math.move STAT_POINTS_PER_LEVEL). */
export const STAT_POINTS_PER_LEVEL = 5

/** SPEC §3 — each level from 2 grants 1 spell point (progression_math.move SPELL_POINTS_PER_LEVEL). */
export const SPELL_POINTS_PER_LEVEL = 1

/**
 * Points granted by leveling from `from_level` to `to_level` — the JS twin of
 * `progression_math.move points_for_level_range`. No gain ⇒ no grant.
 * @param {number} from_level @param {number} to_level
 * @returns {{ stat_points: number, spell_points: number }}
 */
export const points_for_level_range = (from_level, to_level) => {
  const gained = Math.max(0, Math.trunc(to_level) - Math.trunc(from_level))
  return {
    stat_points: gained * STAT_POINTS_PER_LEVEL,
    spell_points: gained * SPELL_POINTS_PER_LEVEL,
  }
}

/**
 * Total stat points a character has EARNED by reaching `level` — the grant summed from level 1.
 * @param {number} level @returns {number}
 */
export const stat_points_for_level = level => points_for_level_range(1, level).stat_points

/**
 * Total spell points a character has EARNED by reaching `level` — the grant summed from level 1. This is the
 * `(character level − 1)` the on-chain `character_link::unspent_spell_points` derivation starts from.
 * @param {number} level @returns {number}
 */
export const spell_points_for_level = level => points_for_level_range(1, level).spell_points

/**
 * The spell-point cost to raise ONE spell FROM `current` to `current + 1` — the S8 escalating cost
 * `spell_level.move` asserts (`target − 1 = current`). Level 1 is the free baseline.
 * @param {number} current @returns {number}
 */
export const spell_upgrade_cost = current => Math.max(0, Math.trunc(current))

/**
 * Total spell points sunk into ONE spell that now sits at `level` — Σ `spell_upgrade_cost(c)` for every raise
 * from the free baseline 1 up to `level` (1→6 = 1+2+3+4+5 = 15, spell_level.move's own worked example).
 * DERIVED from the marginal cost above, so the two can never disagree.
 * @param {number} level @returns {number}
 */
export const spell_points_invested = level => {
  const top = Math.max(1, Math.trunc(level))
  return (top * (top - 1)) / 2
}
