// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Character-policy rule: a character changes owners NAKED (owner 2026-08-12) and at level 30
/// or above (owner 2026-08-26) — worn gear is the seller's property and must never ride along
/// a sale, and a barely-played character is not a market good. Enforced at marketplace TRANSFER
/// RESOLUTION, the only path where a character changes owners.
/// Buyer flow (same PTB as the purchase): lock into your kiosk → borrow → `prove` → confirm.
module aresrpg::naked_rule;

use aresrpg::{character::Character, equipment, version::Version};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const MIN_SALE_LEVEL: u16 = 30; // below this a character cannot change owners

const ENotNaked: u64 = 821; // the character still wears something — unequip first
const ENakedWrongItem: u64 = 822; // prove: the proven character is not the one being purchased
const ELevelTooLow: u64 = 823; // the character is below the minimum sale level

public struct NakedRule has drop {}
public struct NakedConfig has drop, store {}

/// Seeding: attach to the character policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Character>, cap: &TransferPolicyCap<Character>) {
  transfer_policy::add_rule(NakedRule {}, policy, cap, NakedConfig {});
}

/// The marketplace sale law's one home.
fun assert_sellable(chr: &Character) {
  assert!(!equipment::has_any_equipped(chr), ENotNaked);
  assert!(chr.level() >= MIN_SALE_LEVEL, ELevelTooLow);
}

/// Buyer: borrow the character just locked into YOUR kiosk and prove it qualifies for sale.
public fun prove(purchased: &Character, request: &mut TransferRequest<Character>, version: &Version) {
  version.assert_latest();
  assert!(object::id(purchased) == transfer_policy::item(request), ENakedWrongItem);
  assert_sellable(purchased);
  transfer_policy::add_receipt(NakedRule {}, request);
}

#[test_only]
public(package) fun assert_sellable_for_testing(chr: &Character) { assert_sellable(chr); }
