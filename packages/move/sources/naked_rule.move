// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Character-policy rule: a character changes owners NAKED (owner 2026-08-12) — worn gear is
/// the seller's property and must never ride along a sale or trade. Enforced at TRANSFER
/// RESOLUTION (public market + trade claims, one law), with a fail-fast twin at the trade
/// deposit door: without it an equipped character would pass the trade lock and then abort
/// every claim — locked forever, the exact ghost-lock the escrow exists to kill.
/// Buyer flow (same PTB as the purchase): lock into your kiosk → borrow → `prove` → confirm.
module aresrpg::naked_rule;

use aresrpg::{character::Character, equipment, version::Version};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const ENotNaked: u64 = 821; // the character still wears something — unequip first
const ENakedWrongItem: u64 = 822; // prove: the proven character is not the one being purchased

public struct NakedRule has drop {}
public struct NakedConfig has drop, store {}

/// Seeding: attach to the character policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Character>, cap: &TransferPolicyCap<Character>) {
  transfer_policy::add_rule(NakedRule {}, policy, cap, NakedConfig {});
}

/// The naked law's one home — the trade deposit door fail-fasts through it too.
public(package) fun assert_naked(chr: &Character) {
  assert!(!equipment::has_any_equipped(chr), ENotNaked);
}

/// Buyer: borrow the character just locked into YOUR kiosk and prove it carries nothing.
public fun prove(purchased: &Character, request: &mut TransferRequest<Character>, version: &Version) {
  version.assert_latest();
  assert!(object::id(purchased) == transfer_policy::item(request), ENakedWrongItem);
  assert_naked(purchased);
  transfer_policy::add_receipt(NakedRule {}, request);
}
