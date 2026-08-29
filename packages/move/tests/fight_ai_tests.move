// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE FROG LAW (owner repro 2026-08-23): a mob that LOOKS close but stands behind a wall
/// must spend its movement walking around — "already close by straight-line" is never a
/// reason to pass. The first direct mob-brain tests: detour progress under a small budget,
/// the flank reached under a big one, and the one legal hold — a truly sealed target.
#[test_only]
module aresrpg::fight_ai_tests;

use aresrpg::fight;
use aresrpg_math::combat_grid;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

/// A vertical wall at x=4 spanning y=3..8 — two straight-line-close cells, one long detour.
fun wall(): vector<u64> {
  let mut cells = vector[];
  let mut y = 3;
  while (y <= 8) {
    cells.push_back(combat_grid::encode(4, y));
    y = y + 1;
  };
  cells
}

#[test]
fun a_blocked_mob_walks_its_budget_around_the_wall() {
  let mut scenario = test_scenario::begin(OWNER);
  // Manhattan distance 2, real path around the wall ~7 — 3 MP cannot reach any cell that is
  // straight-line closer, but progress along the detour MUST still happen (the frog bug:
  // the old rush held still here and passed the turn).
  let landed = fight::rush_for_testing(
    combat_grid::encode(3, 5),
    combat_grid::encode(5, 5),
    wall(),
    3,
    scenario.ctx(),
  );
  scenario.end();
  assert!(landed != combat_grid::encode(3, 5), 0);
  assert!(landed == combat_grid::encode(3, 2), 1);
}

#[test]
fun a_big_budget_reaches_the_flank() {
  let mut scenario = test_scenario::begin(OWNER);
  let landed = fight::rush_for_testing(
    combat_grid::encode(3, 5),
    combat_grid::encode(5, 5),
    wall(),
    12,
    scenario.ctx(),
  );
  scenario.end();
  // walked around into melee reach
  assert!(combat_grid::manhattan(landed, combat_grid::encode(5, 5)) == 1, 0);
}

#[test]
fun a_sealed_target_is_the_one_legal_hold() {
  let mut scenario = test_scenario::begin(OWNER);
  // the enemy is boxed on all four sides — no approach exists; the mob holds, no abort
  let mut box_walls = vector[
    combat_grid::encode(5, 4),
    combat_grid::encode(5, 6),
    combat_grid::encode(4, 5),
    combat_grid::encode(6, 5),
  ];
  box_walls.append(wall());
  let landed = fight::rush_for_testing(
    combat_grid::encode(3, 5),
    combat_grid::encode(5, 5),
    box_walls,
    6,
    scenario.ctx(),
  );
  scenario.end();
  assert!(landed == combat_grid::encode(3, 5), 0);
}

#[test]
fun an_ally_only_buff_targets_the_mob_ally_not_the_player() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(fight::ally_buff_for_testing(scenario.ctx()) == vector[0, 1], 0);
  scenario.end();
}

#[test]
fun a_mob_spends_remaining_ap_on_repeated_casts() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(fight::mob_multi_cast_for_testing(0, scenario.ctx()) == vector[0, 80, 2], 0);
  scenario.end();
}

#[test]
fun a_mob_respects_its_authored_per_turn_cast_cap() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(fight::mob_multi_cast_for_testing(1, scenario.ctx()) == vector[4, 90, 1], 0);
  scenario.end();
}
