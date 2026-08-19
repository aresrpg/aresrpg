// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_shield_tests;

use aresrpg::fight;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun shield_uses_elemental_characteristic_without_raw_damage_and_matches_incoming_element() {
  let mut scenario = test_scenario::begin(OWNER);
  let result = fight::elemental_shield_scaling_for_testing(scenario.ctx());
  assert!(result[0] == 60, 0); // 12 × (100 + 400 agility) / 100; raw damage is ignored
  assert!(result[1] == 37, 1); // 100 air − 60 air shield − 3 universal; earth shield ignored
  scenario.end();
}
