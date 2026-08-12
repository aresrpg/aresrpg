// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Marketplace rule: the purchased stack is NON-ZERO (no ghost listings), with a substitution
/// guard. Own file per the legacy shape; witness law puts `add`/`prove` here.
module aresrpg::listing_rule;

use aresrpg::{item::Item, version::Version};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const EListingZeroAmount: u64 = 801; // prove: ghost stack (amount 0)
const EListingWrongItem: u64 = 802; // prove: the proven item is not the one being purchased

public struct ListingRule has drop {}
public struct ListingConfig has drop, store {}

/// Seeding: attach to the item policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(ListingRule {}, policy, cap, ListingConfig {});
}

/// Buyer: prove the purchased stack carries at least one unit.
public fun prove(purchased: &Item, request: &mut TransferRequest<Item>, version: &Version) {
  version.assert_latest();
  assert!(object::id(purchased) == transfer_policy::item(request), EListingWrongItem);
  assert!(purchased.amount() > 0, EListingZeroAmount);
  transfer_policy::add_receipt(ListingRule {}, request);
}
