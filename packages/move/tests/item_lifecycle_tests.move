// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::item_lifecycle_tests;

use aresrpg::{item, protected_policy};
use aresrpg_control::admin;
use aresrpg_math::item_stats;
use aresrpg_seed::{item_rows, registry};
use sui::{kiosk, package::Publisher, random, test_scenario, transfer_policy};

#[test]
fun authenticated_drop_plans_deliver_stacks_and_separate_gear_objects() {
  let mut scenario = test_scenario::begin(@0xA);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let wool = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let hat = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), scenario.ctx());
  let mut plans = vector[item::prepare_plan(&hat, option::none()), item::prepare_plan(&wool, option::none())];
  let mut rng = random::new_generator_for_testing();
  item::deliver_drops(&mut plans, &b"wool".to_string(), 5, &mut kiosk, &cap, &policy, &mut rng, scenario.ctx());
  assert!(plans.length() == 1 && kiosk.item_count() == 1, 0);
  item::deliver_drops(&mut plans, &b"hat".to_string(), 3, &mut kiosk, &cap, &policy, &mut rng, scenario.ctx());
  assert!(plans.is_empty() && kiosk.item_count() == 4, 1);
  transfer::public_share_object(kiosk);
  transfer::public_transfer(cap, @0xA);
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  publisher.burn();
  item_rows::destroy_for_testing(wool);
  item_rows::destroy_for_testing(hat);
  scenario.end();
}

#[test, expected_failure(abort_code = 203, location = aresrpg::item)]
fun zero_items_cannot_be_minted() {
  let mut ctx = tx_context::dummy();
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), &mut ctx);
  let _unexpected = item::mint_plain(&template, 0, &mut ctx);
  abort 999
}

#[test, expected_failure(abort_code = 202, location = aresrpg::item)]
fun gear_cannot_be_minted_as_a_stack() {
  let mut ctx = tx_context::dummy();
  let template = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), &mut ctx);
  let _unexpected = item::mint_plain(&template, 2, &mut ctx);
  abort 999
}

#[test, expected_failure(abort_code = 207, location = aresrpg::item)]
fun a_ranged_template_cannot_skip_its_stat_roll() {
  let mut ctx = tx_context::dummy();
  let admin = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let mut template = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), &mut ctx);
  item_rows::set_stats(&admin, &mut root, &mut template, item_stats::zero(), item_stats::zero(), &ctx);
  let _unexpected = item::mint_plain(&template, 1, &mut ctx);
  abort 999
}

fun invalid_split(category: vector<u8>, amount: u32) {
  let mut ctx = tx_context::dummy();
  let template = item_rows::template_for_testing(b"split".to_string(), category.to_string(), &mut ctx);
  let mut held = item::mint_plain(&template, 1, &mut ctx);
  let _unexpected = held.split(amount, &mut ctx);
  abort 999
}

#[test, expected_failure(abort_code = 202, location = aresrpg::item)]
fun gear_cannot_be_split() { invalid_split(b"hat", 1); }

#[test, expected_failure(abort_code = 203, location = aresrpg::item)]
fun a_split_cannot_create_zero_quantity() { invalid_split(b"resource", 0); }

#[test, expected_failure(abort_code = 203, location = aresrpg::item)]
fun a_split_cannot_empty_the_original_stack() { invalid_split(b"resource", 1); }

#[test, expected_failure(abort_code = 204, location = aresrpg::item)]
fun stacks_from_different_templates_cannot_merge() {
  let mut ctx = tx_context::dummy();
  let a = item_rows::template_for_testing(b"a".to_string(), b"resource".to_string(), &mut ctx);
  let b = item_rows::template_for_testing(b"b".to_string(), b"resource".to_string(), &mut ctx);
  let mut first = item::mint_plain(&a, 1, &mut ctx);
  first.merge(item::mint_plain(&b, 1, &mut ctx));
  abort 999
}

#[test, expected_failure(abort_code = 202, location = aresrpg::item)]
fun nonstackable_objects_cannot_merge() {
  let mut ctx = tx_context::dummy();
  let template = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), &mut ctx);
  let mut first = item::mint_plain(&template, 1, &mut ctx);
  first.merge(item::mint_plain(&template, 1, &mut ctx));
  abort 999
}

fun invalid_burn(amount: u32) {
  let mut scenario = test_scenario::begin(@0xA);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let held = item::mint_plain(&template, 1, scenario.ctx());
  let id = object::id(&held);
  kiosk.place(&cap, held);
  item::burn(&mut kiosk, &cap, &protected, id, amount, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 203, location = aresrpg::item)]
fun a_zero_burn_is_not_a_valid_action() { invalid_burn(0); }

#[test, expected_failure(abort_code = 203, location = aresrpg::item)]
fun burning_cannot_exceed_held_quantity() { invalid_burn(2); }
