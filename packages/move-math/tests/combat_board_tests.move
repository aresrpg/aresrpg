// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::combat_board_tests;
use aresrpg_math::combat_grid;

fun full_shape(): vector<u64> {
  combat_grid::mask_from_cells(&vector::tabulate!(combat_grid::grid_cells(), |cell| cell))
}

fun side_a(): vector<u64> { vector[100, 101, 102, 103, 104, 105] }
fun side_b(): vector<u64> { vector[200, 201, 202, 203, 204, 205] }

fun board(obstacles: vector<u64>, holes: vector<u64>, a: vector<u64>, b: vector<u64>): combat_grid::GridSpec {
  combat_grid::grid_spec(20, 19, full_shape(), obstacles, holes, a, b)
}

#[test]
fun an_authored_board_preserves_geometry_and_derives_closed_cells() {
  let board = board(vector[120], vector[121], side_a(), side_b());
  assert!(combat_grid::width(&board) == 20 && combat_grid::height(&board) == 19, 0);
  assert!(combat_grid::shape_mask(&board) == full_shape(), 1);
  assert!(combat_grid::obstacles(&board) == vector[120] && combat_grid::holes(&board) == vector[121], 2);
  assert!(combat_grid::start_cells_a(&board) == side_a() && combat_grid::start_cells_b(&board) == side_b(), 3);
  let closed = combat_grid::closed_mask(&board);
  assert!(combat_grid::mask_get(&closed, 120) && combat_grid::mask_get(&closed, 121), 4);
  assert!(!combat_grid::mask_get(&closed, 100), 5);
  assert!(combat_grid::first_free(&side_a(), &vector[100]) == option::some(101), 6);
  assert!(combat_grid::first_free(&side_a(), &side_a()).is_none(), 7);
}

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun zero_width_is_not_a_board() { let _ = combat_grid::grid_spec(0, 19, full_shape(), vector[], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun excess_width_is_not_a_board() { let _ = combat_grid::grid_spec(21, 19, full_shape(), vector[], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun zero_height_is_not_a_board() { let _ = combat_grid::grid_spec(20, 0, full_shape(), vector[], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun excess_height_is_not_a_board() { let _ = combat_grid::grid_spec(20, 20, full_shape(), vector[], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun a_shape_must_have_the_complete_fixed_mask() { let _ = combat_grid::grid_spec(20, 19, vector[], vector[], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun both_sides_require_six_starts_a() { let _ = board(vector[], vector[], vector[100], side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun both_sides_require_six_starts_b() { let _ = board(vector[], vector[], side_a(), vector[200]); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun one_side_cannot_repeat_a_start() { let _ = board(vector[], vector[], vector[100, 100, 102, 103, 104, 105], side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun the_other_side_cannot_repeat_a_start() { let _ = board(vector[], vector[], side_a(), vector[200, 200, 202, 203, 204, 205]); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun opposing_sides_cannot_share_a_start() { let _ = board(vector[], vector[], side_a(), vector[100, 201, 202, 203, 204, 205]); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun obstacles_cannot_live_outside_the_grid() { let _ = board(vector[380], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun holes_must_belong_to_the_authored_shape() {
  let shape = combat_grid::mask_from_cells(&vector::tabulate!(300, |cell| cell));
  let _ = combat_grid::grid_spec(20, 19, shape, vector[], vector[350], side_a(), side_b());
}

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun starts_cannot_live_on_obstacles() { let _ = board(vector[100], vector[], side_a(), side_b()); }

#[test]
#[expected_failure(abort_code = 1101, location = aresrpg_math::combat_grid)]
fun starts_cannot_live_on_holes() { let _ = board(vector[], vector[200], side_a(), side_b()); }

#[test]
fun simultaneous_push_and_pull_have_stable_distance_and_seat_order() {
  let cells = vector[104, 106, 105, 124];
  let seats = vector[3, 1, 0, 2];
  assert!(combat_grid::travel_order(seats, &cells, 100, true) == vector[1, 2, 3, 0], 0);
  assert!(combat_grid::travel_order(seats, &cells, 100, false) == vector[0, 2, 3, 1], 1);
}

#[test]
fun masks_and_paths_reject_raw_out_of_grid_coordinates() {
  let walls = combat_grid::mask_from_cells(&vector[10, 380]);
  assert!(!combat_grid::mask_get(&walls, 380), 0);
  assert!(!combat_grid::path_is_walkable(380, &vector[], &walls, 3), 1);
  assert!(!combat_grid::path_is_walkable(0, &vector[1, 2], &walls, 1), 2);
  assert!(!combat_grid::path_is_walkable(379, &vector[380], &walls, 1), 3);
  let field = combat_grid::bfs_distance_field(0, &walls, 1);
  assert!(combat_grid::distance_at(&field, 380) == combat_grid::path_unreachable(), 4);
}

#[test]
fun sight_respects_axis_direction_endpoints_and_obstacles_beyond_the_target() {
  assert!(!combat_grid::line_of_sight(189, 195, &vector[192]), 0);
  assert!(combat_grid::line_of_sight(189, 195, &vector[189, 195, 186, 196, 172]), 1);
  assert!(!combat_grid::line_of_sight(189, 309, &vector[249]), 2);
  assert!(combat_grid::line_of_sight(189, 309, &vector[329, 169]), 3);
  assert!(!combat_grid::line_of_sight(190, 184, &vector[187]), 4);
  assert!(combat_grid::line_of_sight(190, 184, &vector[183]), 5);
  assert!(!combat_grid::line_of_sight(190, 150, &vector[170]), 6);
}

#[test]
fun sight_uses_cell_center_wedges_instead_of_blocking_every_diagonal_corner() {
  assert!(!combat_grid::line_of_sight(189, 252, &vector[210]), 0);
  assert!(combat_grid::line_of_sight(189, 252, &vector[190, 209]), 1);
  assert!(combat_grid::line_of_sight(189, 252, &vector[168, 188]), 2);
  assert!(!combat_grid::line_of_sight(189, 252, &vector[168, 190, 210]), 3);
}

#[test]
fun pull_directions_invert_push_directions_and_same_cell_has_no_direction() {
  assert!(combat_grid::toward_dir(100, 101) == combat_grid::away_dir(101, 100), 0);
  assert!(combat_grid::toward_dir(101, 100) == combat_grid::away_dir(100, 101), 1);
  assert!(combat_grid::toward_dir(100, 120) == combat_grid::away_dir(120, 100), 2);
  assert!(combat_grid::toward_dir(120, 100) == combat_grid::away_dir(100, 120), 3);
  assert!(combat_grid::toward_dir(100, 100) == combat_grid::dir_none(), 4);
}
