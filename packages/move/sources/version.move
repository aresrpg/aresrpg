// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Legacy version gate: one shared `Version`, every public-facing door asserts it. After an
/// upgrade, old code aborts until `admin_update` migrates the object — one live code path.
/// `admin_freeze` (version 0) is the emergency brake: it stops every public door at once.
module aresrpg::version;

use aresrpg::admin::AdminCap;

const PACKAGE_VERSION: u64 = 1;

const EVersionMismatch: u64 = 601;

public struct Version has key, store {
  id: UID,
  current_version: u64,
}

fun init(ctx: &mut TxContext) {
  transfer::share_object(Version { id: object::new(ctx), current_version: PACKAGE_VERSION });
}

// ╔════════════════ [ Admin ] ════════════════════════════════════════════════ ]

/// Migrate after a package upgrade — old bytecode aborts from then on.
entry fun admin_update(self: &mut Version, admin: &AdminCap, ctx: &TxContext) {
  admin.verify(ctx);
  assert!(self.current_version < PACKAGE_VERSION, EVersionMismatch);
  self.current_version = PACKAGE_VERSION;
}

/// The emergency brake: version 0 stops every public door until `admin_update`.
entry fun admin_freeze(self: &mut Version, admin: &AdminCap, ctx: &TxContext) {
  admin.verify(ctx);
  self.current_version = 0;
}

// ╔════════════════ [ Public ] ═══════════════════════════════════════════════ ]

public fun assert_latest(self: &Version) {
  assert!(self.current_version == PACKAGE_VERSION, EVersionMismatch);
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
