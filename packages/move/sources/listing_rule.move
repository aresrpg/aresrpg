// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Marketplace rule: the purchased stack is NON-ZERO (no ghost listings), with a substitution
/// guard. Own file per the legacy shape; witness law puts `add`/`prove` here.
module aresrpg::listing_rule;

use aresrpg::{item::Item, version::Version};
use kiosk::personal_kiosk;
use sui::{event, kiosk::Kiosk};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const EListingZeroAmount: u64 = 801; // prove: ghost stack (amount 0)
const EListingWrongItem: u64 = 802; // prove: the proven item is not the one being purchased

const EWrongSellerKiosk: u64 = 803;

public struct SellerProved has copy, drop { kiosk: ID, owner: address }

public struct ListingRule has drop {}
public struct ListingConfig has drop, store {}

/// Seeding: attach to the item policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(ListingRule {}, policy, cap, ListingConfig {});
}

/// Buyer: prove the purchased stack carries at least one unit.
public fun prove(purchased: &Item, request: &mut TransferRequest<Item>, version: &Version, seller: &Kiosk) {
  version.assert_latest();
  prove_seller(request, seller);
  assert!(object::id(purchased) == transfer_policy::item(request), EListingWrongItem);
  assert!(purchased.amount() > 0, EListingZeroAmount);
  transfer_policy::add_receipt(ListingRule {}, request);
}

/// A read-only marker may be absent from historical checkpoint object sets. This witness
/// carries its immutable owner; purchase events remain the sole source of sale amounts.
public(package) fun prove_seller<T>(request: &TransferRequest<T>, seller: &Kiosk) {
  assert!(object::id(seller) == transfer_policy::from(request), EWrongSellerKiosk);
  event::emit(SellerProved { kiosk: object::id(seller), owner: personal_kiosk::owner(seller) });
}
