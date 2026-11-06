// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Character-policy rule: characters change owners with no equipped gear.
/// Applies to paid sales and zero-price exclusive transfers at policy resolution.
/// Buyer flow (same PTB as the purchase): lock into your kiosk → borrow → `prove` → confirm.
module aresrpg::naked_rule;

use aresrpg::{character::Character, equipment, listing_rule, version::Version};
use sui::kiosk::Kiosk;
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const ENotNaked: u64 = 821; // the character still wears something — unequip first
const ENakedWrongItem: u64 = 822; // prove: the proven character is not the one being purchased


public struct NakedRule has drop {}
public struct NakedConfig has drop, store {}

/// Seeding: attach to the character policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Character>, cap: &TransferPolicyCap<Character>) {
  transfer_policy::add_rule(NakedRule {}, policy, cap, NakedConfig {});
}

/// The marketplace sale law's one home.
fun assert_sellable(character: &Character) {
  assert!(!equipment::has_any_equipped(character), ENotNaked);
}

/// Buyer: borrow the character just locked into YOUR kiosk and prove it qualifies for sale.
public fun prove(purchased: &Character, request: &mut TransferRequest<Character>, version: &Version, seller: &Kiosk) {
  version.assert_latest();
  listing_rule::prove_seller(request, seller);
  assert!(object::id(purchased) == transfer_policy::item(request), ENakedWrongItem);
  assert_sellable(purchased);
  transfer_policy::add_receipt(NakedRule {}, request);
}

#[test_only]
public(package) fun assert_sellable_for_testing(character: &Character) { assert_sellable(character); }
