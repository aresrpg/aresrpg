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

fun damage_trap(fight: &mut Fight, anchor: u64) {
  spell_board::place_trap(
    fight::fx_mut(fight),
    anchor,
    0,
    spell_effect::shape_point(),
    0,
    vector[spell_effect::damage(spell::el_earth(), 7)],
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
  let (legal, moved, _) = movement::walk(&mut fight, false, 0, 167, &walls, 3);
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
  let (legal, moved, _) = movement::walk(&mut fight, true, 0, 168, &walls, 3);
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
  let (legal, moved, _) = movement::walk(&mut fight, false, 0, 167, &walls, 3);
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
  let (legal, moved, _) = movement::walk(&mut fight, false, 0, 168, &walls, 2);
  assert!(!legal && moved == 0);
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 164);
  finish(sc, fight);
}
