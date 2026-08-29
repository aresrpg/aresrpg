// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Marketplace rule: a STACKABLE item trades only in whole lots (1/10/100/1000). Own file per
/// the legacy shape (move-old merged it into item.move only under the size ceiling).
/// The witness law puts `add`/`prove` here: only the defining module can construct `LotRule`.
module aresrpg::lot_rule;

use aresrpg_math::content_rules;

use aresrpg::{item::{Self, Item}, version::Version};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

const ELotInvalid: u64 = 701; // prove: a stackable trades only in lots of 1/10/100/1000
const ELotWrongItem: u64 = 702; // prove: the proven item is not the one being purchased

public struct LotRule has drop {}
public struct LotConfig has drop, store {}

/// Seeding: attach to the item policy (cap-gated by the framework).
public fun add(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(LotRule {}, policy, cap, LotConfig {});
}

/// Buyer: paid marketplace sales use the four visible lots. A zero-price PurchaseCap is a
/// private escrow transfer and may carry the exact stack amount both parties reviewed.
public fun prove(purchased: &Item, request: &mut TransferRequest<Item>, version: &Version) {
  version.assert_latest();
  assert!(object::id(purchased) == transfer_policy::item(request), ELotWrongItem);
  let category = purchased.category();
  if (content_rules::is_stackable(&category)) {
    let amount = purchased.amount();
    assert!(valid_lot(amount, transfer_policy::paid(request)), ELotInvalid);
  };
  transfer_policy::add_receipt(LotRule {}, request);
}

fun valid_lot(amount: u32, paid: u64): bool {
  paid == 0 || amount == 1 || amount == 10 || amount == 100 || amount == 1000
}

#[test_only]
public(package) fun valid_lot_for_testing(amount: u32, paid: u64): bool { valid_lot(amount, paid) }
