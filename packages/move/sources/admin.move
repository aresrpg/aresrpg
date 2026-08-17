// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The admin surface: cap lifecycle, Display creation, marketplace policy creation (the seed
/// seeding lives in seed.move). Authority = the legacy AdminCap pattern: one
/// SUPER cap (epoch 0, minted at publish, indestructible) mints throwaway caps that expire at
/// the next epoch (~24h) — daily work never touches the cold key.
module aresrpg::admin;

use aresrpg::{character::{Self, Character}, item::{Self, Item}};
use sui::{display_registry::{Self, DisplayRegistry}, package::Publisher};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EAdminCapExpired: u64 = 501;
const ESuperAdmin: u64 = 502;
const EGenesisEpoch: u64 = 503; // epoch 0 IS the super sentinel — a genesis temp cap would never expire

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Admin authority. `epoch == 0` = the super cap; anything else expires when its epoch ends.
public struct AdminCap has key, store {
  id: UID,
  epoch: u64,
}

fun init(ctx: &mut TxContext) {
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: 0 }, ctx.sender());
}

// ╔════════════════ [ Cap lifecycle (legacy pattern) ] ═══════════════════════ ]

/// Mint a throwaway cap for the current epoch — dead in ~24h. Super-only. Refused during the
/// genesis epoch: `epoch == 0` is the super sentinel, so a genesis temp cap would BE super.
public fun mint_temp_admin_cap(self: &AdminCap, recipient: address, ctx: &mut TxContext) {
  assert!(self.super_admin(), ESuperAdmin);
  assert!(ctx.epoch() > 0, EGenesisEpoch);
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: ctx.epoch() }, recipient);
}

/// Clean up an expired temp cap. The super cap cannot be destroyed.
entry fun delete_admin_cap(self: AdminCap) {
  assert!(!self.super_admin(), ESuperAdmin);
  let AdminCap { id, .. } = self;
  id.delete();
}

public(package) fun verify(self: &AdminCap, ctx: &TxContext) {
  if (!self.super_admin()) {
    assert!(self.epoch == ctx.epoch(), EAdminCapExpired);
  }
}

fun super_admin(self: &AdminCap): bool { self.epoch == 0 }

// ╔════════════════ [ Display creation (seeding, once) ] ═════════════════════ ]
// The marketplace policies (protected + royalty/lock) are minted by the seeding PTB —
// protected_policy::mint_and_share + the kiosk SDK's rule installers — never from here.

public fun create_character_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Character> {
  character::new_display(registry, publisher, ctx)
}

public fun create_item_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Item> {
  item::new_display(registry, publisher, ctx)
}

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
