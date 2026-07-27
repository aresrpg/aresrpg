// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ITEM-LISTING-RULE tests: the amount-0 sale block (`item_listing_rule`) — the OBJECT-leg half of the
/// royalty-bypass fix: a "ghost" stack (amount 0) can be listed but NO SALE CAN COMPLETE, so
/// ghosts stay bound to their owner and can never launder value between kiosks. Drives the REAL transfer-policy
/// rule against a hand-built `TransferRequest<Item>`: a real stack (amount >= 1) proves + confirms, an amount-0
/// ghost is refused (`EZeroAmount`), and the evasion guard rejects a buyer who proves a DIFFERENT non-zero stack
/// than the ghost being purchased (`EWrongItem`).
#[test_only]
module aresrpg::item_listing_tests;

use aresrpg::{admin::{Self, AdminCap}, catalog::{Self, Catalog}, item::{Self, Item, ItemTemplate}, item_listing_rule, lot_rule, version::{Self, Version}};
use std::unit_test::{assert_eq, destroy};
use sui::{
  package::Publisher,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap}
};

const OWNER: address = @0xA;
const DUMMY_KIOSK: address = @0xCAFE; // a stand-in `from` kiosk id for the request

// ── mirrored error consts (the `location` in #[expected_failure] disambiguates the aborting module) ──
const EZeroAmount: u64 = 101; // item_listing_rule
const EWrongItem: u64 = 102; // item_listing_rule

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot items ENABLED, whitelist "resource", author ONE stackable template, create the marketplace item policy, and
/// ATTACH the amount-0 and forced-lot rules (the ceremony `add` calls). Returns the template id;
/// the policy is shared, the policy cap goes to OWNER.
fun boot(sc: &mut Scenario): ID {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::admin_set_enabled(&acap, &mut ver, true, sc.ctx());
  admin::add_category(&acap, &mut cat, b"resource".to_string(), &ver, sc.ctx());
  let tid = admin::create_template(&acap, &cat, b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
  ts::return_shared(cat);

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (mut policy, cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  item_listing_rule::add(&mut policy, &cap); // ceremony: z503 the zero-amount gate
  lot_rule::add(&mut policy, &cap); // universal Item policy also carries the forced-lot gate
  transfer::public_share_object(policy);
  transfer::public_transfer(cap, OWNER);
  transfer::public_transfer(publisher, OWNER);
  ts::return_shared(ver);
  sc.return_to_sender(acap);
  tid
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[test]
/// A real stack (amount >= 1) proves and the framework `confirm_request` completes — ordinary item resale is
/// unaffected by the ghost gate.
fun nonzero_stack_proves_and_confirms() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let item = item::mint_stack_for_testing(&tmpl, 10, sc.ctx()); // legal lot amount 10
  let iid = object::id(&item);
  let mut req = transfer_policy::new_request<Item>(iid, 0, object::id_from_address(DUMMY_KIOSK));
  item_listing_rule::prove_amount(&item, &mut req); // 10 > 0 → receipt added
  lot_rule::prove(&item, &mut req); // 10 is a legal stack lot
  let (i, _p, _f) = transfer_policy::confirm_request(&policy, req); // 2 receipts == 2 rules → OK
  assert_eq!(i, iid);
  destroy(item);
  ts::return_shared(tmpl); ts::return_shared(policy);
  sc.end();
}

#[test, expected_failure(abort_code = EZeroAmount, location = aresrpg::item_listing_rule)]
/// The ghost dodge is blocked: an amount-0 instance can never complete a sale — `prove_amount` aborts EZeroAmount,
/// so the buyer can never satisfy the receipt and `confirm_request` is unreachable.
fun zero_amount_ghost_sale_refused() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let ghost = item::mint_zero_stack_for_testing(&tmpl, sc.ctx()); // amount 0
  let iid = object::id(&ghost);
  let mut req = transfer_policy::new_request<Item>(iid, 0, object::id_from_address(DUMMY_KIOSK));
  item_listing_rule::prove_amount(&ghost, &mut req); // ABORTS: amount 0
  lot_rule::prove(&ghost, &mut req); // unreachable — every Item confirm site still wires the universal lot receipt
  let (_i, _p, _f) = transfer_policy::confirm_request(&policy, req); // unreachable — type-check only
  destroy(ghost);
  ts::return_shared(tmpl); ts::return_shared(policy);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongItem, location = aresrpg::item_listing_rule)]
/// Evasion guard: a buyer purchasing an amount-0 ghost cannot satisfy the receipt by proving a DIFFERENT non-zero
/// stack they own — the request's item id differs from the proven item → aborts EWrongItem.
fun wrong_item_substitution_refused() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let real = item::mint_stack_for_testing(&tmpl, 5, sc.ctx()); // a non-zero stack the buyer owns
  let bogus = object::id_from_address(@0xDEAD); // the item being PURCHASED is a different (ghost) instance
  let mut req = transfer_policy::new_request<Item>(bogus, 0, object::id_from_address(DUMMY_KIOSK));
  item_listing_rule::prove_amount(&real, &mut req); // ABORTS: id(real) != bogus
  lot_rule::prove(&real, &mut req); // unreachable — every Item confirm site still wires the universal lot receipt
  let (_i, _p, _f) = transfer_policy::confirm_request(&policy, req); // unreachable — type-check only
  destroy(real);
  ts::return_shared(tmpl); ts::return_shared(policy);
  sc.end();
}
