// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_history_work_tests;
use aresrpg::{character, fight, item};
use aresrpg_combat::combat;
use kiosk::personal_kiosk;
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

// Directly construct the exact retained forfeit shape so setup cost does not include a
// quadratic replay of earlier transactions. Exercise real core boundaries and final custody.
fun recover(history: u64, start_fight: bool) {
  let mut scenario = test_scenario::begin(@0xA11CE);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA11CE);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let character_id = object::id(&character);
  let mut fight = fight::retained_history_for_testing(character, history, scenario.ctx());
  let bytes = std::bcs::to_bytes(&fight).length();
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::set_for_testing(&mut clock, 1);
  assert!(bytes <= 256000, 4);
  let mut entropy = random::new_generator_from_seed_for_testing(b"retained_history");
  if (start_fight) {
    fight::start(&mut fight, &mut entropy, &clock);
    assert!(std::bcs::to_bytes(&fight).length() <= 256000, 5);
    clock::set_for_testing(&mut clock, 3001);
    fight::end_turn(&mut fight, &mut entropy, &clock, scenario.ctx());
    assert!(combat::active_fighter(fight::combat_for_testing(&fight)) == 1, 0);
    clock::set_for_testing(&mut clock, 100001);
    fight::crank(&mut fight, &mut entropy, &clock);
    assert!(combat::active_fighter(fight::combat_for_testing(&fight)) == 0, 1);
  };
  fight::forfeit(&mut fight, 0, &mut kiosk, cap, &policy, &mut entropy, &clock, scenario.ctx());
  assert!(kiosk.has_item(character_id), 2);
  assert!(combat::ended(fight::combat_for_testing(&fight)), 3);
  assert!(std::bcs::to_bytes(&fight).length() <= 256000, 6);
  fight::destroy_retry_boundary_for_testing(fight);
  clock::destroy_for_testing(clock);
  transfer::public_transfer(kiosk, @0xA11CE);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).destroy_zero();
  scenario.end();
}

#[test]
fun history_0() { recover(0, true); }
#[test]
fun history_16() { recover(16, true); }
#[test]
fun history_128() { recover(128, true); }
#[test]
fun history_512() { recover(512, true); }
#[test]
fun history_1024() { recover(1024, true); }

#[test]
fun oversized_legacy_placement_still_returns_its_character_without_starting() { recover(1055, false); }
