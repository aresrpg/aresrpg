// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::combat_cast_cells_tests;
use aresrpg_math::combat_grid;

#[test]
fun line_alignment_restricts_destinations_not_movement() {
  let walls = combat_grid::mask_from_cells(&vector[127]);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1, 3, 5, true, true, &vector[]) == option::some(124), 0);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1, 3, 5, true, false, &vector[]) == option::some(104), 1);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 0, 3, 5, true, true, &vector[]).is_none(), 2);
}

#[test]
fun blocked_alignment_and_sight_do_not_produce_false_destinations() {
  let walls = combat_grid::mask_from_cells(&vector[124, 127]);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1, 3, 5, true, true, &vector[]).is_none(), 0);
  let walls = combat_grid::mask_from_cells(&vector[127]);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1, 3, 5, true, true, &vector[125]).is_none(), 1);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1, 3, 5, false, true, &vector[125]) == option::some(124), 2);
}

#[test]
fun movement_cost_precedes_target_distance() {
  let walls = combat_grid::mask_from_cells(&vector[126]);
  assert!(combat_grid::bfs_cast_cell(104, 126, &walls, 2, 1, 5, false, true, &vector[]) == option::some(124), 0);
  assert!(combat_grid::cell_can_cast(106, 126, 1, 5, false, true, &vector[]), 1);
}

#[test]
fun equal_cost_and_distance_choose_the_lowest_cell() {
  let walls = combat_grid::mask_from_cells(&vector[126]);
  assert!(combat_grid::bfs_cast_cell(105, 126, &walls, 1, 1, 5, false, true, &vector[]) == option::some(106), 0);
}

#[test]
fun authored_minimum_range_is_shared_with_the_final_cast() {
  let walls = combat_grid::mask_from_cells(&vector[126]);
  assert!(!combat_grid::cell_can_cast(106, 126, 2, 5, false, true, &vector[]), 0);
  assert!(combat_grid::bfs_cast_cell(105, 126, &walls, 2, 2, 5, false, true, &vector[]) == option::some(86), 1);
}

#[test]
fun an_extreme_budget_does_not_make_unreachable_cells_reachable() {
  let walls = combat_grid::mask_from_cells(&vector[103, 105, 84, 124]);
  assert!(combat_grid::bfs_cast_cell(104, 127, &walls, 1000, 3, 5, true, true, &vector[]).is_none(), 0);
  assert!(combat_grid::bfs_cast_cell(380, 127, &walls, 1000, 3, 5, true, true, &vector[]).is_none(), 1);
}
