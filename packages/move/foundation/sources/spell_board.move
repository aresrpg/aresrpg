// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL BOARD STATE — the persistent, consensus-critical on-board bookkeeping the headline "traps / glyphs /
/// poisons" feature needs (taxonomy §1i / §5c / §C). Two maps:
///
///  1. CELL ENTRIES (`cell → trap|glyph`): a trap (invisible, no timer, force-stop + detonate on ENTER, no
///     stack) or a glyph (visible, timed, ticks at start/end of a standing fighter's turn).
///  2. FIGHTER STATUSES (`fighter → buff|DoT|state`): per-fighter rows — a poison/DoT carries the per-tick
///     effect and ticks at the START of the victim's turn.
///
/// DESIGN — WHERE IT LIVES (touchpoint flagged for the dungeon worker): `BoardState` is `store` + `drop`, so
/// the dungeon owner embeds ONE `board: BoardState` field on `Dungeon` (init `spell_board::empty()`), and the
/// per-fighter statuses key off a `u64 fighter_id` the turn machine maps from a player SEAT or a mob index.
/// This module is the pure primitive layer; the (held) `apply_cast`/turn-tick rewrite orchestrates the §5d
/// ordering (start: decrement durations → DoT + start-glyph → act: trap on-enter → end: end-glyph).
module aresrpg_foundation::spell_board;

use aresrpg_foundation::{combat_grid, spell_effect::{Self, Effect}};

// ╔════════════════ [ Types ] ═══════════════════════════════════════════════════ ]

/// A trap or glyph anchored on the board. `owner_team` gates trap VISIBILITY (the placing team only) — trap
/// TRIGGERING has no team check (detonates for anyone, incl. allies, §5f#3). `remaining_turns` = 0 means "no
/// timer" (traps: persist until triggered). `payload` = the detonation/tick effects.
public struct CellEntry has copy, drop, store {
  cell: u64,
  owner_team: u8,
  kind: u8, //  spell_effect::k_place_trap() | k_place_glyph()
  phase: u8, //  spell_effect::phase_on_enter() (trap) | phase_start() | phase_end() (glyph)
  zone_shape: u8,
  zone_size: u64,
  remaining_turns: u8,
  payload: vector<Effect>,
}

/// A per-fighter status row: a buff/debuff, a DoT (carries the per-tick `Effect`), or a named state.
public struct FighterStatus has copy, drop, store {
  fighter: u64,
  kind: u8,
  effect: Effect,
  remaining_turns: u8,
  source: u64, //  source fighter id (reflect/steal attribution)
}

/// The board's persistent combat state. `store` so it embeds in `Dungeon`; `drop` so a terminal dungeon
/// tears down cleanly (all fields are copy/drop/store).
public struct BoardState has drop, store {
  cell_entries: vector<CellEntry>,
  statuses: vector<FighterStatus>,
}

public fun empty(): BoardState { BoardState { cell_entries: vector[], statuses: vector[] } }

public fun entry_count(board: &BoardState): u64 { board.cell_entries.length() }
public fun status_count(board: &BoardState): u64 { board.statuses.length() }

// ╔════════════════ [ Zone containment ] ═════════════════════════════════════════ ]

/// Is `cell` inside a `(shape,size)` zone anchored at `anchor`? Delegates to `combat_grid::in_zone` — EXACT for
/// point/circle/cross/ring/allmap (#55 ruling 3, the lozenge POC is gone). LINE/TBAR need a cast direction a
/// placed board zone does not store, so `in_zone` lozenge-falls-back for those (flagged; the census's placed
/// zones are point/circle — instantaneous line/tbar go through `combat_grid::zone_cells` at cast time).
fun zone_contains(shape: u8, size: u64, anchor: u64, cell: u64): bool {
  combat_grid::in_zone(shape, size, anchor, cell)
}

// ╔════════════════ [ Placement ] ════════════════════════════════════════════════ ]

/// Place an INVISIBLE trap: no timer, on-enter detonation, force-stop (movement engine's job at integration).
/// The 1.29 "no trap on a trap" rule is enforced by the CAST layer (`aresrpg_fight::cast::place_effects`
/// asserts `!has_trap_at` before calling here) — this primitive stays an unchecked pure store.
public fun place_trap(board: &mut BoardState, cell: u64, owner_team: u8, zone_shape: u8, zone_size: u64, payload: vector<Effect>) {
  board.cell_entries.push_back(CellEntry {
    cell, owner_team, kind: spell_effect::k_place_trap(), phase: spell_effect::phase_on_enter(),
    zone_shape, zone_size, remaining_turns: 0, payload,
  });
}

/// Place a VISIBLE, timed glyph. `end_of_turn` selects the repulsion/end-phase class (402) vs the default
/// start-of-turn class (401). Glyphs may stack (each is its own entry).
public fun place_glyph(
  board: &mut BoardState, cell: u64, owner_team: u8, zone_shape: u8, zone_size: u64, turns: u8, end_of_turn: bool, payload: vector<Effect>,
) {
  let phase = if (end_of_turn) spell_effect::phase_end() else spell_effect::phase_start();
  board.cell_entries.push_back(CellEntry {
    cell, owner_team, kind: spell_effect::k_place_glyph(), phase, zone_shape, zone_size, remaining_turns: turns, payload,
  });
}

/// Apply a generic poison/DoT to a fighter — stores the per-tick `Effect` (its `turns` = duration), ticking at the
/// START of the victim's turn. Value is snapshot at cast (the fixed base is frozen — ideal for the
/// predict-then-reconcile model, §C).
public fun apply_dot(board: &mut BoardState, fighter: u64, source: u64, dot_effect: Effect) {
  board.statuses.push_back(FighterStatus {
    fighter, kind: spell_effect::k_apply_dot(), remaining_turns: dot_effect.turns(), effect: dot_effect, source,
  });
}

/// Attach a generic fighter status (buff/debuff/state) — a per-fighter row read by other rules.
public fun add_status(board: &mut BoardState, fighter: u64, source: u64, effect: Effect) {
  board.statuses.push_back(FighterStatus {
    fighter, kind: effect.kind(), remaining_turns: effect.turns(), effect, source,
  });
}

// ╔════════════════ [ Triggers ] ═════════════════════════════════════════════════ ]

/// Index of the FIRST trap whose zone covers `mover_cell`.
fun trap_index_covering(board: &BoardState, mover_cell: u64): Option<u64> {
  let n = board.cell_entries.length();
  let mut i = 0;
  while (i < n) {
    let e = board.cell_entries.borrow(i);
    if (e.kind == spell_effect::k_place_trap() && zone_contains(e.zone_shape, e.zone_size, e.cell, mover_cell)) {
      return option::some(i)
    };
    i = i + 1;
  };
  option::none()
}

/// Does ENTERING `mover_cell` cross a live trap zone? Read-only force-stop probe for cell-by-cell movement.
/// Empty-payload traps still return true and therefore still stop the mover.
public fun has_trap_covering(board: &BoardState, mover_cell: u64): bool {
  trap_index_covering(board, mover_cell).is_some()
}

/// A fighter ENTERS `mover_cell`: detonate the FIRST trap whose zone covers it, SELF-REMOVING before applying
/// (prevents repulsive-trap infinite loops, §5f#3) and return its stored ANCHOR with its payload. NO team check —
/// a trap detonates for anyone, allies included. `none` means no trap; `some(anchor)` plus an empty payload means
/// an empty trap did fire. Force-stop-on-that-cell remains the movement engine's concern.
public fun on_enter_with_anchor(board: &mut BoardState, mover_cell: u64): (Option<u64>, vector<Effect>) {
  let hit = trap_index_covering(board, mover_cell);
  if (hit.is_none()) return (option::none(), vector[]);
  let CellEntry { cell, payload, .. } = board.cell_entries.swap_remove(hit.destroy_some());
  (option::some(cell), payload)
}

/// Compatibility wrapper: preserve the published payload-only signature for existing callers.
public fun on_enter(board: &mut BoardState, mover_cell: u64): vector<Effect> {
  let (_anchor, payload) = on_enter_with_anchor(board, mover_cell);
  payload
}

/// Is a LIVE trap ANCHORED on `cell`? The 1.29 no-stack read: `aresrpg_fight::cast` aborts a trap placement on
/// an already-trapped cell (one trap per cell; a detonated trap frees it). Checks the ANCHOR, never the zone —
/// overlapping blast ZONES are legal (the 1.29 trap-chain), only anchor-on-anchor stacking is banned.
public fun has_trap_at(board: &BoardState, cell: u64): bool {
  let n = board.cell_entries.length();
  let mut i = 0;
  while (i < n) {
    let e = board.cell_entries.borrow(i);
    if (e.kind == spell_effect::k_place_trap() && e.cell == cell) return true;
    i = i + 1;
  };
  false
}

/// START-of-turn tick for fighter `fighter_id` standing on `fighter_cell`: the payloads of every start-phase
/// glyph it stands in, plus its start-phase DoT effects (taxonomy §5d). Read-only — duration decrement is a
/// separate end-of-turn step so the tick order stays explicit.
public fun tick_start(board: &BoardState, fighter_id: u64, fighter_cell: u64): vector<Effect> {
  let mut out = collect_glyph_payloads(board, fighter_cell, spell_effect::phase_start());
  let ns = board.statuses.length();
  let mut k = 0;
  while (k < ns) {
    let s = board.statuses.borrow(k);
    if (s.fighter == fighter_id && s.kind == spell_effect::k_apply_dot() && s.effect.phase() == spell_effect::phase_start()) {
      out.push_back(s.effect);
    };
    k = k + 1;
  };
  out
}

/// END-of-turn tick: the payloads of every end-phase glyph the fighter stands in (the repulsion class, 402).
public fun tick_end(board: &BoardState, fighter_cell: u64): vector<Effect> {
  collect_glyph_payloads(board, fighter_cell, spell_effect::phase_end())
}

fun collect_glyph_payloads(board: &BoardState, fighter_cell: u64, phase: u8): vector<Effect> {
  let mut out = vector[];
  let n = board.cell_entries.length();
  let mut i = 0;
  while (i < n) {
    let e = board.cell_entries.borrow(i);
    if (e.kind == spell_effect::k_place_glyph() && e.phase == phase && zone_contains(e.zone_shape, e.zone_size, e.cell, fighter_cell)) {
      let m = e.payload.length();
      let mut j = 0;
      while (j < m) { out.push_back(*e.payload.borrow(j)); j = j + 1; };
    };
    i = i + 1;
  };
  out
}

// ╔════════════════ [ State query (#69 state-gated casts) ] ═══════════════════════ ]

/// #69: does `fighter_id` currently HOLD the named state `state_id`? A named state lives as a `k_apply_state`
/// status row whose `effect.value()` is the state id (recorded for its `turns` duration). Backs the
/// `dungeon_cast` required/forbidden-states cast gate — reading the SpellLevel getters that were never read.
public fun fighter_has_state(board: &BoardState, fighter_id: u64, state_id: u16): bool {
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id && s.kind == spell_effect::k_apply_state() && s.effect.value() == (state_id as u64)) return true;
    i = i + 1;
  };
  false
}

/// #55 control kinds: the FIRST active status row of `kind` on `fighter_id`, if any (its `effect` carries the
/// row's chance/element/value/turns). `dungeon_cast` reads this for RETURN-SPELL (is the aimed enemy holding a
/// return buff, and at what chance) — the single place the redirect decision is made.
public fun fighter_status_of(board: &BoardState, fighter_id: u64, kind: u8): Option<Effect> {
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id && s.kind == kind) return option::some(s.effect);
    i = i + 1;
  };
  option::none()
}

/// Copy every active row of `kind` on `fighter_id`. Wave 12 reactions may legitimately stack rows from
/// different sources; callers need both each encoded effect and its source attribution.
public fun fighter_status_rows_of(board: &BoardState, fighter_id: u64, kind: u8): vector<FighterStatus> {
  let mut out = vector[];
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id && s.kind == kind) out.push_back(*s);
    i = i + 1;
  };
  out
}

public fun status_effect(status: &FighterStatus): &Effect { &status.effect }
public fun status_source(status: &FighterStatus): u64 { status.source }

/// Fold one post-formula incoming damage line through the fighter's mitigation rows. Kind 24 is a PER-HIT
/// property and is never mutated; every matching row contributes its flat value first. Kind 40 is a reservoir:
/// matching rows absorb what remains in board order, spend their stored value, and disappear at zero. NONE is
/// the existing neutral/wildcard status element; named elements match exactly.
public fun mitigate_damage(board: &mut BoardState, fighter_id: u64, element: u8, incoming: u64): u64 {
  if (incoming == 0) return 0;
  let none = aresrpg_foundation::spell::el_none();
  let mut remaining = incoming;
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n && remaining > 0) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id
      && s.kind == spell_effect::k_reduce_damage()
      && (s.effect.element() == none || s.effect.element() == element)) {
      remaining = if (s.effect.value() >= remaining) 0 else remaining - s.effect.value();
    };
    i = i + 1;
  };

  i = 0;
  while (i < n && remaining > 0) {
    let s = board.statuses.borrow_mut(i);
    if (s.fighter == fighter_id
      && s.kind == spell_effect::k_pool_shield()
      && (s.effect.element() == none || s.effect.element() == element)) {
      let pool = s.effect.value();
      let absorbed = if (pool < remaining) pool else remaining;
      remaining = remaining - absorbed;
      spell_effect::set_pool_remaining(&mut s.effect, pool - absorbed);
    };
    i = i + 1;
  };

  // A zero reservoir expires immediately, without disturbing the order of unrelated/live rows.
  let mut kept = vector[];
  while (!board.statuses.is_empty()) {
    let s = board.statuses.pop_back();
    if (!(s.fighter == fighter_id
      && s.kind == spell_effect::k_pool_shield()
      && s.effect.value() == 0)) kept.push_back(s);
  };
  kept.reverse();
  board.statuses = kept;
  remaining
}

/// Remove EVERY status row of `kind` on `fighter_id` (REVEAL clears the target's invisibility rows; the field on
/// the Participant is cleared by the dungeon side). No-op if none present.
public fun clear_fighter_status_kind(board: &mut BoardState, fighter_id: u64, kind: u8) {
  let mut kept = vector[];
  while (!board.statuses.is_empty()) {
    let s = board.statuses.pop_back();
    if (!(s.fighter == fighter_id && s.kind == kind)) kept.push_back(s);
  };
  kept.reverse();
  board.statuses = kept;
}

/// REMOVE-STATE: drop exactly the `k_apply_state` rows on `fighter_id` naming `state_id`. The precise
/// counterpart of `fighter_has_state` — a cleanse of ONE named state, never a dispel: unrelated rows (other
/// states, stuns, alters, DoT) survive untouched. `clear_fighter_status_kind`'s idiom, narrowed by value, so the
/// surviving rows land in the same order the kind-wide clear produces. No-op when the state is not held.
public fun clear_fighter_state(board: &mut BoardState, fighter_id: u64, state_id: u16) {
  let mut kept = vector[];
  while (!board.statuses.is_empty()) {
    let s = board.statuses.pop_back();
    if (!(s.fighter == fighter_id
      && s.kind == spell_effect::k_apply_state()
      && s.effect.value() == (state_id as u64))) kept.push_back(s);
  };
  kept.reverse();
  board.statuses = kept;
}

/// DISPEL: strip exactly `fighter_id`'s `FLAG_DISPELLABLE` status rows NOW. Unflagged rows survive unchanged.
/// Return removed rows whose applied delta the fight must REVERT (the same `status_needs_revert` set
/// `decrement_fighter_statuses` returns at natural expiry — single home, no parallel bookkeeping). A flagged
/// non-revert row is removed without entering the return vector.
public fun dispel_fighter(board: &mut BoardState, fighter_id: u64): vector<Effect> {
  let mut kept = vector[];
  let mut reverted = vector[];
  while (!board.statuses.is_empty()) {
    let s = board.statuses.pop_back();
    if (s.fighter == fighter_id && s.effect.has_flag(spell_effect::flag_dispellable())) {
      if (status_needs_revert(s.kind)) reverted.push_back(s.effect);
    } else {
      kept.push_back(s);
    };
  };
  kept.reverse();
  reverted.reverse();
  board.statuses = kept;
  reverted
}

/// The status kinds whose applied delta must be UNDONE when the row leaves the board (at natural expiry OR via
/// dispel): the two timed stat/resist buffs (#69) PLUS field-backed armor/invisibility and presentation stance.
/// Reflect damage is consumed directly from its live row by the damage path and has no field delta to revert.
/// DoT / named-state / return-spell likewise carry no revertible delta.
fun status_needs_revert(kind: u8): bool {
  kind == spell_effect::k_alter_stat() || kind == spell_effect::k_alter_resist()
    || kind == spell_effect::k_reduce_damage()
    || kind == spell_effect::k_pool_shield()
    || kind == spell_effect::k_invisibility() || kind == spell_effect::k_stance()
}

/// The ACTIVE point-drain DEBT on `fighter_id` for pool `point_kind` (0 AP / 1 MP): the sum of every live
/// `k_remove_points` row's post-dodge `value`. The turn machine subtracts this from the pool's base at the
/// fighter's next `begin_turn` refill (the retrait contract — a removal reduces the refilled pool for the row's
/// duration, then the row expires and the pool recovers). Rows are recorded by the cast resolver's drain path
/// (`spell_effect::drain_row`); DoT/alter/state rows are ignored (kind-gated).
public fun fighter_point_debt(board: &BoardState, fighter_id: u64, point_kind: u8): u64 {
  sum_point_rows(board, fighter_id, spell_effect::k_remove_points(), point_kind)
}

/// The ACTIVE give CREDIT on `fighter_id` for pool `point_kind` — the debt fold's opposite-sign twin
/// (MOB_DEBUFF_HAT P1 #2): the sum of every live `k_give_points` row's `value`, ADDED at the fighter's next
/// `begin_turn` refill (refill = base − debt + credit) so an ally's feed survives to the turn it was meant to boost.
public fun fighter_point_credit(board: &BoardState, fighter_id: u64, point_kind: u8): u64 {
  sum_point_rows(board, fighter_id, spell_effect::k_give_points(), point_kind)
}

fun sum_point_rows(board: &BoardState, fighter_id: u64, kind: u8, point_kind: u8): u64 {
  let mut sum = 0;
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id && s.kind == kind && s.effect.stat() == point_kind) {
      sum = sum + s.effect.value();
    };
    i = i + 1;
  };
  sum
}

/// PURGE every status row on `fighter_id` — the DEATH fold (MOB_DEBUFF_HAT P3 spell_board:286): a dead fighter's
/// rows can never expire (`decrement_fighter_statuses` runs only on its own turn-start, and a corpse has no turns),
/// so without this the debt/credit/alter scans iterate junk for the fight's remainder. No reverts returned — a
/// corpse's pools/stats are never read again (no revive-by-heal). Rows the dead fighter SOURCED on others persist
/// (1.29: a poison outlives its caster).
public fun clear_fighter(board: &mut BoardState, fighter_id: u64) {
  let mut kept = vector[];
  while (!board.statuses.is_empty()) {
    let s = board.statuses.pop_back();
    if (s.fighter != fighter_id) kept.push_back(s);
  };
  board.statuses = kept;
}

/// Every LIVE timed alter row (stat/resist) on `fighter_id` — the fold set the fight side RE-DERIVES live stats
/// from (base + rows). Re-deriving is the sound revert: re-applying flipped deltas under the stats' 0-floor
/// leaked permanent gains whenever a debuff exceeded the current value.
public fun fighter_alter_rows(board: &BoardState, fighter_id: u64): vector<Effect> {
  let mut out = vector[];
  let n = board.statuses.length();
  let mut i = 0;
  while (i < n) {
    let s = board.statuses.borrow(i);
    if (s.fighter == fighter_id && (s.kind == spell_effect::k_alter_stat() || s.kind == spell_effect::k_alter_resist())) {
      out.push_back(s.effect);
    };
    i = i + 1;
  };
  out
}

// ╔════ [ Duration decrement (statuses: the bearer's turn START — #2000; glyphs: player turn END) ] ═ ]

/// Tick down every glyph's duration, expiring those that reach 0 (traps have no timer — untouched). A glyph
/// placed with N turns ticks on N turns, then expires.
public fun decrement_glyphs(board: &mut BoardState) {
  let mut kept = vector[];
  while (!board.cell_entries.is_empty()) {
    let mut e = board.cell_entries.pop_back();
    if (e.kind == spell_effect::k_place_glyph()) {
      if (e.remaining_turns > 1) { e.remaining_turns = e.remaining_turns - 1; kept.push_back(e); };
    } else {
      kept.push_back(e); // trap: no timer
    };
  };
  board.cell_entries = kept;
}

/// Tick down a fighter's status durations (DoT/buffs/debuffs), expiring those already spent. #69: an EXPIRING
/// timed `k_alter_stat` / `k_alter_resist` row carried the buff's applied delta (in its `effect` — stat/element,
/// magnitude, and FLAG_NEGATIVE sign), so return those effects to the caller. `spell_board` can't reach
/// `Participant`; the dungeon-level tick applies the INVERSE (revert). Every other expiring kind just drops.
///
/// #2000 — THE COUNTER'S MEANING. `remaining_turns` counts the bearer's turns STILL TO COME, so a row is kept
/// while it has any (`> 0`, its counter landing on 0 marking "this is its last turn") and drops only on the
/// aging that finds it already at 0. Paired with the turn-START cadence (`cast::tick_turn_expiry`), an authored
/// duration N therefore covers the cast turn plus N further bearer turns and expires at the start of turn N+1 —
/// the semantics the authored number carries natively. The end-turn `> 1` cadence spent one aging on the cast
/// turn itself, which is why an authored 1 died before its owner ever played under it.
public fun decrement_fighter_statuses(board: &mut BoardState, fighter_id: u64): vector<Effect> {
  let mut kept = vector[];
  let mut expired = vector[];
  while (!board.statuses.is_empty()) {
    let mut s = board.statuses.pop_back();
    if (s.fighter == fighter_id) {
      if (s.remaining_turns > 0) { s.remaining_turns = s.remaining_turns - 1; kept.push_back(s); }
      else if (status_needs_revert(s.kind)) {
        expired.push_back(s.effect); // timed-effect revert — fight side handles stat/resist/armor/invisibility/stance
      };
    } else {
      kept.push_back(s);
    };
  };
  board.statuses = kept;
  expired
}

// ===========================================================================
// Tests — trap detonation (incl. ally), glyph tick timing, DoT lifecycle, decay.
// ===========================================================================

#[test_only]
use aresrpg_foundation::spell_effect::{damage, shape_circle};

#[test]
fun t_trap_detonates_on_enter_and_self_removes() {
  let mut b = empty();
  place_trap(&mut b, combat_grid::encode(5, 5), 0, shape_circle(), 1, vector[damage(aresrpg_foundation::spell::el_earth(), 30)]);
  assert!(b.entry_count() == 1, 0);
  // enter the anchor cell -> detonate + self-remove
  let payload = on_enter(&mut b, combat_grid::encode(5, 5));
  assert!(payload.length() == 1, 0);
  assert!(payload.borrow(0).value() == 30, 0);
  assert!(b.entry_count() == 0, 0); // self-removed
  // a second entry finds nothing
  assert!(on_enter(&mut b, combat_grid::encode(5, 5)).is_empty(), 0);
}

#[test]
fun t_trap_triggers_within_zone_and_for_anyone() {
  let mut b = empty();
  place_trap(&mut b, combat_grid::encode(5, 5), 0, shape_circle(), 1, vector[damage(aresrpg_foundation::spell::el_earth(), 30)]);
  // a cell inside the blast lozenge (manhattan 1) triggers — no team check (ally-or-enemy alike)
  assert!(!on_enter(&mut b, combat_grid::encode(5, 6)).is_empty(), 0);
  // re-place and step OUTSIDE the zone (manhattan 2) -> no trigger, trap stays
  place_trap(&mut b, combat_grid::encode(5, 5), 0, shape_circle(), 1, vector[damage(aresrpg_foundation::spell::el_earth(), 30)]);
  assert!(on_enter(&mut b, combat_grid::encode(5, 7)).is_empty(), 0);
  assert!(b.entry_count() == 1, 0);
}

#[test]
fun t_has_trap_at_reads_anchor_only_and_frees_on_detonation() {
  let mut b = empty();
  place_trap(&mut b, combat_grid::encode(5, 5), 0, shape_circle(), 1, vector[damage(aresrpg_foundation::spell::el_earth(), 30)]);
  assert!(has_trap_at(&b, combat_grid::encode(5, 5)), 0); // the anchor holds a live trap
  assert!(!has_trap_at(&b, combat_grid::encode(5, 6)), 0); // zone COVERAGE is not anchorage (overlap stays legal)
  // a glyph is never a trap read
  place_glyph(&mut b, combat_grid::encode(6, 6), 0, shape_circle(), 1, 3, false, vector[]);
  assert!(!has_trap_at(&b, combat_grid::encode(6, 6)), 0);
  // detonation self-removes → the anchor is free again
  on_enter(&mut b, combat_grid::encode(5, 5));
  assert!(!has_trap_at(&b, combat_grid::encode(5, 5)), 0);
}

#[test]
fun t_glyph_ticks_start_not_on_enter() {
  let mut b = empty();
  place_glyph(&mut b, combat_grid::encode(4, 4), 0, shape_circle(), 1, 3, false, vector[damage(aresrpg_foundation::spell::el_fire(), 12)]);
  // on_enter never fires a glyph
  assert!(on_enter(&mut b, combat_grid::encode(4, 4)).is_empty(), 0);
  // start-of-turn while standing in it ticks
  let t = tick_start(&b, 1, combat_grid::encode(4, 4));
  assert!(t.length() == 1 && t.borrow(0).value() == 12, 0);
  // an end-phase tick sees nothing (this is a start glyph)
  assert!(tick_end(&b, combat_grid::encode(4, 4)).is_empty(), 0);
  // standing OUTSIDE the zone -> no tick
  assert!(tick_start(&b, 1, combat_grid::encode(8, 8)).is_empty(), 0);
}

#[test]
fun t_glyph_end_phase() {
  let mut b = empty();
  place_glyph(&mut b, combat_grid::encode(4, 4), 0, shape_circle(), 0, 2, true, vector[damage(aresrpg_foundation::spell::el_air(), 9)]);
  assert!(tick_end(&b, combat_grid::encode(4, 4)).length() == 1, 0);
  assert!(tick_start(&b, 1, combat_grid::encode(4, 4)).is_empty(), 0);
}

#[test]
fun t_glyph_expires_after_duration() {
  let mut b = empty();
  place_glyph(&mut b, combat_grid::encode(4, 4), 0, shape_circle(), 0, 2, false, vector[damage(aresrpg_foundation::spell::el_fire(), 12)]);
  decrement_glyphs(&mut b); // 2 -> 1
  assert!(b.entry_count() == 1, 0);
  decrement_glyphs(&mut b); // 1 -> expire
  assert!(b.entry_count() == 0, 0);
}

#[test]
fun t_dot_lifecycle() {
  let mut b = empty();
  apply_dot(&mut b, 1, 2, aresrpg_foundation::spell_effect::apply_dot(aresrpg_foundation::spell::el_earth(), 8, 3));
  assert!(b.status_count() == 1, 0);
  // ticks at start of fighter 1's turn
  let t = tick_start(&b, 1, combat_grid::encode(0, 0));
  assert!(t.length() == 1 && t.borrow(0).value() == 8, 0);
  // not another fighter's DoT
  assert!(tick_start(&b, 2, combat_grid::encode(0, 0)).is_empty(), 0);
  // #2000: the counter is "bearer turns still to come", so a 3 survives THREE agings (3->2->1->0, each of
  // those turns ticking) and drops on the fourth — the start of the turn after its last.
  decrement_fighter_statuses(&mut b, 1); // 3->2
  decrement_fighter_statuses(&mut b, 1); // 2->1
  decrement_fighter_statuses(&mut b, 1); // 1->0, still live for THIS turn
  assert!(b.status_count() == 1, 0);
  assert!(tick_start(&b, 1, combat_grid::encode(0, 0)).length() == 1, 0); // its last tick
  decrement_fighter_statuses(&mut b, 1); // already spent -> expire
  assert!(b.status_count() == 0, 0);
}
