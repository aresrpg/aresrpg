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

/** THE TURN-HANDOVER INSTANT — when the chain has finished spending this turn's MOB-RESOLUTION budget, i.e.
 *  when the turn actually becomes the player's (#1808). `resolve_from` stamps
 *  `deadline = start + turn_ms + 3s * resolved_mobs`, so `deadline − turn_ms` IS that instant, widening and
 *  all. The client's own paced replay of those same mobs is only a GUESS at it and can drain faster (mobile,
 *  skipped animations) — handing the turn over on the guess is what produced a granted-then-retracted turn.
 *  0 when the dial or the deadline is unknown: a starved read must never fabricate a boundary and lock a
 *  player out of a turn the chain already gave them. */
export function turn_handover_at(deadline, turn_ms) {
  return Number(deadline) > 0 && Number(turn_ms) > 0 ? Number(deadline) - Number(turn_ms) : 0
}

/** THE CHAIN'S OWN earliest legal end-turn instant — the single home for `actions.move::assert_min_turn`
 *  (`now + turn_ms >= turn_deadline_ms + MIN_TURN_MS`) read as an absolute ms: the handover above plus the
 *  anti-instant-pass floor. Never re-anchor it to receipt/presentation time. 0 when the dial or the deadline
 *  is unknown — a starved read must never fabricate a floor. */
export function chain_min_turn_at(deadline, turn_ms, min_turn_ms = CHAIN_MIN_TURN_MS) {
  const handover = turn_handover_at(deadline, turn_ms)
  return handover > 0 ? handover + min_turn_ms : 0
}

/** Absolute auto-submit instant. A short admin dial cannot fire before the chain floor above permits its
 *  terminal pass. */
export function auto_commit_fire_at(deadline, turn_ms, buffer = COMMIT_BUFFER_MS, min_turn_ms = CHAIN_MIN_TURN_MS) {
  if (!(Number(deadline) > 0)) return Number(deadline) || 0
  const desired = Number(deadline) - buffer
  const chain_floor = chain_min_turn_at(deadline, turn_ms, min_turn_ms)
  return chain_floor > 0 ? Math.max(desired, chain_floor) : desired
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

/** An authored per-turn / per-target cap → the number of casts the chain accepts. Only 255 is the chain's
 *  unlimited sentinel. An authored 0 still admits the first unrecorded cast, then refuses every later attempt;
 *  absent is a client-only shape and stays unbounded. @param {number|null|undefined} authored @returns {number} */
export function cap_of(authored) {
  if (authored == null || authored === 255) return Infinity
  return authored === 0 ? 1 : authored
}

/** THE ONE PER-TARGET VERDICT (#1045) — cast.move's TargetKey/TargetRecord rule: `cell` is SPENT for `spell_key`
 *  this turn, so the chain would abort ECastsPerTarget on a repeat. The board's castable gate drops such cells and
 *  the click path names them (a mute disarm was the "the second cast folded nothing" dead-end: a spell whose
 *  casts_per_turn is unlimited stays legitimately armable — only its already-hit cells are spent).
 *  @param {Array<{ cell:number, spell_key:string|null }>|null|undefined} cast_path this turn's drafted queue
 *  @param {string|null} spell_key @param {number} cell @param {number|null|undefined} casts_per_target */
export function target_cap_reached(cast_path, spell_key, cell, casts_per_target) {
  return casts_at_cell(cast_path, spell_key, cell) >= cap_of(casts_per_target)
}

/** The visible turn deadline the timer should count to: while a draft exists it counts to the auto-commit
 *  moment (deadline − buffer) so "time left but locked" never shows; idle (no draft) counts to the raw deadline
 *  (the turn runs full length — liquidation ends it there). @param {number} deadline @param {boolean} has_draft
 *  @param {number} [buffer] @returns {number} */
export function effective_deadline(deadline, has_draft, buffer = COMMIT_BUFFER_MS, turn_ms = 0) {
  return has_draft && deadline > 0 ? auto_commit_fire_at(deadline, turn_ms, buffer) : deadline
}
