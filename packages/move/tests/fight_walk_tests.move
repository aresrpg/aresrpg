// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The walk law under mid-walk displacement: bodies are walls, and a body a trap payload moves
/// onto a declared-but-not-yet-entered cell stops the remaining route — the walker never shares
/// a cell with a living fighter.
#[test_only]
module aresrpg::fight_walk_tests;

use aresrpg::fight;
use aresrpg_math::combat_grid;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun a_body_pulled_onto_the_declared_route_stops_the_walk() {
  let mut scenario = test_scenario::begin(OWNER);
  let answer = fight::walk_into_pulled_body_for_testing(scenario.ctx());
  scenario.end();
  let step_1 = combat_grid::encode(1, 5);
  let step_2 = combat_grid::encode(2, 5);
  // the trap's pull landed the bystander on the walker's second declared cell…
  assert!(answer[1] == step_2, 0);
  // …so the walk stops on the first step instead of entering an occupied cell
  assert!(answer[0] == step_1, 1);
  assert!(answer[0] != answer[1], 2);
}
