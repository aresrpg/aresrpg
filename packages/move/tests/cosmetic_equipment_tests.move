// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::cosmetic_equipment_tests;

use aresrpg::{character::{Self, Character}, equipment, item::{Self, Item}};
use aresrpg_control::admin;
use aresrpg_math::item_stats;
use aresrpg_seed::{item_rows, registry};
use sui::{random, test_scenario};

const OWNER: address = @0xA;

#[test]
fun cosmetics_share_custody_without_changing_regular_hat_and_cloak_stats() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let mut generator = random::new_generator_for_testing();
  let slots = vector[b"hat", b"cloak", b"cosmetic_hat", b"cosmetic_cloak"];
  let mut ids = vector[];
  let mut i = 0;
  while (i < slots.length()) {
    let slot = slots[i].to_string();
    let mut template = item_rows::template_for_testing(slot, slot, scenario.ctx());
    if (i < 2) {
      let mut values = item_stats::zero().to_vector();
      *values.borrow_mut(0) = 32778;
      let stats = item_stats::from_vector(values);
      item_rows::set_stats(&cap, &mut root, &mut template, stats, stats, scenario.ctx());
    };
    let item = item::mint(&template, 1, &mut generator, scenario.ctx());
    assert!(item.has_stats() == (i < 2));
    ids.push_back(object::id(&item));
    equipment::equip(&mut character, slot, item);
    item_rows::destroy_for_testing(template);
    i = i + 1;
  };
  assert!(equipment::equipped(&character).length() == 4);
  assert!(equipment::folded(&character).to_vector()[0] == 32788);
  transfer::public_transfer(character, OWNER);

  scenario.next_tx(OWNER);
  let mut character = scenario.take_from_sender<Character>();
  let cosmetic_hat = equipment::unequip(&mut character, b"cosmetic_hat".to_string(), test_scenario::receiving_ticket_by_id<Item>(ids[2]));
  let cosmetic_cloak = equipment::unequip(&mut character, b"cosmetic_cloak".to_string(), test_scenario::receiving_ticket_by_id<Item>(ids[3]));
  assert!(equipment::equipped(&character).length() == 2);
  assert!(equipment::folded(&character).to_vector()[0] == 32788);
  assert!(!cosmetic_hat.has_stats() && !cosmetic_cloak.has_stats());
  transfer::public_transfer(cosmetic_hat, OWNER);
  transfer::public_transfer(cosmetic_cloak, OWNER);
  let hat = equipment::unequip(&mut character, b"hat".to_string(), test_scenario::receiving_ticket_by_id<Item>(ids[0]));
  let cloak = equipment::unequip(&mut character, b"cloak".to_string(), test_scenario::receiving_ticket_by_id<Item>(ids[1]));
  assert!(equipment::folded(&character) == item_stats::zero());
  transfer::public_transfer(hat, OWNER);
  transfer::public_transfer(cloak, OWNER);
  character::destroy(character);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}
