// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::placement_swap_tests;
use aresrpg::fight;
use aresrpg_combat::combat;
use sui::test_scenario;

fun exercise(owner: address, other_owner: address, ready: Option<u64>) {
  let mut scenario = test_scenario::begin(@0xA);
  let mut fight = fight::placement_fight_for_testing(owner, other_owner, scenario.ctx());
  let from = combat::fighter_cell(fight::combat_for_testing(&fight), 0);
  let to = combat::fighter_cell(fight::combat_for_testing(&fight), 1);
  if (ready.is_some()) { let _ = fight::ready(&mut fight, *ready.borrow(), scenario.ctx()); };
  fight::place(&mut fight, 0, to, scenario.ctx());
  assert!(combat::fighter_cell(fight::combat_for_testing(&fight), 0) == to, 0);
  assert!(combat::fighter_cell(fight::combat_for_testing(&fight), 1) == from, 1);
  let empty = *combat::first_free_start(fight::combat_for_testing(&fight), 0).borrow();
  fight::place(&mut fight, 0, empty, scenario.ctx());
  assert!(combat::fighter_cell(fight::combat_for_testing(&fight), 0) == empty, 2);
  assert!(combat::fighter_cell(fight::combat_for_testing(&fight), 1) == from, 3);
  fight::destroy_retry_boundary_for_testing(fight);
  scenario.end();
}

#[test]
fun one_sender_can_swap_both_owned_fighters() { exercise(@0xA, @0xA, option::none()); }

#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun cannot_move_another_owners_target() { exercise(@0xA, @0xB, option::none()); }

#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun cannot_move_another_owners_source() { exercise(@0xB, @0xA, option::none()); }

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun a_ready_actor_cannot_swap() { exercise(@0xA, @0xA, option::some(0)); }

#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun a_ready_target_cannot_be_swapped() { exercise(@0xA, @0xA, option::some(1)); }
