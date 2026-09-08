// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::world_lifecycle_tests;

use aresrpg::{api, character, item, party, protected_policy, version, world};
use aresrpg_control::admin;
use aresrpg_seed::{registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, coin, kiosk, package::Publisher, test_scenario, transfer_policy};

const OWNER: address = @0xA;

#[test]
fun paid_birth_travel_return_and_deletion_preserve_the_name_reservation() {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  character::test_init(scenario.ctx());
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<version::Version>();
  let mut names = scenario.take_shared<character::NameRegistry>();
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let nauvis = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let yakutia = world_content::create(&admin, &mut root, b"yakutia".to_string(), 1, scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let id = object::id_from_address(character::test_derived_address(&names, b"traveller".to_string()));
  api::create_character(&mut names, coin::mint_for_testing(1_000_000_000, scenario.ctx()), &mut kiosk,
    personal.borrow(), &policy, b"Traveller".to_string(), b"senshi".to_string(), true, 1, 2, 3,
    &nauvis, &version, &clock, scenario.ctx());
  assert!(kiosk.is_locked(id) && kiosk.item_count() == 1, 0);
  assert!(world::current_world(kiosk.borrow<character::Character>(personal.borrow(), id)) == b"nauvis".to_string(), 1);
  clock.increment_for_testing(1000);
  world::prove_move(kiosk.borrow_mut(personal.borrow(), id), 50_005, 50_000, &clock);
  clock.increment_for_testing(1000);
  api::join_world(&mut kiosk, personal.borrow(), id, &yakutia, &version, &clock);
  api::join_world(&mut kiosk, personal.borrow(), id, &nauvis, &version, &clock);
  let (place, x, z) = world::current_checkpoint_for_testing(kiosk.borrow(personal.borrow(), id));
  assert!(place == b"nauvis".to_string() && x == 50_000 && z == 50_000, 2);
  let friend_registry = party::registry_for_testing(scenario.ctx());
  api::delete_character(&friend_registry, &mut kiosk, personal.borrow(), id, &protected, &version, scenario.ctx());
  assert!(!kiosk.has_item(id) && character::test_name_exists(&names, b"traveller".to_string()), 3);
  party::destroy_registry_for_testing(friend_registry);
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(version);
  test_scenario::return_shared(names);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  publisher.burn();
  world_content::share(nauvis);
  world_content::share(yakutia);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  clock.destroy_for_testing();
  scenario.end();
}

#[test, expected_failure(abort_code = 302, location = aresrpg::world)]
fun world_entry_requires_the_current_level_gate() {
  let mut scenario = test_scenario::begin(OWNER);
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&admin, &mut root, b"yakutia".to_string(), 20, scenario.ctx());
  let mut actor = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut actor, &content, &clock::create_for_testing(scenario.ctx()));
  abort 999
}

#[test, expected_failure(abort_code = 303, location = aresrpg::world)]
fun a_worldless_character_has_no_current_world() {
  let mut ctx = tx_context::dummy();
  world::current_world(&character::test_character(b"senshi".to_string(), 1, 0, &mut ctx));
  abort 999
}

#[test, expected_failure(abort_code = 303, location = aresrpg::world)]
fun a_worldless_character_has_no_mutable_checkpoint() {
  let mut ctx = tx_context::dummy();
  let mut actor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  world::delay_checkpoint(&mut actor, 1, &clock::create_for_testing(&mut ctx));
  abort 999
}

#[test, expected_failure(abort_code = 303, location = aresrpg::world)]
fun a_worldless_character_cannot_claim_to_be_unrooted() {
  let mut ctx = tx_context::dummy();
  let actor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  world::is_rooted(&actor, &clock::create_for_testing(&mut ctx));
  abort 999
}

fun invalid_move(outside: bool) {
  let mut ctx = tx_context::dummy();
  let admin = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, &ctx);
  let mut actor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  let clock = clock::create_for_testing(&mut ctx);
  world::join_world(&mut actor, &content, &clock);
  world::prove_move(&mut actor, if (outside) 100_000 else 51_000, 50_000, &clock);
  abort 999
}

#[test, expected_failure(abort_code = 304, location = aresrpg::world)]
fun world_coordinates_cannot_reach_the_exclusive_upper_bound() { invalid_move(true); }

#[test, expected_failure(abort_code = 305, location = aresrpg::world)]
fun a_teleport_cannot_pass_as_same_timestamp_walking() { invalid_move(false); }

#[test, expected_failure(abort_code = 308, location = aresrpg::world)]
fun a_city_potion_cannot_invent_an_unauthored_destination() {
  let mut ctx = tx_context::dummy();
  let admin = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, &ctx);
  let mut actor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  let clock = clock::create_for_testing(&mut ctx);
  world::join_world(&mut actor, &content, &clock);
  world::teleport_city(&mut actor, &content, &b"missing".to_string(), &clock);
  abort 999
}
