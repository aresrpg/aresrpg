// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::distribution_tests;

use aresrpg::{distribution, item, pet};
use aresrpg_control::admin;
use aresrpg_math::item_stats;
use aresrpg_seed::{item_rows, registry};
use sui::{kiosk, package::Publisher, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;
const RECIPIENT: address = @0xB0B;

#[test]
fun airdrop_and_giftcard_share_one_stack() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);

  let publisher = scenario.take_from_sender<Publisher>();
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = item_rows::template_for_testing(
    b"distribution_resource".to_string(), b"resource".to_string(), scenario.ctx(),
  );
  let mut pet_template = item_rows::template_for_testing(
    b"distribution_pet".to_string(), b"pet".to_string(), scenario.ctx(),
  );
  let center = item_stats::shift();
  let endpoint = item_stats::new(
    center, center, center, center, center + 60, center, center, center,
    center, center, center, center, center, center, center,
  );
  item_rows::set_stats(
    &cap, &mut root, &mut pet_template, endpoint, endpoint, scenario.ctx(),
  );
  let pet = item::mint_distribution(&pet_template, 1, scenario.ctx());
  assert!(pet.has_stats(), 1);
  assert!(pet.stats() == endpoint, 2);
  assert!(pet::scaled_stats(&pet) == item_stats::zero(), 3);
  item::destroy_for_testing(pet);
  item_rows::destroy_for_testing(pet_template);
  distribution::new_airdrop(
    &cap, &mut root, b"launch".to_string(), &template, 3, vector[OWNER], scenario.ctx(),
  );
  let card = distribution::new_giftcard(
    &cap, &mut root, b"welcome".to_string(), &template, 4, scenario.ctx(),
  );
  let seeded_card_id = object::id(&card);
  transfer::public_transfer(publisher, RECIPIENT);
  transfer::public_transfer(item_policy, RECIPIENT);
  transfer::public_transfer(item_policy_cap, RECIPIENT);
  transfer::public_transfer(kiosk, RECIPIENT);
  transfer::public_transfer(kiosk_cap, RECIPIENT);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  item_rows::share_item(template);
  transfer::public_transfer(card, RECIPIENT);

  scenario.next_tx(OWNER);
  let template = scenario.take_shared<item_rows::ItemTemplate>();
  let mut drop = scenario.take_shared<distribution::Airdrop>();
  distribution::claim_airdrop(&mut drop, &template, RECIPIENT, scenario.ctx());
  test_scenario::return_shared(template);
  test_scenario::return_shared(drop);

  scenario.next_tx(RECIPIENT);
  let publisher = scenario.take_from_sender<Publisher>();
  let item_policy = scenario.take_from_sender<transfer_policy::TransferPolicy<item::Item>>();
  let item_policy_cap = scenario.take_from_sender<transfer_policy::TransferPolicyCap<item::Item>>();
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let kiosk_cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let template = scenario.take_shared<item_rows::ItemTemplate>();
  let airdrop_card_id = test_scenario::most_recent_id_for_sender<distribution::Giftcard>(&scenario).destroy_some();
  let card = scenario.take_from_sender_by_id<distribution::Giftcard>(seeded_card_id);
  let airdrop_card = scenario.take_from_sender_by_id<distribution::Giftcard>(airdrop_card_id);
  let drop = scenario.take_shared<distribution::Airdrop>();
  let target = item::mint_plain(&template, 1, scenario.ctx());
  let target_id = object::id(&target);
  kiosk.place(&kiosk_cap, target);

  distribution::redeem_giftcard(
    card, &template, option::some(target_id), &mut kiosk, &kiosk_cap, &item_policy,
    scenario.ctx(),
  );
  distribution::redeem_giftcard(
    airdrop_card, &template, option::some(target_id), &mut kiosk, &kiosk_cap, &item_policy,
    scenario.ctx(),
  );
  assert!(item::amount(kiosk.borrow(&kiosk_cap, target_id)) == 8, 0);

  let item = kiosk.take<item::Item>(&kiosk_cap, target_id);
  item::destroy_for_testing(item);
  kiosk::close_and_withdraw(kiosk, kiosk_cap, scenario.ctx()).into_balance().destroy_zero();
  transfer_policy::destroy_and_withdraw(item_policy, item_policy_cap, scenario.ctx()).into_balance().destroy_zero();
  publisher.burn();
  test_scenario::return_shared(template);
  test_scenario::return_shared(drop);
  scenario.end();
}

#[test, expected_failure(abort_code = 202, location = aresrpg::item)]
fun airdrop_rejects_multiple_nonstackable_items_at_authoring() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = item_rows::template_for_testing(
    b"distribution_hat".to_string(), b"hat".to_string(), scenario.ctx(),
  );
  distribution::new_airdrop(
    &cap, &mut root, b"bad_hat_drop".to_string(), &template, 2, vector[OWNER], scenario.ctx(),
  );
  abort 0
}

#[test, expected_failure(abort_code = 202, location = aresrpg::item)]
fun giftcard_rejects_multiple_pets_at_authoring() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut template = item_rows::template_for_testing(
    b"distribution_pet".to_string(), b"pet".to_string(), scenario.ctx(),
  );
  let endpoint = fixed_pet_endpoint();
  item_rows::set_stats(&cap, &mut root, &mut template, endpoint, endpoint, scenario.ctx());
  let card = distribution::new_giftcard(
    &cap, &mut root, b"bad_pet_card".to_string(), &template, 2, scenario.ctx(),
  );
  transfer::public_transfer(card, OWNER);
  abort 0
}

#[test, expected_failure(abort_code = 208, location = aresrpg::item)]
fun giftcard_rejects_pet_without_endpoint_at_authoring() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = item_rows::template_for_testing(
    b"distribution_pet".to_string(), b"pet".to_string(), scenario.ctx(),
  );
  let card = distribution::new_giftcard(
    &cap, &mut root, b"bad_pet_card".to_string(), &template, 1, scenario.ctx(),
  );
  transfer::public_transfer(card, OWNER);
  abort 0
}

#[test, expected_failure(abort_code = 208, location = aresrpg::item)]
fun airdrop_rejects_ranged_pet_endpoint_at_authoring() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut template = item_rows::template_for_testing(
    b"distribution_pet".to_string(), b"pet".to_string(), scenario.ctx(),
  );
  let min = fixed_pet_endpoint();
  let max = item_stats::new(
    item_stats::shift(), item_stats::shift(), item_stats::shift(), item_stats::shift(),
    item_stats::shift() + 120, item_stats::shift(), item_stats::shift(), item_stats::shift(),
    item_stats::shift(), item_stats::shift(), item_stats::shift(), item_stats::shift(),
    item_stats::shift(), item_stats::shift(), item_stats::shift(),
  );
  item_rows::set_stats(&cap, &mut root, &mut template, min, max, scenario.ctx());
  distribution::new_airdrop(
    &cap, &mut root, b"bad_pet_drop".to_string(), &template, 1, vector[OWNER], scenario.ctx(),
  );
  abort 0
}

fun fixed_pet_endpoint(): item_stats::ItemStatistics {
  let center = item_stats::shift();
  item_stats::new(
    center, center, center, center, center + 60, center, center, center,
    center, center, center, center, center, center, center,
  )
}
