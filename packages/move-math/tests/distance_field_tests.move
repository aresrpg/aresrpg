// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::distance_field_tests;

use aresrpg_math::combat_grid;

// Independent cell-by-cell BFS oracle. It deliberately does not use the bitset expansion.
fun oracle(starts: vector<u64>, walls: &vector<u64>, budget: u64, until: u64): vector<u64> {
  let mut field = vector[];
  let mut cell = 0u64;
  while (cell < 380) { field.push_back(380); cell = cell + 1; };
  let mut frontier = starts;
  let mut index = 0;
  while (index < frontier.length()) { *&mut field[frontier[index]] = 0; index = index + 1; };
  let mut distance = 0;
  while (!frontier.is_empty() && distance < budget && (until == 380 || field[until] == 380)) {
    distance = distance + 1;
    let mut next = vector[];
    let mut index = 0;
    while (index < frontier.length()) {
      let mut direction = 0;
      while (direction < 4) {
        let neighbour = combat_grid::step_cell(frontier[index], direction);
        if (neighbour.is_some()) {
          let cell = neighbour.destroy_some();
          if (field[cell] == 380 && !combat_grid::mask_get(walls, cell)) {
            *&mut field[cell] = distance;
            next.push_back(cell);
          };
        };
        direction = direction + 1;
      };
      index = index + 1;
    };
    frontier = next;
  };
  field
}

fun compare(field: &combat_grid::DistanceField, expected: &vector<u64>) {
  let mut cell = 0;
  while (cell < 380) {
    let distance = combat_grid::distance_at(field, cell);
    assert!(distance == expected[cell], cell);
    let mut best = option::none();
    let mut best_distance = distance;
    let mut direction = 0;
    while (direction < 4) {
      let step = combat_grid::step_cell(cell, direction);
      if (step.is_some()) {
        let next = step.destroy_some();
        let value = expected[next];
        if (value < best_distance || (value == best_distance && best.is_some() && next < *best.borrow())) {
          best = option::some(next);
          best_distance = value;
        };
      };
      direction = direction + 1;
    };
    assert!(combat_grid::best_step(cell, field, distance) == best, 1000 + cell);
    cell = cell + 1;
  };
}

#[test]
fun word_and_row_boundaries_preserve_every_distance_and_step() {
  let walls = combat_grid::mask_from_cells(&vector[18, 39, 63, 128, 235, 254, 276, 358]);
  let targets = vector[0, 19, 20, 64, 255, 256, 379];
  let mut index = 0;
  while (index < targets.length()) {
    let target = targets[index];
    let field = combat_grid::bfs_distance_field(target, &walls, 5);
    compare(&field, &oracle(vector[target], &walls, 5, 380));
    index = index + 1;
  };
}

#[test]
fun multi_source_approach_preserves_detours_and_displaced_steps() {
  let walls = combat_grid::mask_from_cells(&vector[84, 104, 124, 144, 164, 105]);
  let field = combat_grid::approach_field(105, &walls, 103);
  compare(&field, &oracle(vector[85, 106, 125], &walls, 380, 103));
}

#[test]
fun empty_short_blocked_and_zero_budget_searches_keep_their_contract() {
  let field = combat_grid::bfs_distance_field(256, &vector[], 0);
  compare(&field, &oracle(vector[256], &vector[], 0, 380));
  let walls = combat_grid::mask_from_cells(&vector[0, 1, 20]);
  let blocked = combat_grid::bfs_distance_field(0, &walls, 5);
  assert!(combat_grid::distance_at(&blocked, 0) == 380, 0);
  let sealed = combat_grid::approach_field(0, &walls, 40);
  assert!(combat_grid::distance_at(&sealed, 40) == 380, 1);
  let outside = combat_grid::bfs_distance_field(380, &walls, 5);
  assert!(combat_grid::distance_at(&outside, 379) == 380, 2);
}
