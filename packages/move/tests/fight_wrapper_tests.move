// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Core/combat boundary proof: authority and Character custody stay in core while start and
/// strike transition the production combat state and core emits canonical lifecycle events.
#[test_only]
module aresrpg::fight_wrapper_tests;

use aresrpg::{character, fight};
use sui::{clock, event, test_scenario};

const OWNER: address = @0xA11CE;

#[test]
fun core_authenticates_and_forwards_one_complete_lethal_action() {
  let mut scenario = test_scenario::begin(OWNER);
  let character = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let result = fight::wrapper_lifecycle_for_testing(character, &clock, scenario.ctx());
  assert!(result == vector[1, 1, 0], 0);
  assert!(event::events_by_type<fight::FightStarted>().length() == 1, 1);
  assert!(event::events_by_type<fight::FightEnded>().length() == 1, 2);
  clock::destroy_for_testing(clock);
  scenario.end();
}
