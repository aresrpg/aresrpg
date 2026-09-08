// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::equipment_lifecycle_tests;

use aresrpg::{api, character::{Self, Character}, equipment, item::{Self, Item}, protected_policy, version};
use aresrpg_control::admin;
use aresrpg_math::{item_damages, item_stats};
use aresrpg_seed::{item_rows, registry};
use sui::{event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

#[test]
fun records_and_folded_stats_follow_real_equipped_custody() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  assert!(!equipment::has_any_equipped(&character));
  assert!(equipment::equipped(&character).is_empty());
  assert!(equipment::folded(&character) == item_stats::zero());
  assert!(equipment::tool_of(&character) == b"".to_string());
  let character_id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  kiosk.place(&cap, character);
  let version = scenario.take_shared<version::Version>();
  let slots = vector[b"hat", b"weapon", b"tool", b"relic_1", b"relic_2"];
  let categories = vector[b"hat", b"sword", b"tool_miner", b"relic", b"relic"];
  let line = item_damages::new(3, 7, b"damage".to_string(), b"fire".to_string());
  let mut templates = vector[];
  let mut ids = vector[];
  let mut generator = random::new_generator_for_testing();
  let mut index = 0;
  while (index < slots.length()) {
    let mut template = item_rows::template_for_testing(slots[index].to_string(), categories[index].to_string(), scenario.ctx());
    if (index == 0) {
      let mut values = item_stats::zero().to_vector();
      *values.borrow_mut(0) = 32778;
      let stats = item_stats::from_vector(values);
      item_rows::set_stats(&admin, &mut root, &mut template, stats, stats, scenario.ctx());
    };
    if (index == 1) item_rows::set_damages(&admin, &mut root, &mut template, vector[line], scenario.ctx());
    let item = item::mint(&template, 1, &mut generator, scenario.ctx());
    let id = object::id(&item);
    item::deposit(&mut kiosk, &cap, &policy, option::none(), item);
    api::equip_item(&mut kiosk, &cap, character_id, slots[index].to_string(), id, &protected, &version, scenario.ctx());
    assert!(!kiosk.has_item(id));
    ids.push_back(id);
    templates.push_back(template);
    index = index + 1;
  };
  let character: &Character = kiosk.borrow(&cap, character_id);
  assert!(equipment::has_any_equipped(character));
  assert!(equipment::folded(character).vitality() == 32778);
  assert!(equipment::tool_of(character) == b"tool_miner".to_string());
  let records = equipment::equipped(character);
  let weapon = &records[&b"weapon".to_string()];
  assert!(equipment::record_category(weapon) == b"sword".to_string());
  assert!(equipment::record_damages(weapon) == vector[line]);
  assert!(event::events_by_type<equipment::ItemEquipped>().length() == 5);
  test_scenario::return_shared(version);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  index = 0;
  while (index < slots.length()) {
    api::unequip_item(&mut kiosk, &cap, character_id, slots[index].to_string(),
      test_scenario::receiving_ticket_by_id<Item>(ids[index]), &policy, &version);
    assert!(kiosk.is_locked(ids[index]));
    index = index + 1;
  };
  let character: &Character = kiosk.borrow(&cap, character_id);
  assert!(!equipment::has_any_equipped(character));
  assert!(equipment::folded(character) == item_stats::zero());
  assert!(equipment::tool_of(character) == b"".to_string());
  assert!(event::events_by_type<equipment::ItemUnequipped>().length() == 5);
  test_scenario::return_shared(version);
  index = 0;
  while (index < ids.length()) {
    item::destroy_for_testing(protected.extract_from_kiosk(&mut kiosk, &cap, ids[index], scenario.ctx()));
    index = index + 1;
  };
  character::destroy(kiosk.take(&cap, character_id));
  kiosk::close_and_withdraw(kiosk, cap, scenario.ctx()).into_balance().destroy_zero();
  while (!templates.is_empty()) item_rows::destroy_for_testing(templates.pop_back());
  templates.destroy_empty();
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  scenario.end();
}

fun reject_equip(variant: u8) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, _policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = item_rows::add_item(&admin, &mut root, b"gear".to_string(), b"gear".to_string(),
    if (variant == 4) b"relic".to_string() else b"hat".to_string(), if (variant == 2) 2 else 1, vector[], scenario.ctx());
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  kiosk.place(&cap, character);
  let mut generator = random::new_generator_for_testing();
  let first = item::mint(&template, 1, &mut generator, scenario.ctx());
  let first_id = object::id(&first);
  let second = item::mint(&template, 1, &mut generator, scenario.ctx());
  let second_id = object::id(&second);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), first);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), second);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);
  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  let slot = if (variant == 0) b"invented" else if (variant == 1) b"weapon" else if (variant == 4) b"relic_1" else b"hat";
  api::equip_item(&mut kiosk, &cap, id, slot.to_string(), first_id, &protected, &version, scenario.ctx());
  api::equip_item(&mut kiosk, &cap, id, if (variant == 4) b"relic_2".to_string() else slot.to_string(),
    second_id, &protected, &version, scenario.ctx());
  abort 999
}

fun reject_unequip(variant: u8) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, _policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  let version = scenario.take_shared<version::Version>();
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  kiosk.place(&cap, character);
  let mut generator = random::new_generator_for_testing();
  let hat = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), scenario.ctx());
  let cloak = item_rows::template_for_testing(b"cloak".to_string(), b"cloak".to_string(), scenario.ctx());
  let first = item::mint(&hat, 1, &mut generator, scenario.ctx());
  let first_id = object::id(&first);
  let second = item::mint(&cloak, 1, &mut generator, scenario.ctx());
  let second_id = object::id(&second);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), first);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), second);
  api::equip_item(&mut kiosk, &cap, id, b"hat".to_string(), first_id, &protected, &version, scenario.ctx());
  api::equip_item(&mut kiosk, &cap, id, b"cloak".to_string(), second_id, &protected, &version, scenario.ctx());
  test_scenario::return_shared(version);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);
  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  let slot = if (variant == 0) b"invented" else if (variant == 1) b"weapon" else b"hat";
  api::unequip_item(&mut kiosk, &cap, id, slot.to_string(),
    test_scenario::receiving_ticket_by_id<Item>(second_id), &policy, &version);
  abort 999
}

#[test, expected_failure(abort_code = 1001, location = aresrpg::equipment)] fun unknown_slot_is_rejected() { reject_equip(0); }
#[test, expected_failure(abort_code = 1002, location = aresrpg::equipment)] fun wrong_category_is_rejected() { reject_equip(1); }
#[test, expected_failure(abort_code = 1003, location = aresrpg::equipment)] fun item_level_is_enforced() { reject_equip(2); }
#[test, expected_failure(abort_code = 1004, location = aresrpg::equipment)] fun occupied_slot_is_rejected() { reject_equip(3); }
#[test, expected_failure(abort_code = 1005, location = aresrpg::equipment)] fun duplicate_relic_template_is_rejected() { reject_equip(4); }
#[test, expected_failure(abort_code = 1001, location = aresrpg::equipment)] fun unknown_unequip_slot_is_rejected() { reject_unequip(0); }
#[test, expected_failure(abort_code = 1006, location = aresrpg::equipment)] fun absent_unequip_slot_is_rejected() { reject_unequip(1); }
#[test, expected_failure(abort_code = 1007, location = aresrpg::equipment)] fun receiving_another_equipped_item_is_rejected() { reject_unequip(2); }
