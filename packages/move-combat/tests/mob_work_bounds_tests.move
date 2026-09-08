// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::mob_work_bounds_tests;
use aresrpg_combat::combat;
use aresrpg_math::{combat_grid, fight_math, item_stats, mob_data, spell_effect};

fun mob_boundary(ap: u8, maximum_level: u8, cost: u8, effects: vector<spell_effect::Effect>, critical: vector<spell_effect::Effect>, roster: u64, forfeit_others: bool): combat::State {
  let board = combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[100, 101, 102, 103, 104, 105], vector[106, 107, 108, 109, 110, 111]);
  let shift = item_stats::shift();
  let level = spell_effect::new_spell_level(cost, 0, 40, false, false, false, false, 0, 0, 0, if (critical.is_empty()) 0 else 10000, effects, critical);
  // Real validated content, including its authored row-work check.
  let data = mob_data::new_mob_data(b"Budget Mob".to_string(), b"budget_mob".to_string(), b"earth".to_string(),
    1, maximum_level, 100, ap, 0, 0, 0, shift, shift, shift, shift,
    vector[mob_data::new_mob_spell(b"Budget Cast".to_string(), level)], vector[], 0, false);
  let stats = combat::new_fighter_stats(combat::new_sheet(0, 0, 0, 100, 0, 0, 0, 0, 1),
    1000, 6, 0, shift as u64, shift as u64, shift as u64, shift as u64);
  let mut fighters = vector::tabulate!(roster, |i| combat::new_player_fighter(0, board.start_cells_a()[i], 1000, stats));
  fighters.append(vector::tabulate!(roster, |i| combat::scaled_mob_fighter(&data, 100, board.start_cells_b()[i])));
  let mut state = combat::new_state(board, fighters, 0);
  let mut actor = 0u64;
  while (actor < roster) {
    let _ = combat::ready(&mut state, actor);
    actor = actor + 1;
  };
  let _ = combat::start(&mut state, vector::tabulate!(24, |i| i + 1), 0);
  // A retained twelve-seat roster can expose either twelve live targets or six consecutive mobs.
  actor = 1;
  while (forfeit_others && actor < roster) {
    combat::forfeit(&mut state, actor);
    actor = actor + 1;
  };
  let used = combat::end_turn(&mut state, vector::tabulate!(24, |i| i + 1), 3000);
  assert!(used.length() == if (forfeit_others) roster else 1, 1);
  assert!(!combat::ended(&state) && combat::active_fighter(&state) == if (forfeit_others || roster == 1) 0 else 1, 2);
  state
}

#[test]
fun an_ap_refunding_mob_must_return_control_with_bounded_work() {
  let refund = spell_effect::new_effect(4, b"".to_string(), 2, 2, 0, 0, 4, 10000, 0, 6);
  let state = mob_boundary(6, 1, 1, vector[refund], vector[], 1, true);
  assert!(combat::fighter_hp(&state, 0) == 1000 && combat::fighter_hp(&state, 1) == 100, 3);
  combat::destroy(state);
}

#[test]
fun refundable_ap_respects_sixteen_rows_not_sixteen_large_casts() {
  let refund = spell_effect::new_effect(4, b"".to_string(), 2, 2, 0, 0, 4, 10000, 0, 6);
  let hit = spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 1, 10000, 0, 0);
  let state = mob_boundary(4, 1, 1, vector[refund, hit], vector[], 1, true);
  assert!(combat::fighter_hp(&state, 0) == 992, 0);
  combat::destroy(state);
}

#[test]
fun scaled_ordinary_ap_can_still_fund_fourteen_casts() {
  let hit = spell_effect::new_effect(0, b"earth".to_string(), 10, 10, 0, 0, 1, 10000, 0, 0);
  let state = mob_boundary(32, 10, 3, vector[hit], vector[], 1, true);
  // At the top of the band AP32 becomes42 and damage10 becomes16: fourteen complete casts.
  assert!(combat::fighter_hp(&state, 0) == 776, 0);
  combat::destroy(state);
}

#[test]
fun full_roster_with_eight_all_map_rows_per_cast_stays_bounded() {
  let refund = spell_effect::new_effect(4, b"".to_string(), 2, 2, spell_effect::shape_allmap(), 0, 0, 10000, 0, 6);
  let state = mob_boundary(1, 1, 1, vector::tabulate!(8, |_| refund), vector[], 6, true);
  assert!(combat::fighter_count(&state) == 12, 0);
  let mut actor = 0u64;
  while (actor < 12) {
    assert!(combat::fighter_hp(&state, actor) == if (actor == 0) 1000 else if (actor < 6) 0 else 100, 1);
    actor = actor + 1;
  };
  combat::destroy(state);
}

#[test]
fun scaled_ap_preserves_the_full_sixteen_row_ordinary_turn() {
  let hit = spell_effect::new_effect(0, b"earth".to_string(), 10, 10, 0, 0, 1, 10000, 0, 0);
  let state = mob_boundary(3, 10, 2, vector::tabulate!(8, |_| hit), vector[], 1, true);
  // Scaled AP4 funds two eight-row casts, each row dealing16 damage.
  assert!(combat::fighter_hp(&state, 0) == 744, 0);
  combat::destroy(state);
}

#[test]
fun the_unrolled_critical_branch_still_counts_toward_the_work_bound() {
  assert!(!fight_math::crit_at(fight_math::spell_crit_roll(1, &b"Budget Cast".to_string()), 10000, 0, 0), 0);
  let refund = spell_effect::new_effect(4, b"".to_string(), 2, 2, 0, 0, 4, 10000, 0, 6);
  let hit = spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 1, 10000, 0, 0);
  let state = mob_boundary(1, 1, 1, vector[refund, hit], vector::tabulate!(8, |_| refund), 1, true);
  // A noncritical outcome still reserves eight rows per cast: exactly two one-damage hits.
  assert!(combat::fighter_hp(&state, 0) == 998, 1);
  combat::destroy(state);
}

#[test]
fun empty_effect_lists_still_consume_one_work_unit_per_cast() {
  let state = mob_boundary(255, 1, 1, vector[], vector[], 1, true);
  assert!(combat::fighter_hp(&state, 0) == 1000, 0);
  combat::destroy(state);
}

#[test]
fun all_twelve_live_fighters_can_be_targeted_within_the_boundary_budget() {
  let refund = spell_effect::new_effect(4, b"".to_string(), 2, 2, spell_effect::shape_allmap(), 0, 0, 10000, 0, 6);
  let state = mob_boundary(1, 1, 1, vector::tabulate!(8, |_| refund), vector[], 6, false);
  let mut actor = 0u64;
  while (actor < 12) {
    assert!(!combat::fighter_dead(&state, actor), 0);
    assert!(combat::fighter_hp(&state, actor) == if (actor < 6) 1000 else 100, 1);
    actor = actor + 1;
  };
  combat::destroy(state);
}
