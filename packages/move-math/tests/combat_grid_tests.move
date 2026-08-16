// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::combat_grid_tests;

use aresrpg_math::combat_grid;

#[test]
fun steered_path_accepts_the_declared_route() {
  let walls = combat_grid::mask_from_cells(&vector[10]);

  assert!(combat_grid::path_is_walkable(0, &vector[1, 2, 3], &walls, 3), 0);
  assert!(combat_grid::path_is_walkable(0, &vector[20, 40, 41], &walls, 3), 1);
}

#[test]
fun steered_path_rejects_invalid_steps() {
  let walls = combat_grid::mask_from_cells(&vector[10]);

  assert!(!combat_grid::path_is_walkable(0, &vector[2], &walls, 3), 0);
  assert!(!combat_grid::path_is_walkable(0, &vector[1, 2, 10], &walls, 3), 1);
  assert!(!combat_grid::path_is_walkable(0, &vector[1, 2, 3, 4], &walls, 3), 2);
}
