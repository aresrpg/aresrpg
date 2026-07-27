// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOT_RULE tests: all four legal stack lots resolve, invalid resource/rune lots abort, unique items bypass the
/// amount restriction while still resolving the policy, and the item-id binding rejects receipt substitution.
#[test_only]
module aresrpg::lot_rule_tests;

use aresrpg::{item::{Self, Item}, lot_rule};
use std::{string::String, unit_test::{assert_eq, destroy}};
use sui::{
  test_scenario::{Self as ts},
  transfer_policy
};

const OWNER: address = @0xA;
const DUMMY_KIOSK: address = @0xCAFE;

const EInvalidLot: u64 = 101;
const EWrongItem: u64 = 102;

/// Build one isolated policy + item, then drive the sole prove/confirm seam used by every case below.
fun prove_and_confirm(category: String, amount: u64, wrong_item: bool) {
  let mut sc = ts::begin(OWNER);
  let stackable = item::is_stackable_category(category);
  let template = item::new_template(
    b"Lot Test Item".to_string(),
    b"".to_string(),
    b"lot_test_item".to_string(),
    category,
    1,
    sc.ctx(),
  );
  let item = if (stackable) {
    item::mint_stack_for_testing(&template, amount, sc.ctx())
  } else {
    item::mint_for_testing(&template, sc.ctx())
  };
  let item_id = object::id(&item);
  let request_item = if (wrong_item) object::id_from_address(@0xDEAD) else item_id;
  let (mut policy, cap) = transfer_policy::new_for_testing<Item>(sc.ctx());
  lot_rule::add(&mut policy, &cap);
  let mut request = transfer_policy::new_request<Item>(
    request_item,
    0,
    object::id_from_address(DUMMY_KIOSK),
  );

  lot_rule::prove(&item, &mut request);
  let (confirmed_item, _paid, _from) = transfer_policy::confirm_request(&policy, request);
  assert_eq!(confirmed_item, item_id);

  destroy(item);
  destroy(template);
  destroy(policy);
  destroy(cap);
  sc.end();
}

#[test]
fun resource_lot_1_resolves() { prove_and_confirm(b"resource".to_string(), 1, false) }

#[test]
fun resource_lot_10_resolves() { prove_and_confirm(b"resource".to_string(), 10, false) }

#[test]
fun resource_lot_100_resolves() { prove_and_confirm(b"resource".to_string(), 100, false) }

#[test]
fun resource_lot_1000_resolves() { prove_and_confirm(b"resource".to_string(), 1000, false) }

#[test, expected_failure(abort_code = EInvalidLot, location = aresrpg::lot_rule)]
fun resource_lot_2_aborts() { prove_and_confirm(b"resource".to_string(), 2, false) }

#[test, expected_failure(abort_code = EInvalidLot, location = aresrpg::lot_rule)]
fun resource_lot_1001_aborts() { prove_and_confirm(b"resource".to_string(), 1001, false) }

#[test, expected_failure(abort_code = EInvalidLot, location = aresrpg::lot_rule)]
fun rune_lot_7_aborts() { prove_and_confirm(b"rune".to_string(), 7, false) }

#[test]
fun unique_ring_resolves_without_stack_lot_enforcement() {
  prove_and_confirm(b"ring".to_string(), 1, false)
}

#[test, expected_failure(abort_code = EWrongItem, location = aresrpg::lot_rule)]
fun wrong_item_substitution_aborts() { prove_and_confirm(b"resource".to_string(), 10, true) }
