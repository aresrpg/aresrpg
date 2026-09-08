// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::loot_box_tests;

use aresrpg::{api, item, loot_box, protected_policy, version};
use aresrpg_control::admin;
use aresrpg_math::consumable_effect;
use aresrpg_seed::{item_rows, registry};
use kiosk::personal_kiosk;
use sui::{kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA;

// Exercise the production burn → persisted claim → mint path. Only setup mints free
// inventory. Negative variants must abort at the named authority or substitution guard.
fun run_claim(box_count: u32, merge: bool, substitute: bool, claimant: address) {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  loot_box::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut boxes = item_rows::template_for_testing(b"box".to_string(), b"consumable".to_string(), scenario.ctx());
  item_rows::set_effect(&admin, &mut root, &mut boxes, consumable_effect::loot_box(), scenario.ctx());
  let reward = item_rows::template_for_testing(b"fang".to_string(), b"resource".to_string(), scenario.ctx());
  let mut tables = scenario.take_shared<loot_box::LootRegistry>();
  loot_box::clear_loot_table(&admin, &mut root, &mut tables, &boxes, scenario.ctx());
  loot_box::add_loot_reward(&admin, &mut root, &mut tables, &boxes, &reward, 1, 7, scenario.ctx());
  loot_box::add_loot_reward(&admin, &mut root, &mut tables, &boxes, &reward, 3, 7, scenario.ctx());
  loot_box::assert_valid_box(&tables, &boxes);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  let mut entropy = random::new_generator_from_seed_for_testing(b"box-setup");
  let inventory = item::mint(&boxes, box_count, &mut entropy, scenario.ctx());
  let box_id = object::id(&inventory);
  item::deposit(&mut kiosk, cap, &policy, option::none(), inventory);
  let existing = if (merge) {
    let stack = item::mint(&reward, 5, &mut entropy, scenario.ctx());
    let id = object::id(&stack);
    item::deposit(&mut kiosk, cap, &policy, option::none(), stack);
    option::some(id)
  } else option::none();
  api::open_loot_box(&tables, &mut kiosk, &personal, box_id, &boxes, &protected, &randomness, &version, scenario.ctx());
  if (box_count == 1) assert!(!kiosk.has_item(box_id), 0)
  else assert!(item::amount(kiosk.borrow(cap, box_id)) == box_count - 1, 1);
  test_scenario::return_shared(tables);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());

  scenario.next_tx(claimant);
  let claim = scenario.take_from_sender<loot_box::BoxClaim>();
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let cap = personal_kiosk::borrow(&personal);
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  api::claim_loot(claim, if (substitute) &boxes else &reward, existing, &mut kiosk, &personal, &policy, &randomness, &version, scenario.ctx());
  let reward_id = if (merge) existing.destroy_some() else object::last_created(scenario.ctx());
  let minted: &item::Item = kiosk.borrow(cap, reward_id);
  assert!(minted.amount() == if (merge) 12 else 7, 2);
  assert!(minted.template() == item_rows::template_id(&reward), 6);
  if (!merge) assert!(kiosk.is_locked(reward_id), 7);
  assert!(kiosk.item_count() == if (box_count == 1) 1 else 2, 3);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  let mut tables = scenario.take_shared<loot_box::LootRegistry>();
  loot_box::clear_loot_table(&admin, &mut root, &mut tables, &boxes, scenario.ctx());
  assert!(!loot_box::has_valid_table(&tables, &boxes), 4);
  test_scenario::return_shared(tables);
  item_rows::destroy_for_testing(boxes);
  item_rows::destroy_for_testing(reward);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  scenario.next_tx(OWNER);
  assert!(!scenario.has_most_recent_for_sender<loot_box::BoxClaim>(), 5);
  scenario.end();
}

#[test]
fun whole_box_and_claim_are_consumed_for_one_new_reward() { run_claim(1, false, false, OWNER); }

#[test]
fun partial_box_burn_merges_only_the_awarded_supply() { run_claim(3, true, false, OWNER); }

#[test, expected_failure(abort_code = 2907, location = aresrpg::loot_box)]
fun claim_refuses_a_different_template() { run_claim(1, false, true, OWNER); }

#[test, expected_failure(abort_code = 3, location = sui::test_scenario)]
fun another_sender_cannot_take_the_soulbound_claim() { run_claim(1, false, false, @0xB); }

fun reject_table(category: vector<u8>, amount: u32, weight: u64) {
  let mut scenario = test_scenario::begin(OWNER);
  loot_box::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut boxes = item_rows::template_for_testing(b"box".to_string(), b"consumable".to_string(), scenario.ctx());
  item_rows::set_effect(&cap, &mut root, &mut boxes, consumable_effect::loot_box(), scenario.ctx());
  let reward = item_rows::template_for_testing(b"reward".to_string(), category.to_string(), scenario.ctx());
  let mut tables = scenario.take_shared<loot_box::LootRegistry>();
  loot_box::add_loot_reward(&cap, &mut root, &mut tables, &boxes, &reward, weight, amount, scenario.ctx());
  loot_box::assert_valid_box(&tables, &boxes);
  abort 999
}

#[test, expected_failure(abort_code = 2908, location = aresrpg::loot_box)]
fun a_reward_cannot_mint_zero_items() { reject_table(b"resource", 0, 1); }

#[test, expected_failure(abort_code = 2909, location = aresrpg::loot_box)]
fun unique_rewards_cannot_mint_a_stack() { reject_table(b"hat", 2, 1); }

#[test, expected_failure(abort_code = 2906, location = aresrpg::loot_box)]
fun a_zero_weight_pool_is_not_an_openable_box() { reject_table(b"resource", 1, 0); }

fun reject_open(effect: Option<consumable_effect::Effect>, weights: vector<u64>, wrong_item: bool) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  loot_box::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut boxes = item_rows::template_for_testing(b"box".to_string(), b"consumable".to_string(), scenario.ctx());
  if (effect.is_some()) item_rows::set_effect(&admin, &mut root, &mut boxes, *effect.borrow(), scenario.ctx());
  let reward = item_rows::template_for_testing(b"fang".to_string(), b"resource".to_string(), scenario.ctx());
  let mut tables = scenario.take_shared<loot_box::LootRegistry>();
  weights.do!(|weight| loot_box::add_loot_reward(&admin, &mut root, &mut tables, &boxes, &reward, weight, 1, scenario.ctx()));
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"refused-open");
  let inventory = item::mint(if (wrong_item) &reward else &boxes, 1, &mut entropy, scenario.ctx());
  let id = object::id(&inventory);
  kiosk.place(&cap, inventory);
  loot_box::open_box(&tables, &mut kiosk, &cap, id, &boxes, &protected, &mut entropy, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 2905, location = aresrpg::loot_box)]
fun a_consumable_without_an_effect_is_not_a_box() { reject_open(option::none(), vector[], false); }
#[test, expected_failure(abort_code = 2905, location = aresrpg::loot_box)]
fun a_reset_scroll_is_not_a_box() { reject_open(option::some(consumable_effect::reset_stats()), vector[], false); }
#[test, expected_failure(abort_code = 2906, location = aresrpg::loot_box)]
fun opening_requires_a_published_pool() { reject_open(option::some(consumable_effect::loot_box()), vector[], false); }
#[test, expected_failure(abort_code = 2904, location = aresrpg::loot_box)]
fun opening_refuses_a_zero_weight_pool_before_burning() { reject_open(option::some(consumable_effect::loot_box()), vector[0], false); }
#[test, expected_failure(abort_code = 2905, location = aresrpg::loot_box)]
fun a_box_template_cannot_authorize_burning_an_unrelated_item() { reject_open(option::some(consumable_effect::loot_box()), vector[1], true); }

fun reject_non_box(add_row: bool) {
  let mut scenario = test_scenario::begin(OWNER);
  loot_box::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let item = item_rows::template_for_testing(b"fang".to_string(), b"resource".to_string(), scenario.ctx());
  let mut tables = scenario.take_shared<loot_box::LootRegistry>();
  if (add_row) loot_box::add_loot_reward(&cap, &mut root, &mut tables, &item, &item, 1, 1, scenario.ctx())
  else loot_box::assert_valid_box(&tables, &item);
  abort 999
}
#[test, expected_failure(abort_code = 2905, location = aresrpg::loot_box)]
fun a_loot_table_cannot_turn_an_ordinary_item_into_a_box() { reject_non_box(true); }
#[test, expected_failure(abort_code = 2905, location = aresrpg::loot_box)]
fun box_validation_refuses_an_ordinary_item() { reject_non_box(false); }
