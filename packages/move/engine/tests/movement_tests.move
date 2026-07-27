// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Ordinary-movement trap parity cases; sim reads the matching cases from `ordinary_movement_golden.json`.
#[test_only]
module aresrpg_fight::movement_tests;

use aresrpg_fight::{
  displacement,
  fight::{Self, Fight},
  fight_scaffold::{create_fight, stand_up},
  mob,
  movement,
  participant,
};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;

fun fresh_fight(sc: &mut Scenario): Fight {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  sc.take_shared<Fight>()
}

fun finish(sc: Scenario, fight: Fight) {
  ts::return_shared(fight);
  sc.end();
}

fun damage_trap(fight: &mut Fight, anchor: u64) { damage_trap_for(fight, anchor, 7) }

/// A point trap dealing exactly `amount` — the tie-break case needs its two candidate cells to be TELLABLE
/// APART, and the damage each deals is what tells them apart.
fun damage_trap_for(fight: &mut Fight, anchor: u64, amount: u64) {
  spell_board::place_trap(
    fight::fx_mut(fight),
    anchor,
    0,
    spell_effect::shape_point(),
    0,
    vector[spell_effect::damage(spell::el_earth(), amount)],
  );
}

#[test]
fun participant_ordinary_move_triggers_own_crossed_trap_and_resumes() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 200);
  damage_trap(&mut fight, 166);
  displacement::record_trap_owner(&mut fight, 166, 0); // entrant seat 0 is also this trap's recorded placer

  let walls = displacement::move_blocked_cells(&fight, false, 0);
  // walk fires the own-trap inline (owner-blind, #320) and RESUMES to the destination 167 (#325).
  let (legal, moved) = movement::walk(&mut fight, false, 0, 167, &walls, 3);
  assert!(legal && moved == 3);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), moved);

  let p = fight::participants(&fight).borrow(0);
  assert!(participant::cell(p) == 167 && participant::mp(p) == 0 && participant::hp(p) == 93);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  finish(sc, fight);
}

#[test]
fun mob_ordinary_move_triggers_crossed_trap_and_resumes() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  damage_trap(&mut fight, 167);

  let walls = displacement::move_blocked_cells(&fight, true, 0);
  // walk fires the crossed trap inline and the mob RESUMES to 168 (#325).
  let (legal, moved) = movement::walk(&mut fight, true, 0, 168, &walls, 3);
  assert!(legal && moved == 3);

  let m = fight::mobs(&fight).borrow(0);
  assert!(mob::cell(m) == 168 && mob::hp(m) == 93);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  finish(sc, fight);
}

#[test]
fun ordinary_move_lethal_trap_stops_the_walk() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 200);
  // A trap heavy enough to kill the 100-hp participant: the walk RESUME must yield to death (movement ends by
  // the effect, not by the trigger). destination 167 is past the trap at 166 — the mover must never reach it.
  spell_board::place_trap(
    fight::fx_mut(&mut fight),
    166,
    0,
    spell_effect::shape_point(),
    0,
    vector[spell_effect::damage(spell::el_earth(), 200)],
  );

  let walls = displacement::move_blocked_cells(&fight, false, 0);
  let (legal, moved) = movement::walk(&mut fight, false, 0, 167, &walls, 3);
  assert!(legal && moved == 2); // entered 165 then 166, died there — never resumed to 167

  let p = fight::participants(&fight).borrow(0);
  assert!(participant::cell(p) == 166 && participant::hp(p) == 0);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  finish(sc, fight);
}

#[test]
fun illegal_destination_is_write_free() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  let walls = displacement::move_blocked_cells(&fight, false, 0);
  let (legal, moved) = movement::walk(&mut fight, false, 0, 168, &walls, 2);
  assert!(!legal && moved == 0);
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 164);
  finish(sc, fight);
}

#[test]
/// THE TIE-BREAK, pinned by behaviour. A destination one row up and one column right is reached by two routes of
/// equal cost — right-then-up, or up-then-right — and which one the walker takes is decided ENTIRELY by the
/// direction order `left, right, up, down`. That order is the whole determinism of movement: the sim twin walks
/// the same one, and a route that diverges desynchronises client prediction from chain resolution.
///
/// The flood-fill diet rewrote how the walker asks "does this neighbour still admit the remaining distance?"
/// (a read off one distance field instead of a fresh BFS per direction), so this case exists to prove the ANSWER
/// did not move. A trap on each candidate first step turns the choice into an observable: exactly the one on the
/// RIGHT cell detonates, the one on the UP cell is still sitting there afterwards.
fun ordinary_move_tie_break_takes_right_before_up() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 200);
  damage_trap_for(&mut fight, 165, 7); // the RIGHT-first route's opening step
  damage_trap_for(&mut fight, 144, 3); // the UP-first route's opening step — the road not taken
  displacement::record_trap_owner(&mut fight, 165, 0);
  displacement::record_trap_owner(&mut fight, 144, 0);

  let walls = displacement::move_blocked_cells(&fight, false, 0);
  let (legal, moved) = movement::walk(&mut fight, false, 0, 145, &walls, 2);
  assert!(legal && moved == 2, 0);

  let p = fight::participants(&fight).borrow(0);
  assert!(participant::cell(p) == 145, 1); // both routes end here — the destination proves nothing on its own
  // 7 damage, never 3: the two traps deal DIFFERENT amounts precisely so this number names which cell was
  // entered. Equal traps would have made both routes indistinguishable and this assertion decorative.
  assert!(participant::hp(p) == 93, 2);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 1, 3); // the UP-cell trap survives, untouched
  finish(sc, fight);
}
