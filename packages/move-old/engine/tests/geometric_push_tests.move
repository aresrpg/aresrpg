// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twin of the shared geometric-push vector shards.
#[test_only]
module aresrpg_fight::geometric_push_tests;

use aresrpg_fight::{
  cast,
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

fun apply(fight: &mut Fight, caster_cell: u64, target_cell: u64, shape: u8, size: u64) {
  apply_with_filter(fight, caster_cell, target_cell, shape, size, spell_effect::tf_none());
}

fun apply_with_filter(fight: &mut Fight, caster_cell: u64, target_cell: u64, shape: u8, size: u64, filter: u8) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), caster_cell);
  let effect = spell_effect::new_effect(
    spell_effect::k_geometric_push(),
    spell::el_none(),
    0,
    shape,
    size,
    filter,
    100,
    0,
    0,
    0,
    spell_effect::phase_on_enter(),
  );
  let stats = plain_stats();
  let mut rng = 7;
  cast::apply_effect_for_testing(fight, 0, 0, caster_cell, &stats, 50, target_cell, &effect, &mut rng);
}

fun assert_displaced_at(
  index: u64,
  target_is_mob: bool,
  target_idx: u64,
  from_cell: u64,
  to_cell: u64,
  requested: u64,
  blocked: u64,
) {
  let events = event::events_by_type<fight_events::Displaced>();
  let (_fight, got_side, got_idx, got_kind, got_from, got_to, got_requested, got_blocked) =
    fight_events::displaced_for_testing(events.borrow(index));
  assert!(got_side == target_is_mob && got_idx == target_idx);
  assert!(got_kind == spell_effect::k_geometric_push());
  assert!(got_from == from_cell && got_to == to_cell);
  assert!(got_requested == requested && got_blocked == blocked);
}

#[test]
fun geometric_cross_pushes_every_fighter_to_zone_edge() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 166);

  apply(&mut fight, 164, 165, spell_effect::shape_cross(), 3);

  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 162);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 168);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 100);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(event::events_by_type<fight_events::Displaced>().length() == 2);
  assert_displaced_at(0, false, 0, 164, 162, 2, 0);
  assert_displaced_at(1, true, 0, 166, 168, 2, 0);
  assert!(event::events_by_type<fight_events::Hit>().is_empty());
  finish(sc, fight);
}

#[test]
fun geometric_push_obstacle_collision_uses_derived_distance() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 103);

  apply(&mut fight, 200, 102, spell_effect::shape_cross(), 3);

  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 103);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 76);
  assert_displaced_at(0, true, 0, 103, 103, 2, 2);
  let hits = event::events_by_type<fight_events::Hit>();
  let (_fight, is_mob, idx, amount, hp) = fight_events::hit_for_testing(hits.borrow(0));
  assert!(hits.length() == 1 && is_mob && idx == 0 && amount == 24 && hp == 76);
  finish(sc, fight);
}

#[test]
fun geometric_push_crossed_trap_triggers_and_force_stops() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  spell_board::place_trap(
    fight::fx_mut(&mut fight),
    167,
    0,
    spell_effect::shape_point(),
    0,
    vector[spell_effect::damage(spell::el_earth(), 7)],
  );

  apply(&mut fight, 100, 164, spell_effect::shape_cross(), 4);

  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 93);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  assert_displaced_at(0, true, 0, 165, 167, 3, 0);
  finish(sc, fight);
}

#[test]
fun geometric_point_origin_requests_zero() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  apply(&mut fight, 100, 165, spell_effect::shape_point(), 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 165);
  assert_displaced_at(0, true, 0, 165, 165, 0, 0);
  finish(sc, fight);
}

#[test]
fun geometric_target_filter_is_ignored() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 166);
  apply_with_filter(&mut fight, 164, 165, spell_effect::shape_cross(), 3, spell_effect::tf_not_team());
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 162);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 168);
  assert_displaced_at(0, false, 0, 164, 162, 2, 0);
  assert_displaced_at(1, true, 0, 166, 168, 2, 0);
  finish(sc, fight);
}

#[test]
fun geometric_grid_edge_is_zone_edge_without_collision() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 179);
  apply(&mut fight, 100, 178, spell_effect::shape_cross(), 4);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 179);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert_displaced_at(0, true, 0, 179, 179, 0, 0);
  finish(sc, fight);
}

#[test]
fun geometric_diagonal_tie_uses_x_ray() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 186);
  apply(&mut fight, 100, 165, spell_effect::shape_circle(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 187);
  assert_displaced_at(0, true, 0, 186, 187, 1, 0);
  finish(sc, fight);
}

#[test]
fun geometric_line_uses_dominant_cast_direction() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 166);
  apply(&mut fight, 144, 165, spell_effect::shape_line(), 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 168);
  assert_displaced_at(0, true, 0, 166, 168, 2, 0);
  finish(sc, fight);
}

#[test]
fun geometric_tbar_uses_perpendicular_zone_edge() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 185);
  apply(&mut fight, 164, 165, spell_effect::shape_tbar(), 2);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 205);
  assert_displaced_at(0, true, 0, 185, 205, 1, 0);
  finish(sc, fight);
}
