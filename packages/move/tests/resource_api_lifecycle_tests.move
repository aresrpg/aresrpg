// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::resource_api_lifecycle_tests;

use aresrpg::{api, character::{Self, Character}, equipment, gathering, item::{Self, Item}, progression, protected_policy, version, world, zone};
use aresrpg_control::admin;
use aresrpg_math::{job_xp, world_map};
use aresrpg_seed::{item_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

#[test]
fun discovery_refresh_and_harvest_keep_persisted_personal_custody() {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let (character_policy, character_policy_cap) = transfer_policy::new<Character>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  let protected_character = protected_policy::for_testing<Character>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::set_resources(&admin, &mut root, &mut content,
    vector[world_map::new_resource_row(b"wheat".to_string(), b"FARMER".to_string(), 1,
      b"".to_string(), b"".to_string(), vector[0], vector[])], scenario.ctx());
  world::create(&admin, &mut root, &content, scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  let character_id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  kiosk.lock(cap, &character_policy, character);
  let wheat = item_rows::template_for_testing(b"wheat".to_string(), b"resource".to_string(), scenario.ctx());
  let tool = item_rows::template_for_testing(b"sickle".to_string(), b"tool_farmer".to_string(), scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"resource-api-setup");
  let held = item::mint(&wheat, 10, &mut entropy, scenario.ctx());
  let wheat_id = object::id(&held);
  item::deposit(&mut kiosk, cap, &policy, option::none(), held);
  let held = item::mint(&tool, 1, &mut entropy, scenario.ctx());
  let tool_id = object::id(&held);
  item::deposit(&mut kiosk, cap, &policy, option::none(), held);
  let version = scenario.take_shared<version::Version>();
  api::equip_item(&mut kiosk, cap, character_id, b"tool".to_string(), tool_id, &protected, &version, scenario.ctx());
  test_scenario::return_shared(version);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  world_content::share(content);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let mut world_object = scenario.take_shared<world::World>();
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 1_000_000);
  api::create_zone(&mut kiosk, &personal, character_id, 50_000, 50_000, &mut world_object,
    &randomness, &version, &clock, scenario.ctx());
  test_scenario::return_shared(world_object);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let cap = personal_kiosk::borrow(&personal);
  let mut zone = scenario.take_shared<zone::Zone>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  let seed = zone.seed_of();
  let nodes = zone.resource_pack_at(&content, 0).pack_nodes();
  api::refresh_zone(&mut kiosk, &personal, character_id, 50_000, 50_000, &mut zone,
    &randomness, &version, &clock, scenario.ctx());
  assert!(zone.seed_of() == seed);
  // Refresh writes a fresh checkpoint; allow the character to walk from it to the pack.
  clock::increment_for_testing(&mut clock, 1_000_000);
  api::gather(&mut zone, &content, &mut kiosk, &personal, character_id, 0, &wheat, &wheat,
    option::some(wheat_id), option::none(), &policy, &randomness, &version, &clock, scenario.ctx());
  let amount = item::amount(kiosk.borrow(cap, wheat_id));
  assert!(amount >= 11 && amount <= 12 && kiosk.is_locked(wheat_id));
  assert!(zone.resource_pack_at(&content, 0).pack_nodes() == nodes - 1);
  assert!(progression::job_xp_of(kiosk.borrow(cap, character_id), b"FARMER".to_string()) == job_xp::gather_xp(1));
  assert!(!gathering::has_fired_verdict(kiosk.borrow(cap, character_id)));
  assert!(world::is_rooted(kiosk.borrow(cap, character_id), &clock));
  test_scenario::return_shared(zone);
  test_scenario::return_shared(content);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let cap = personal_kiosk::borrow(&personal);
  let mut zone = scenario.take_shared<zone::Zone>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  assert!(item::amount(kiosk.borrow(cap, wheat_id)) == amount);
  clock::increment_for_testing(&mut clock, 7_200_000);
  api::refresh_zone(&mut kiosk, &personal, character_id, 50_000, 50_000, &mut zone,
    &randomness, &version, &clock, scenario.ctx());
  assert!(zone.seed_of() != seed && zone.resource_pack_at(&content, 0).pack_nodes() > 0);
  assert!(!world::is_rooted(kiosk.borrow(cap, character_id), &clock));
  api::unequip_item(&mut kiosk, cap, character_id, b"tool".to_string(),
    test_scenario::receiving_ticket_by_id<Item>(tool_id), &policy, &version);
  assert!(!equipment::has_any_equipped(kiosk.borrow(cap, character_id)));
  api::burn_item(&mut kiosk, cap, &protected, wheat_id, amount, &version, scenario.ctx());
  api::burn_item(&mut kiosk, cap, &protected, tool_id, 1, &version, scenario.ctx());
  character::destroy(protected_character.extract_from_kiosk(&mut kiosk, cap, character_id, scenario.ctx()));
  assert!(kiosk.item_count() == 0);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(zone);
  test_scenario::return_shared(content);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  item_rows::destroy_for_testing(wheat);
  item_rows::destroy_for_testing(tool);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  protected_policy::destroy_for_testing(protected_character, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  transfer_policy::destroy_and_withdraw(character_policy, character_policy_cap, scenario.ctx()).into_balance().destroy_zero();
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun stack_api_splits_merges_and_burns_exactly_the_owned_quantity() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  publisher.burn();
  let template = item_rows::template_for_testing(b"grain".to_string(), b"resource".to_string(), scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let item = item::mint_plain(&template, 10, scenario.ctx());
  let id = object::id(&item);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), item);
  let version = scenario.take_shared<version::Version>();
  let split = api::split_stack(&mut kiosk, &cap, &policy, id, 3, &version, scenario.ctx());
  assert!(item::amount(kiosk.borrow(&cap, id)) == 7 && item::amount(kiosk.borrow(&cap, split)) == 3);
  assert!(kiosk.is_locked(id) && kiosk.is_locked(split));
  test_scenario::return_shared(version);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  api::merge_stacks(&mut kiosk, &cap, &protected, id, split, &version, scenario.ctx());
  assert!(!kiosk.has_item(split) && item::amount(kiosk.borrow(&cap, id)) == 10);
  api::burn_item(&mut kiosk, &cap, &protected, id, 4, &version, scenario.ctx());
  assert!(item::amount(kiosk.borrow(&cap, id)) == 6 && kiosk.is_locked(id));
  api::burn_item(&mut kiosk, &cap, &protected, id, 6, &version, scenario.ctx());
  assert!(!kiosk.has_item(id) && kiosk.item_count() == 0);
  test_scenario::return_shared(version);
  kiosk::close_and_withdraw(kiosk, cap, scenario.ctx()).into_balance().destroy_zero();
  item_rows::destroy_for_testing(template);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  scenario.end();
}
