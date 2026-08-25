// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The ONE application admin capability shared by every AresRPG package. Epoch zero is
/// the cold super capability; later epochs are short-lived working copies minted by it.
module aresrpg_control::admin;

const EAdminCapExpired: u64 = 4001;
const ESuperAdmin: u64 = 4002;
const EGenesisEpoch: u64 = 4003;

public struct AdminCap has key, store {
  id: UID,
  epoch: u64,
}

fun init(ctx: &mut TxContext) {
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: 0 }, ctx.sender());
}

public fun mint_temp_admin_cap(self: &AdminCap, recipient: address, ctx: &mut TxContext) {
  assert!(self.is_super(), ESuperAdmin);
  assert!(ctx.epoch() > 0, EGenesisEpoch);
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: ctx.epoch() }, recipient);
}

entry fun delete_admin_cap(self: AdminCap) {
  assert!(!self.is_super(), ESuperAdmin);
  let AdminCap { id, .. } = self;
  id.delete();
}

public fun verify(self: &AdminCap, ctx: &TxContext) {
  if (!self.is_super()) assert!(self.epoch == ctx.epoch(), EAdminCapExpired);
}

public fun verify_super(self: &AdminCap) {
  assert!(self.is_super(), ESuperAdmin);
}

fun is_super(self: &AdminCap): bool { self.epoch == 0 }

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun cap_for_testing(ctx: &mut TxContext): AdminCap {
  AdminCap { id: object::new(ctx), epoch: 0 }
}

#[test_only]
public fun destroy_for_testing(cap: AdminCap) {
  let AdminCap { id, .. } = cap;
  id.delete();
}
