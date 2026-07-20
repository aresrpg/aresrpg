// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// VERSION — the upgrade single-path gate + the master ENABLED switch.
///
/// One shared `Version` object carries two things: `current_version` (bumped after every package upgrade so
/// every value gate compiled into an OLD package version aborts — one live code path) and `enabled` (the
/// master kill-switch). The package SHIPS DARK (`enabled == false`): admin authoring (templates, caps) happens
/// first, then `enabled` flips on at launch, so no mint/burn/split/merge/extend is reachable before the
/// package is fully configured.
///
/// This module is a dependency LEAF on purpose — it imports no cap type. The admin-gated mutators
/// (`admin_set_enabled` / `admin_bump_version`) live in `admin` and reach in through the `public(package)`
/// setters below. Keeping `Version` cap-free is what breaks the otherwise-inevitable admin<->version cycle
/// (Move forbids cyclic module deps).
module aresrpg_fight::version;

use sui::event;

/// Bumped IN SOURCE on every package upgrade; `admin::admin_bump_version` writes it into the shared object
/// right after `sui client upgrade`, retiring every gate on the previous package version.
const PACKAGE_VERSION: u64 = 2;

const EWrongVersion: u64 = 101; // a gate was called on an outdated package version
const ENotEnabled: u64 = 102; // a value gate was called while the package is still dark (enabled == false)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct Version has key {
  id: UID,
  current_version: u64,
  enabled: bool,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct EnabledSet has copy, drop { enabled: bool }

public struct VersionBumped has copy, drop { version: u64 }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(Version {
    id: object::new(ctx),
    current_version: PACKAGE_VERSION,
    enabled: false, // ships dark — admin flips it on at launch
  });
}

// ╔════════════════ [ Asserts ] ══════════════════════════════════════════════ ]

/// Abort unless the caller is on the latest published package version (upgrade single-path). Admin AUTHORING
/// (template create/rename/freeze, cap issue/revoke) gates on THIS only, so admin configuration can proceed while dark.
public fun assert_latest(self: &Version) {
  assert!(self.current_version == PACKAGE_VERSION, EWrongVersion);
}

/// Abort unless the package is BOTH latest AND switched on. Every VALUE gate (mint/burn/split/merge/
/// extend/remove) calls this.
public fun assert_enabled(self: &Version) {
  self.assert_latest();
  assert!(self.enabled, ENotEnabled);
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun current_version(self: &Version): u64 { self.current_version }

public fun is_enabled(self: &Version): bool { self.enabled }

public fun package_version(): u64 { PACKAGE_VERSION }

// ╔════════════════ [ Package mutators (admin-gated wrappers live in `admin`) ] ═ ]

public(package) fun bump(self: &mut Version) {
  self.current_version = PACKAGE_VERSION;
  event::emit(VersionBumped { version: PACKAGE_VERSION });
}

public(package) fun set_enabled(self: &mut Version, enabled: bool) {
  self.enabled = enabled;
  event::emit(EnabledSet { enabled });
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
/// Force the shared Version stale so `assert_latest`/`assert_enabled` abort — proves an outdated-version call
/// is rejected.
public fun test_set_stale(self: &mut Version) { self.current_version = 0; }
