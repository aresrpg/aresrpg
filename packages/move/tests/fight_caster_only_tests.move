// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_caster_only_tests;

use aresrpg::fight;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun caster_only_cost_ignores_the_aimed_ally_area() {
  let mut scenario = test_scenario::begin(OWNER);
  let hp = fight::caster_only_cost_for_testing(scenario.ctx());
  assert!(hp[0] == 82, 0);
  assert!(hp[1] == 100, 1);
  scenario.end();
}

#[test]
fun percent_life_damage_rolls_the_authored_band() {
  let mut scenario = test_scenario::begin(OWNER);
  let hp = fight::percent_life_roll_for_testing(scenario.ctx());
  assert!(hp[0] == hp[1], 0);
  scenario.end();
}
