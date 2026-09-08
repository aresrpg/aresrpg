// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::best_effort_stacks_tests;

use aresrpg::item::{Self, Item};
use aresrpg_seed::item_rows;
use sui::{kiosk, package::Publisher, test_scenario, transfer_policy};

#[test]
fun deposits_accept_missing_full_listed_and_incompatible_hints() {
  let mut scenario = test_scenario::begin(@0xA);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let other = item_rows::template_for_testing(b"wood".to_string(), b"resource".to_string(), scenario.ctx());
  let missing = item::mint_plain(&template, 1, scenario.ctx());
  let missing_id = object::id(&missing);
  item::deposit(&mut kiosk, &cap, &policy, option::some(object::id_from_address(@0x99)), missing);
  assert!(kiosk.has_item(missing_id));

  let full = item::mint_plain(&template, 0xffff_ffff, scenario.ctx());
  let full_id = object::id(&full);
  kiosk.lock(&cap, &policy, full);
  let overflow = item::mint_plain(&template, 1, scenario.ctx());
  let overflow_id = object::id(&overflow);
  item::deposit(&mut kiosk, &cap, &policy, option::some(full_id), overflow);
  assert!(kiosk.borrow<Item>(&cap, full_id).amount() == 0xffff_ffff);
  assert!(kiosk.has_item(overflow_id));

  kiosk.list<Item>(&cap, missing_id, 100);
  let listed = item::mint_plain(&template, 1, scenario.ctx());
  let listed_id = object::id(&listed);
  item::deposit(&mut kiosk, &cap, &policy, option::some(missing_id), listed);
  assert!(kiosk.has_item(listed_id));
  assert!(kiosk.borrow<Item>(&cap, missing_id).amount() == 1);

  let wrong = item::mint_plain(&other, 1, scenario.ctx());
  let wrong_id = object::id(&wrong);
  item::deposit(&mut kiosk, &cap, &policy, option::some(listed_id), wrong);
  assert!(kiosk.has_item(wrong_id));
  assert!(kiosk.borrow<Item>(&cap, listed_id).amount() == 1);

  let merged = item::mint_plain(&template, 2, scenario.ctx());
  let merged_id = object::id(&merged);
  item::deposit(&mut kiosk, &cap, &policy, option::some(listed_id), merged);
  assert!(!kiosk.has_item(merged_id));
  assert!(kiosk.borrow<Item>(&cap, listed_id).amount() == 3);
  transfer::public_share_object(kiosk);
  transfer::public_transfer(cap, @0xA);
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, @0xA);
  publisher.burn();
  item_rows::destroy_for_testing(template);
  item_rows::destroy_for_testing(other);
  scenario.end();
}

#[test, expected_failure(abort_code = 0, location = sui::kiosk)]
fun fallback_deposit_still_requires_the_owning_kiosk_cap() {
  let mut scenario = test_scenario::begin(@0xA);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, _policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let (mut kiosk, _cap) = kiosk::new(scenario.ctx());
  let (_other, wrong_cap) = kiosk::new(scenario.ctx());
  let template = item_rows::template_for_testing(b"wool".to_string(), b"resource".to_string(), scenario.ctx());
  let minted = item::mint_plain(&template, 1, scenario.ctx());
  item::deposit(&mut kiosk, &wrong_cap, &policy, option::none(), minted);
  abort 999
}
