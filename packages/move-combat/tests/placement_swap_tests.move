// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::placement_swap_tests;
use aresrpg_combat::{combat, public_lifecycle_tests};

#[test]
fun swaps_even_when_the_start_area_is_full() {
  let mut state = public_lifecycle_tests::placement();
  vector[101, 102, 103, 104, 105].do!(|cell|
    combat::add_fighter(&mut state, public_lifecycle_tests::player(0, cell)));
  assert!(combat::first_free_start(&state, 0).is_none(), 0);
  combat::place(&mut state, 0, 101);
  assert!(combat::fighter_cell(&state, 0) == 101, 1);
  assert!(combat::fighter_cell(&state, 2) == 100, 2);
  assert!(combat::first_free_start(&state, 0).is_none(), 3);
  combat::destroy(state);
}

fun pair(): combat::State {
  let mut state = public_lifecycle_tests::placement();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(0, 101));
  state
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_ready_source() {
  let mut state = pair();
  let _ = combat::ready(&mut state, 0);
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_ready_target() {
  let mut state = pair();
  let _ = combat::ready(&mut state, 2);
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_settled_target() {
  let mut state = pair();
  combat::set_fighter_settled_for_testing(&mut state, 2, true);
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_opposite_team_even_on_a_start_cell() {
  let mut state = public_lifecycle_tests::placement();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(1, 101));
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_a_mob_target() {
  let mut state = public_lifecycle_tests::placement();
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 1, 100, &aresrpg_math::item_stats::zero());
  let snapshot = combat::new_mob_snapshot(b"test".to_string(), 1, vector[], 0, vector[]);
  combat::add_fighter(&mut state, combat::new_mob_fighter(0, 101, stats, snapshot));
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_a_swap_outside_the_start_area() {
  let board = aresrpg_math::combat_grid::generate(17, 0);
  let to = board.start_cells_a()[0];
  let mut state = combat::new_state(board, vector[
    public_lifecycle_tests::player(0, 9999), public_lifecycle_tests::player(0, to),
  ], 0);
  combat::place(&mut state, 0, to);
  combat::destroy(state);
}

#[test]
fun a_forfeited_target_leaves_a_free_cell_without_being_moved() {
  let mut state = pair();
  combat::forfeit(&mut state, 2);
  combat::place(&mut state, 0, 101);
  assert!(combat::fighter_cell(&state, 0) == 101, 0);
  assert!(combat::fighter_cell(&state, 2) == 101 && combat::fighter_dead(&state, 2), 1);
  combat::destroy(state);
}

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun refuses_a_mob_source() {
  let mut state = public_lifecycle_tests::placement();
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 1, 100, &aresrpg_math::item_stats::zero());
  let snapshot = combat::new_mob_snapshot(b"test".to_string(), 1, vector[], 0, vector[]);
  combat::add_fighter(&mut state, combat::new_mob_fighter(0, 101, stats, snapshot));
  combat::place(&mut state, 2, 102);
  combat::destroy(state);
}
