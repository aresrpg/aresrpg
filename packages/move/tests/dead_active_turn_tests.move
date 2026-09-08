// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::dead_active_turn_tests;
use aresrpg::fight;
use sui::{clock, event, test_scenario};

fun boundary(owner: address, action: u8, now: u64): vector<u64> {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::set_for_testing(&mut clock, now);
  let result = fight::dead_active_boundary_for_testing(owner, action, &clock, scenario.ctx());
  clock::destroy_for_testing(clock);
  scenario.end();
  result
}

#[test]
fun death_preserves_terminal_authority_and_commits_next_entropy() {
  let result = boundary(@0xA11CE, 0, 3000);
  assert!(result[0] == 1 && result[1] != 77 && result[2] == 0, 0);
  assert!(event::events_by_type<fight::FightEnded>().is_empty(), 1);
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun death_does_not_authorize_a_foreign_sender() { let _ = boundary(@0xBAD, 0, 3000); }

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun death_does_not_allow_another_movement_action() { let _ = boundary(@0xA11CE, 1, 3000); }

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_settled_seat_cannot_submit_the_boundary() { let _ = boundary(@0xA11CE, 2, 3000); }

#[test]
#[expected_failure(abort_code = 1724, location = aresrpg_combat::combat)]
fun death_preserves_the_chain_turn_floor() { let _ = boundary(@0xA11CE, 0, 2999); }
