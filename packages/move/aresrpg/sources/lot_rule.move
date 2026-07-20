// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOT_RULE — the native-kiosk lot-size gate for `Item` secondary purchases.
///
/// The game has one universal `TransferPolicy<Item>`, so every purchase proves this rule. Stackability remains
/// single-homed in `item::is_stackable_category`: consumables, resources, and runes must carry exactly one legal
/// lot size (1 / 10 / 100 / 1000), while every unique-item category passes without an amount restriction. Unique
/// items still add the receipt so the universal policy can confirm their transfer.
///
/// Enforcement occurs at purchase resolution because native `kiosk::list` has no transfer-policy hook. The item-id
/// check prevents satisfying a request with a different legal stack owned by the buyer.
module aresrpg::lot_rule;

use aresrpg::item::{Self, Item};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const EInvalidLot: u64 = 101;
const EWrongItem: u64 = 102;

/// Witness identifying the rule in a `TransferPolicy<Item>` and its purchase receipts.
public struct Rule has drop {}

/// Empty policy configuration: legal lots are immutable protocol constants in this module.
public struct Config has store, drop {}

/// Attach this rule to the universal Item policy. `transfer_policy::add_rule` rejects a duplicate attachment.
public fun add(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(Rule {}, policy, cap, Config {});
}

/// Prove that `item` is the object named by `request` and, when it is stackable, carries a legal kiosk lot.
public fun prove(item: &Item, request: &mut TransferRequest<Item>) {
  assert!(object::id(item) == transfer_policy::item(request), EWrongItem);

  if (item::is_stackable_category(item::category(item))) {
    let amount = item::amount(item);
    assert!(amount == 1 || amount == 10 || amount == 100 || amount == 1000, EInvalidLot);
  };

  transfer_policy::add_receipt(Rule {}, request);
}
