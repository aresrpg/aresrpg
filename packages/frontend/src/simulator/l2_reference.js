// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/l2_reference.js — THE L2 REFERENCE ORACLE (#930 rung 2, #747's matrix made deterministic).
//
// A deliberately naive calculator that reads ONE published corpus row and answers what a single cast of it
// must cost, may reach, and may move a hitpoint bar by. It is the ORACLE, so its whole value is independence:
//
//   IT NEVER IMPORTS `@aresrpg/sim` OR `@aresrpg/fight`. Not a formula, not a constant, not an enum.
//
// An oracle that shares code with the system under test proves only that the code equals itself — the
// codec-fixture law (docs/CODE_LAW.md), and exactly why #931 survived a green suite. The effect-kind numbers
// below are transcribed from the PUBLISHED WIRE ENCODING the corpus ships, which is the spec both sides
// implement; if the sim renumbers a kind, this file must go red, and that redness is the point.
//
// STATELESS BY RATIFICATION (#930 fence 1). Every answer is a pure function of (row, level index, geometry).
// No fold, no ordering, no turn counter, no stacking. The moment a case needs STATE to express its
// expectation, it is NOT an L2 case: it is recorded in `l3_vectors.json` and adjudicated by the Move twin.
// That fence is what keeps this an oracle implementing the spec rather than a third implementation of the sim.

/** Effect-kind discriminants, transcribed from the published corpus wire encoding (`effects[].kind`). */
export const KIND = {
  DAMAGE: 0,
  PERCENT_LIFE_DAMAGE: 1,
  LIFE_STEAL: 2,
  CASTER_DAMAGE: 3,
  PUNISHMENT_DAMAGE: 4,
  HEAL: 5,
  REDUCE_DAMAGE: 24,
}

/**
 * THE FORMULA TABLE. One row per effect kind this oracle can express STATELESSLY, and nothing else — an
 * absent kind is not an oversight, it is a declared L3 hand-off (see `l3_vectors.json`).
 *
 * `magnitude` kinds publish an authored `[value, value_max]` band that a cast rolls inside. With a caster
 * carrying ZERO offensive characteristics and a target carrying ZERO resistance — the configuration the
 * matrix builds — the published amplification (`100 + characteristic + percent`) is unity and the resistance
 * reduction is nil, so the rolled magnitude is the authored band verbatim. That is the entire derivation:
 * it reads the data sheet rather than re-deriving the sim's arithmetic.
 */
const FAMILY = {
  [KIND.DAMAGE]: { family: 'damage', magnitude: true, hp_sign: -1 },
  [KIND.LIFE_STEAL]: { family: 'damage', magnitude: true, hp_sign: -1 },
  [KIND.CASTER_DAMAGE]: { family: 'damage', magnitude: true, hp_sign: -1 },
  [KIND.PUNISHMENT_DAMAGE]: { family: 'damage', magnitude: true, hp_sign: -1 },
  [KIND.HEAL]: { family: 'heal', magnitude: true, hp_sign: 1 },
  [KIND.REDUCE_DAMAGE]: { family: 'shield', magnitude: false, hp_sign: 0 },
}

/** Why a scenario did not run. SKIP IS NEVER PASS — every skipped case prints one of these verbatim. */
export const SKIP = {
  NO_MAGNITUDE_FAMILY: 'no_magnitude_family_stateless_expectation_unavailable',
  MIXED_UNMODELLED_EFFECTS: 'level_mixes_a_modelled_band_with_an_unmodelled_kind_no_bound_is_claimable',
  AP_COST_WITHIN_PURSE: 'ap_cost_fits_the_seat_purse_so_no_refusal_can_be_provoked_in_one_cast',
  RANGE_EXCEEDS_ARENA: 'range_exceeds_arena_no_cell_at_that_distance',
  NO_LEGAL_CELL: 'no_walkable_unblocked_cell_satisfying_the_spells_own_geometry',
  SELF_ONLY_RANGE: 'range_max_is_zero_self_cast_has_no_distance_scenarios',
  FREE_CELL_SPELL: 'free_cell_spell_targets_empty_ground_no_victim_to_measure',
  ZERO_AP_COST: 'ap_cost_is_zero_or_exceeds_the_seat_purse_so_no_ap_scenario_exists',
  CAST_LIMIT_BINDS_FIRST: 'casts_per_turn_or_cooldown_binds_before_the_ap_purse_does',
  TARGET_CELL_CONSUMED: 'free_cell_spell_the_first_cast_takes_the_empty_cell_the_second_would_need',
}

/** The published level block at `index`, or null when the row does not carry one. */
export const level_at = (row, index) => row?.levels?.[index] ?? null

/** Sum a band over the effects of one magnitude family. Returns null when the family contributes none. */
const band_of = (effects, family) => {
  const rows = (effects ?? []).filter(
    (effect) => FAMILY[effect?.kind]?.family === family && FAMILY[effect.kind].magnitude
  )
  if (rows.length === 0) return null
  return {
    min: rows.reduce((total, effect) => total + Number(effect.value ?? 0), 0),
    max: rows.reduce((total, effect) => total + Number(effect.value_max ?? effect.value ?? 0), 0),
    // The widest single effect — what ONE hit row may carry when a cast lands several.
    per_effect_min: Math.min(...rows.map((effect) => Number(effect.value ?? 0))),
    per_effect_max: Math.max(...rows.map((effect) => Number(effect.value_max ?? effect.value ?? 0))),
  }
}

/** Union two bands (a cast is either critical or not, so the observable lies in the union). */
const union = (left, right) => {
  if (left === null) return right
  if (right === null) return left
  return {
    min: Math.min(left.min, right.min),
    max: Math.max(left.max, right.max),
    per_effect_min: Math.min(left.per_effect_min, right.per_effect_min),
    per_effect_max: Math.max(left.per_effect_max, right.per_effect_max),
  }
}

/**
 * THE PER-CAST EXPECTATION — everything this oracle claims about one cast of one published row.
 * @param {Record<string, any>} row a corpus row (the L2 fixture's own shape)
 * @param {number} level_index which published level block to read
 */
export const expectation_of = (row, level_index = 0) => {
  const level = level_at(row, level_index)
  if (level === null) return null
  const kinds = [...new Set((level.effects ?? []).map((effect) => Number(effect.kind)))]
  const families = [...new Set(kinds.map((kind) => FAMILY[kind]?.family).filter(Boolean))]
  return {
    id: String(row.id),
    object_id: String(row.object_id),
    role: String(row.role),
    ap_cost: Number(level.ap_cost ?? 0),
    range_min: Number(level.range_min ?? 0),
    range_max: Number(level.range_max ?? 0),
    free_cell: Boolean(level.free_cell),
    kinds,
    families,
    // The hp band a single hit row may carry, crit and non-crit unioned. Null ⇒ no stateless expectation.
    damage: union(band_of(level.effects, 'damage'), band_of(level.crit_effects, 'damage')),
    // A magnitude band is only a claim about the OBSERVABLE when every effect on the level is one this table
    // models. A row that also carries an unmodelled kind (a percent-of-life bite, a stateful rider) lands hit
    // rows this oracle cannot bound, and asserting the modelled band over all of them would indict the sim for
    // the oracle's own blind spot. Mixed rows state no magnitude claim at all.
    purely_modelled: kinds.length > 0 && kinds.every((kind) => FAMILY[kind] !== undefined),
  }
}
