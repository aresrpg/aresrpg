// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// draft-budget.js — the PURE turn-draft gating math the dungeon board rides on: the client mirror of
// aresrpg_fight::cast::enforce_and_record_cast (cooldown / casts_per_target) + the give_points(MP) fold +
// the auto-commit buffer the visible turn timer shares. Extracted here (no React) so the subtle across-turn
// cooldown math has ONE home, unit-tested directly, instead of a component-inlined predicate mirrored in a
// test that can silently drift. DungeonBoard WIRES these into its castable gate + optimistic movement pool;
// FightTimeline reads only COMMIT_BUFFER_MS. Chain refs: packages/move/engine/sources/cast.move
// (enforce_and_record_cast), participant.move (give_points is UNCAPPED → a +MP grant IS real movement MP now).

/** spell_effect::point_mp — the GIVE_POINTS `stat` discriminator for the MP pool (0 = AP, 1 = MP). */
export const POINT_MP = 1

// AUTO-COMMIT lead time (ms): the deadline auto-flush fires this early so the signed commit LANDS before
// turn_deadline_ms (past which liquidation's public pass_turn can forfeit a moved-but-unended turn, D36). The
// VISIBLE turn timer (FightTimeline) counts to `deadline − this` WHILE A DRAFT EXISTS, so the clock never reads
// "time left" after the draft has already locked/auto-committed — one honest deadline. r8's outside-sandbox trace
// measured 2.6s from the old T−1s fire point to the chain refusal. Keep 5s of submit room on the default 45s turn;
// `auto_commit_fire_at` clamps shorter admin dials to the contract's legal 3s floor.
// Manual END TURN (the common path) is unaffected — it commits foreground, no buffer.
export const COMMIT_BUFFER_MS = 5_000
export const CHAIN_MIN_TURN_MS = 3_000

/** Absolute auto-submit instant. The chain stamps `deadline = start + turn_ms + 3s * resolved_mobs`; because the
 *  per-mob extension is already inside `deadline`, never re-anchor it to receipt/presentation time here. A short
 *  admin dial cannot fire before actions.move::assert_min_turn permits its terminal pass. */
export function auto_commit_fire_at(deadline, turn_ms, buffer = COMMIT_BUFFER_MS, min_turn_ms = CHAIN_MIN_TURN_MS) {
  if (!(Number(deadline) > 0)) return Number(deadline) || 0
  const desired = Number(deadline) - buffer
  return Number(turn_ms) > 0 ? Math.max(desired, Number(deadline) - Number(turn_ms) + min_turn_ms) : desired
}

/** MP granted by ONE spell's level-1 give_points(MP) effects — e.g. Vanish's +MP (seed kind:6 / stat:1). 0 for
 *  a level with no such effect (or a null level / the weapon). @param {any} level a fight-spells level row */
export function spell_mp_grant(level) {
  return (level?.effects ?? [])
    .filter((e) => e.kind === 'GIVE_POINTS' && e.stat === POINT_MP)
    .reduce((sum, e) => sum + (e.base ?? 0), 0)
}

/** Compatibility helper for a specific move: a grant funds it exactly when that cast precedes that move in the
 * ordered draft. Current prefix projections fold this directly into presented MP.
 * @param {boolean} cast_before_move @param {number} grant @returns {number} */
export function movement_grant(cast_before_move, grant) {
  return cast_before_move ? (grant ?? 0) : 0
}

/** Cross-turn cooldown lock — the exact cast.move rule: recastable only when `current − last > cooldown`
 *  (C=0 never locks; no prior cast = free). `current`/`last` are the caster's OWN turn counters (seat_turn),
 *  so a cooldown counts the caster's own turns. @param {number|undefined|null} last_cast_turn
 *  @param {number} current_turn @param {number} cooldown @returns {boolean} */
export function on_cooldown(last_cast_turn, current_turn, cooldown) {
  if (!cooldown || last_cast_turn == null) return false
  return current_turn - last_cast_turn <= cooldown
}

/** Turns until a cooldown spell is recastable (0 = free now) — drives the honest "N more turns" cue.
 *  @param {number|undefined|null} last_cast_turn @param {number} current_turn @param {number} cooldown */
export function cooldown_left(last_cast_turn, current_turn, cooldown) {
  if (!cooldown || last_cast_turn == null) return 0
  return Math.max(0, cooldown - (current_turn - last_cast_turn) + 1)
}

/** #368 — the hotbar's cooldown DISPLAY projection: same inputs as cooldown_left above (one home, no parallel
 *  cooldown store), composed into the exact shape the socket's grey+big-centered-number treatment renders.
 *  `greyed` and `turns_left > 0` always agree (cooldown_left ⇔ on_cooldown, same `d <= cooldown` boundary) —
 *  this is the ONE derivation, never a second on_cooldown call recomputing the same fact.
 *  @param {number|undefined|null} last_cast_turn @param {number} current_turn @param {number} cooldown
 *  @returns {{ greyed: boolean, turns_left: number }} */
export function cooldown_display(last_cast_turn, current_turn, cooldown) {
  const turns_left = cooldown_left(last_cast_turn, current_turn, cooldown)
  return { greyed: turns_left > 0, turns_left }
}

/** casts_per_target accounting: how many of `spell_key` are already drafted at `cell` this turn (from the
 *  live cast_path). The chain caps this per (spell, cell) per turn; compare against cap_of(casts_per_target). */
export function casts_at_cell(cast_path, spell_key, cell) {
  return (cast_path ?? []).reduce((n, e) => (e.spell_key === spell_key && e.cell === cell ? n + 1 : n), 0)
}

/** An authored per-turn / per-target cap → a usable number: the spell_bands UNLIMITED sentinels (255 / 0) or
 *  null → Infinity, else the count itself. @param {number|null|undefined} authored @returns {number} */
export function cap_of(authored) {
  return authored == null || authored === 255 || authored === 0 ? Infinity : authored
}

/** The visible turn deadline the timer should count to: while a draft exists it counts to the auto-commit
 *  moment (deadline − buffer) so "time left but locked" never shows; idle (no draft) counts to the raw deadline
 *  (the turn runs full length — liquidation ends it there). @param {number} deadline @param {boolean} has_draft
 *  @param {number} [buffer] @returns {number} */
export function effective_deadline(deadline, has_draft, buffer = COMMIT_BUFFER_MS, turn_ms = 0) {
  return has_draft && deadline > 0 ? auto_commit_fire_at(deadline, turn_ms, buffer) : deadline
}
