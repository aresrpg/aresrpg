// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Only immediate damage reveals its caster. A trap stores the same damage for later.
#[test_only]
module aresrpg::fight_invisibility_tests;

use aresrpg::fight;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

fun invisible_after_cast(placement: bool): bool {
  let mut scenario = test_scenario::begin(OWNER);
  let hidden = fight::invisible_after_damage_cast_for_testing(placement, scenario.ctx());
  scenario.end();
  hidden
}

#[test]
fun trap_placement_preserves_invisibility() {
  assert!(invisible_after_cast(true), 0);
}

#[test]
fun direct_damage_reveals() {
  assert!(!invisible_after_cast(false), 0);
}

#[test]
fun mob_searches_when_every_enemy_is_invisible() {
  let mut scenario = test_scenario::begin(OWNER);
  let cells = fight::mob_searches_for_invisible_enemy_for_testing(scenario.ctx());
  assert!(cells[0] != cells[1], 0);
  scenario.end();
}
