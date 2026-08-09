// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twin of the shared displacement vector shards.
#[test_only]
module aresrpg_fight::displacement_tests;

use aresrpg_fight::{
  cast,
  displacement,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{create_fight, plain_stats, stand_up},
  mob,
  participant,
};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::{event, test_scenario::{Self as ts, Scenario}};

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

fun apply_to_mob(fight: &mut Fight, origin: u64, level: u64, kind: u8, requested: u64) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), origin);
  let target_cell = mob::cell(fight::mobs(fight).borrow(0));
  let effect = if (kind == spell_effect::k_push()) spell_effect::push(requested) else spell_effect::pull(requested);
  let stats = plain_stats();
  let mut rng = 7;
  cast::apply_effect_for_testing(fight, 0, 0, origin, &stats, level, target_cell, &effect, &mut rng);
}

fun apply_to_participant(fight: &mut Fight, origin: u64, level: u64, kind: u8, requested: u64) {
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), origin);
  let target_cell = participant::cell(fight::participants(fight).borrow(0));
  let effect = if (kind == spell_effect::k_push()) spell_effect::push(requested) else spell_effect::pull(requested);
  let stats = plain_stats();
  let mut rng = 7;
  cast::apply_effect_for_testing(fight, 1, 0, origin, &stats, level, target_cell, &effect, &mut rng);
}

fun add_mob(fight: &mut Fight, cell: u64, hp: u64) {
  fight::mobs_mut(fight).push_back(mob::new_mob_for_testing(cell, hp, 100, 0, 0));
}

fun place_trap(fight: &mut Fight, anchor: u64, shape: u8, size: u64, payload: vector<spell_effect::Effect>) {
  spell_board::place_trap(fight::fx_mut(fight), anchor, 0, shape, size, payload);
}

fun place_recorded_trap(fight: &mut Fight, anchor: u64, shape: u8, size: u64, owner_level: u64, payload: vector<spell_effect::Effect>) {
  participant::set_level_for_testing(fight::participants_mut(fight).borrow_mut(0), owner_level);
  place_trap(fight, anchor, shape, size, payload);
  displacement::record_trap_owner(fight, anchor, 0);
}

fun assert_displaced(
  fight_id: ID,
  target_is_mob: bool,
  target_idx: u64,
  kind: u8,
  from_cell: u64,
  to_cell: u64,
  requested: u64,
  blocked: u64,
) {
  let events = event::events_by_type<fight_events::Displaced>();
  assert!(events.length() == 1);
  let (got_fight, got_side, got_idx, got_kind, got_from, got_to, got_requested, got_blocked) =
    fight_events::displaced_for_testing(events.borrow(0));
  assert!(got_fight == fight_id && got_side == target_is_mob && got_idx == target_idx);
  assert!(got_kind == kind && got_from == from_cell && got_to == to_cell);
  assert!(got_requested == requested && got_blocked == blocked);
}

fun assert_no_hit() {
  assert!(event::events_by_type<fight_events::Hit>().is_empty());
}

fun assert_hit(fight_id: ID, victim_is_mob: bool, victim_idx: u64, amount: u64, remaining_hp: u64) {
  let events = event::events_by_type<fight_events::Hit>();
  assert!(events.length() == 1);
  let (got_fight, got_side, got_idx, got_amount, got_hp) = fight_events::hit_for_testing(events.borrow(0));
  assert!(got_fight == fight_id && got_side == victim_is_mob && got_idx == victim_idx);
  assert!(got_amount == amount && got_hp == remaining_hp);
}

#[test]
fun player_spell_mob_push_2_noop_regression() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 164, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert_displaced(id, true, 0, 12, 165, 167, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun mob_spell_participant_push_2() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 165);
  let id = fight::id(&fight);
  apply_to_participant(&mut fight, 164, 50, spell_effect::k_push(), 2);
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 167 && participant::hp(fight::participants(&fight).borrow(0)) == 100);
  assert_displaced(id, false, 0, 12, 165, 167, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun push_obstacle_immediate() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 103);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 102, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 103 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced(id, true, 0, 12, 103, 103, 2, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_obstacle_partial() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 102);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 101, 50, spell_effect::k_push(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 103 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced(id, true, 0, 12, 102, 103, 3, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_living_body_damages_target_only() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  add_mob(&mut fight, 167, 100);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 164, 50, spell_effect::k_push(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 166 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert!(mob::cell(fight::mobs(&fight).borrow(1)) == 167 && mob::hp(fight::mobs(&fight).borrow(1)) == 100);
  assert_displaced(id, true, 0, 12, 165, 166, 3, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun pull_free_2() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 168);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 164, 50, spell_effect::k_pull(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 166 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert_displaced(id, true, 0, 13, 168, 166, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun pull_body_damages_participant_target_only() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 168);
  add_mob(&mut fight, 166, 100);
  let id = fight::id(&fight);
  apply_to_participant(&mut fight, 164, 50, spell_effect::k_pull(), 3);
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 167 && participant::hp(fight::participants(&fight).borrow(0)) == 76);
  assert!(mob::hp(fight::mobs(&fight).borrow(1)) == 100);
  assert_displaced(id, false, 0, 13, 168, 167, 3, 2);
  assert_hit(id, false, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_rectangle_edge_immediate() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 1);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 21, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 1 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced(id, true, 0, 12, 1, 1, 2, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_hole_partial() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 106);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 105, 50, spell_effect::k_push(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 107 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced(id, true, 0, 12, 106, 107, 3, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_off_shape_partial() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 172);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 171, 50, spell_effect::k_push(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 173 && mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced(id, true, 0, 12, 172, 173, 3, 2);
  assert_hit(id, true, 0, 24, 76);
  finish(sc, fight);
}

#[test]
fun push_crossed_trap_triggers_and_stops_without_collision() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  place_trap(&mut fight, 167, spell_effect::shape_point(), 0, vector[spell_effect::damage(spell::el_earth(), 7)]);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 164, 50, spell_effect::k_push(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167 && mob::hp(fight::mobs(&fight).borrow(0)) == 93);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 12, 165, 167, 3, 0);
  assert_hit(id, true, 0, 7, 93);
  finish(sc, fight);
}

#[test]
fun push_diagonal_tie_resolves_x() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 105);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 63, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 107);
  assert_displaced(id, true, 0, 12, 105, 107, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun push_diagonal_y_dominant() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 124, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 205);
  assert_displaced(id, true, 0, 12, 165, 205, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun dead_body_does_not_block() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  add_mob(&mut fight, 166, 0);
  let id = fight::id(&fight);
  apply_to_mob(&mut fight, 164, 50, spell_effect::k_push(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(mob::cell(fight::mobs(&fight).borrow(1)) == 166 && mob::hp(fight::mobs(&fight).borrow(1)) == 0);
  assert_displaced(id, true, 0, 12, 165, 167, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun springjaw_anchor_origin_mob_free() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  place_recorded_trap(&mut fight, 164, spell_effect::shape_circle(), 1, 36, vector[spell_effect::push(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 12, 165, 167, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun board_pull_anchor_origin_mob_free() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 168);
  place_recorded_trap(&mut fight, 164, spell_effect::shape_circle(), 4, 36, vector[spell_effect::pull(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 166 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 13, 168, 166, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun springjaw_recorded_owner_collision() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  add_mob(&mut fight, 166, 100);
  place_recorded_trap(&mut fight, 164, spell_effect::shape_circle(), 1, 36, vector[spell_effect::push(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 165 && mob::hp(fight::mobs(&fight).borrow(0)) == 84);
  assert!(mob::hp(fight::mobs(&fight).borrow(1)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 12, 165, 165, 2, 2);
  assert_hit(id, true, 0, 16, 84);
  finish(sc, fight);
}

#[test]
fun springjaw_preupgrade_level_fallback() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  add_mob(&mut fight, 166, 100);
  place_trap(&mut fight, 164, spell_effect::shape_circle(), 1, vector[spell_effect::push(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 165 && mob::hp(fight::mobs(&fight).borrow(0)) == 98);
  assert!(mob::hp(fight::mobs(&fight).borrow(1)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 12, 165, 165, 2, 2);
  assert_hit(id, true, 0, 2, 98);
  finish(sc, fight);
}

#[test]
fun springjaw_zero_direction() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  place_recorded_trap(&mut fight, 165, spell_effect::shape_point(), 0, 36, vector[spell_effect::push(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 165 && mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, true, 0, 12, 165, 165, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}

#[test]
fun springjaw_anchor_origin_participant_free() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 167);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 200);
  place_recorded_trap(&mut fight, 168, spell_effect::shape_circle(), 1, 36, vector[spell_effect::push(2)]);
  let id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, false, 0);
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 165 && participant::hp(fight::participants(&fight).borrow(0)) == 100);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced(id, false, 0, 12, 167, 165, 2, 0);
  assert_no_hit();
  finish(sc, fight);
}
