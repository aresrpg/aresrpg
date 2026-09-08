// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::market_policy_tests;

use aresrpg::{character, equipment, item, listing_rule, lot_rule, naked_rule, protected_policy, version};
use aresrpg_seed::item_rows;
use kiosk::personal_kiosk;
use sui::{coin, kiosk, package::Publisher, test_scenario, transfer_policy};

const OWNER: address = @0xA;

fun setup(): test_scenario::Scenario {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  scenario
}

#[test]
fun real_item_purchase_requires_both_listing_and_lot_receipts() {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  let version = scenario.take_shared<version::Version>();
  let (mut policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  listing_rule::add(&mut policy, &policy_cap);
  lot_rule::add(&mut policy, &policy_cap);
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let stack = item::mint_plain(&template, 10, scenario.ctx());
  let id = object::id(&stack);
  seller.lock(personal.borrow(), &policy, stack);
  seller.list<item::Item>(personal.borrow(), id, 100);
  transfer::public_share_object(seller);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer::public_transfer(policy, OWNER);
  transfer::public_transfer(policy_cap, OWNER);
  transfer::public_transfer(publisher, OWNER);
  item_rows::destroy_for_testing(template);
  test_scenario::return_shared(version);

  scenario.next_tx(@0xB);
  let mut seller = scenario.take_shared<kiosk::Kiosk>();
  let version = scenario.take_shared<version::Version>();
  let (stack, mut request) = seller.purchase<item::Item>(id, coin::mint_for_testing(100, scenario.ctx()));
  let policy = scenario.take_from_address<transfer_policy::TransferPolicy<item::Item>>(OWNER);
  listing_rule::prove(&stack, &mut request, &version, &seller);
  lot_rule::prove(&stack, &mut request, &version);
  let (sold_id, paid, source) = policy.confirm_request(request);
  assert!(sold_id == id && paid == 100 && source == object::id(&seller), 0);
  assert!(stack.amount() == 10 && !seller.has_item(id), 1);
  item::destroy(stack);
  test_scenario::return_to_address(OWNER, policy);
  test_scenario::return_shared(version);
  test_scenario::return_shared(seller);
  scenario.end();
}

#[test]
fun zero_price_private_transfers_allow_exact_stack_amounts_and_gear() {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  let version = scenario.take_shared<version::Version>();
  let (mut policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  lot_rule::add(&mut policy, &policy_cap);
  let categories = vector[b"resource", b"hat"];
  categories.do!(|category| {
    let category = category.to_string();
    let amount = if (category == b"resource".to_string()) 17 else 1;
    let template = item_rows::template_for_testing(category, category, scenario.ctx());
    let held = item::mint_plain(&template, amount, scenario.ctx());
    let mut request = transfer_policy::new_request(object::id(&held), 0, object::id_from_address(@0x1));
    lot_rule::prove(&held, &mut request, &version);
    let (_, paid, _) = policy.confirm_request(request);
    assert!(paid == 0 && held.amount() == amount, 0);
    item::destroy(held);
    item_rows::destroy_for_testing(template);
  });
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  publisher.burn();
  test_scenario::return_shared(version);
  scenario.end();
}

#[test]
fun naked_character_rule_confirms_the_actual_purchase_identity() {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  let version = scenario.take_shared<version::Version>();
  let (mut policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  naked_rule::add(&mut policy, &policy_cap);
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let actor = character::test_character(b"senshi".to_string(), 30, 0, scenario.ctx());
  let id = object::id(&actor);
  seller.lock(personal.borrow(), &policy, actor);
  seller.list<character::Character>(personal.borrow(), id, 100);
  let (actor, mut request) = seller.purchase<character::Character>(id, coin::mint_for_testing(100, scenario.ctx()));
  naked_rule::prove(&actor, &mut request, &version, &seller);
  let (sold_id, paid, _) = policy.confirm_request(request);
  assert!(sold_id == id && paid == 100, 0);
  character::destroy(actor);
  transfer::public_share_object(seller);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  publisher.burn();
  test_scenario::return_shared(version);
  scenario.end();
}

#[test]
fun protected_policy_is_shared_ruleless_and_restores_locked_custody() {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  protected_policy::mint_and_share<item::Item>(&publisher, scenario.ctx());
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (mut held_kiosk, cap) = kiosk::new(scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 7, scenario.ctx());
  let id = object::id(&held);
  held_kiosk.lock(&cap, &policy, held);
  transfer::public_transfer(held_kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);
  transfer::public_transfer(policy, OWNER);
  transfer::public_transfer(policy_cap, OWNER);
  publisher.burn();
  item_rows::destroy_for_testing(template);
  scenario.next_tx(OWNER);
  let protected = scenario.take_shared<protected_policy::AresRPG_TransferPolicy<item::Item>>();
  let mut held_kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let held = protected.extract_from_kiosk(&mut held_kiosk, &cap, id, scenario.ctx());
  assert!(held.amount() == 7 && !held_kiosk.has_item(id), 0);
  item::destroy(held);
  held_kiosk.close_and_withdraw(cap, scenario.ctx()).into_balance().destroy_zero();
  let policy = scenario.take_from_sender<transfer_policy::TransferPolicy<item::Item>>();
  let policy_cap = scenario.take_from_sender<transfer_policy::TransferPolicyCap<item::Item>>();
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  test_scenario::return_shared(protected);
  scenario.end();
}

#[test, expected_failure(abort_code = 803, location = aresrpg::listing_rule)]
fun listing_proof_refuses_another_seller_kiosk() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (seller, _cap) = kiosk::new(scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 1, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id(&held), 1, object::id_from_address(@0x1));
  listing_rule::prove(&held, &mut request, &version, &seller);
  abort 999
}

#[test, expected_failure(abort_code = 801, location = aresrpg::listing_rule)]
fun even_a_malformed_zero_stack_cannot_satisfy_a_listing_request() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let _personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let empty = item::empty_stack_for_testing(&template, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id(&empty), 1, object::id(&seller));
  listing_rule::prove(&empty, &mut request, &version, &seller);
  abort 999
}

#[test, expected_failure(abort_code = 802, location = aresrpg::listing_rule)]
fun listing_proof_refuses_another_item() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let _personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 1, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id_from_address(@0x1), 1, object::id(&seller));
  listing_rule::prove(&held, &mut request, &version, &seller);
  abort 999
}

#[test, expected_failure(abort_code = 702, location = aresrpg::lot_rule)]
fun lot_proof_refuses_another_item() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 1, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id_from_address(@0x1), 1, object::id_from_address(@0x2));
  lot_rule::prove(&held, &mut request, &version);
  abort 999
}

#[test, expected_failure(abort_code = 701, location = aresrpg::lot_rule)]
fun paid_lot_proof_refuses_an_arbitrary_stack_amount() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 17, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id(&held), 1, object::id_from_address(@0x2));
  lot_rule::prove(&held, &mut request, &version);
  abort 999
}

#[test, expected_failure(abort_code = 803, location = aresrpg::listing_rule)]
fun naked_proof_refuses_another_seller_kiosk() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (seller, _cap) = kiosk::new(scenario.ctx());
  let actor = character::test_character(b"senshi".to_string(), 30, 0, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id(&actor), 1, object::id_from_address(@0x2));
  naked_rule::prove(&actor, &mut request, &version, &seller);
  abort 999
}

#[test, expected_failure(abort_code = 822, location = aresrpg::naked_rule)]
fun naked_proof_refuses_another_character() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let _personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let actor = character::test_character(b"senshi".to_string(), 30, 0, scenario.ctx());
  let mut request = transfer_policy::new_request(object::id_from_address(@0x1), 1, object::id(&seller));
  naked_rule::prove(&actor, &mut request, &version, &seller);
  abort 999
}

#[test, expected_failure(abort_code = 821, location = aresrpg::naked_rule)]
fun equipped_character_cannot_pass_the_market_rule() {
  let mut scenario = setup();
  let version = scenario.take_shared<version::Version>();
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let _personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  let mut actor = character::test_character(b"senshi".to_string(), 30, 0, scenario.ctx());
  let template = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), scenario.ctx());
  equipment::equip(&mut actor, b"hat".to_string(), item::mint_plain(&template, 1, scenario.ctx()));
  let mut request = transfer_policy::new_request(object::id(&actor), 1, object::id(&seller));
  naked_rule::prove(&actor, &mut request, &version, &seller);
  abort 999
}
