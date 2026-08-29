// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The game's one royalty-safe exit from any kiosk (legacy port). A shared object wraps an
/// EMPTY TransferPolicy with its cap sealed inside forever — no rules can ever be added, and
/// nobody can ever touch the cap. `extract_from_kiosk` lists at 0, buys with a zero coin, and
/// confirms against the ruleless policy. PACKAGE-PRIVATE: only game acts (equip, unequip,
/// delete, fight custody) can use the bypass — players and marketplaces face the real rules.
module aresrpg::protected_policy;

use sui::{
  coin,
  kiosk::{Kiosk, KioskOwnerCap},
  package::Publisher,
  sui::SUI,
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap},
};

/// The bypass: an empty policy + its cap, sealed. Shared so every game door can reach it.
public struct AresRPG_TransferPolicy<phantom T> has key, store {
  id: UID,
  transfer_policy: TransferPolicy<T>,
  policy_cap: TransferPolicyCap<T>,
}

/// Seeding, once per type (the framework verifies the Publisher matches T's package).
public fun mint_and_share<T>(publisher: &Publisher, ctx: &mut TxContext) {
  let (transfer_policy, policy_cap) = transfer_policy::new<T>(publisher, ctx);
  transfer::share_object(AresRPG_TransferPolicy { id: object::new(ctx), transfer_policy, policy_cap });
}

/// Pull a locked object out of a kiosk, royalty-safe by construction (zero-price self-purchase
/// against the ruleless policy). The kiosk owner's cap proves consent.
public(package) fun extract_from_kiosk<T: key + store>(
  self: &AresRPG_TransferPolicy<T>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_id: ID,
  ctx: &mut TxContext,
): T {
  kiosk.set_owner(cap, ctx);
  kiosk.list<T>(cap, item_id, 0);
  let (object, request) = kiosk.purchase<T>(item_id, coin::zero<SUI>(ctx));
  let (_item, _paid, _from) = self.transfer_policy.confirm_request(request);
  object
}

#[test_only]
public fun for_testing<T>(publisher: &Publisher, ctx: &mut TxContext): AresRPG_TransferPolicy<T> {
  let (transfer_policy, policy_cap) = transfer_policy::new<T>(publisher, ctx);
  AresRPG_TransferPolicy { id: object::new(ctx), transfer_policy, policy_cap }
}

#[test_only]
public fun destroy_for_testing<T>(policy: AresRPG_TransferPolicy<T>, ctx: &mut TxContext) {
  let AresRPG_TransferPolicy { id, transfer_policy, policy_cap } = policy;
  id.delete();
  transfer_policy::destroy_and_withdraw(transfer_policy, policy_cap, ctx).into_balance().destroy_zero();
}
