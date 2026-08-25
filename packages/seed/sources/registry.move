// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE CONTENT DOOR CONTRACT — every domain door in this package follows ONE shape:
///
///   public fun add|overwrite(cap: &AdminCap, root: &mut Registry, …payload, ctx) {
///     1. per-domain validation — the SAME asserts seeding always ran (math constructors
///        validate their own payloads; cross-object invariants assert here)
///     2. write the typed object / dynamic-field row
///     3. registry::bump(cap, root, domain, key, ctx)
///   }
///
/// `bump` is the one choke point: cap verify + the freeze assert + the revision + the event.
/// A door that skips it is a review reject; nothing outside this package writes content.
/// Core reads content as DATA (dumb accessors only — Sui pins a dependent's code version).
module aresrpg_seed::registry;

use aresrpg_control::admin::AdminCap;
use std::string::String;
use sui::event;

const EFrozen: u64 = 4101;

/// The ONE root: every derived content address anchors here, and the two facts of the
/// living-content era live here — the write ordinal and the endgame freeze.
public struct Registry has key {
  id: UID,
  revision: u64,
  frozen: bool,
}

/// The single content event: the audit trail, and the skew witness for the indexer and the
/// replay twin. `revision` is the total order of every content write since genesis.
public struct ContentWritten has copy, drop { domain: String, key: String, revision: u64 }

fun init(ctx: &mut TxContext) {
  transfer::share_object(Registry { id: object::new(ctx), revision: 0, frozen: false });
}

/// Every content write's last act. Aborts forever once the game is frozen.
public fun bump(cap: &AdminCap, root: &mut Registry, domain: String, key: String, ctx: &TxContext) {
  cap.verify(ctx);
  assert!(!root.frozen, EFrozen);
  root.revision = root.revision + 1;
  event::emit(ContentWritten { domain, key, revision: root.revision });
}

/// The derivation door — domain modules AND core's supply doors derive their objects under
/// the root through here, so the freeze closes every mint in the game with one flag.
/// Returns the root's UID instead of a claimed UID because Sui's freshness verifier demands
/// `derived_object::claim(...)` DIRECTLY at the construction site — callers write
/// `id: derived_object::claim(registry::uid_mut(cap, root, ctx), Key())`.
public fun uid_mut(cap: &AdminCap, root: &mut Registry, ctx: &TxContext): &mut UID {
  cap.verify(ctx);
  assert!(!root.frozen, EFrozen);
  &mut root.id
}

/// THE ENDGAME (owner ruling 2026-08-23): pulled ONCE, after many months of testing, it
/// makes the whole game permanently immutable — every content door and every supply door
/// asserts through `bump`/`claim`, and no unsetter exists. Cold-key only: a leaked daily
/// temp cap must never be able to end the rebalance era.
public fun freeze_forever(cap: &AdminCap, root: &mut Registry) {
  cap.verify_super();
  root.frozen = true;
  event::emit(ContentWritten {
    domain: b"registry".to_string(),
    key: b"freeze_forever".to_string(),
    revision: root.revision,
  });
}

public fun is_frozen(root: &Registry): bool { root.frozen }

public fun revision(root: &Registry): u64 { root.revision }

#[test_only]
public fun registry_for_testing(ctx: &mut TxContext): Registry {
  Registry { id: object::new(ctx), revision: 0, frozen: false }
}

#[test_only]
public fun destroy_for_testing(root: Registry) {
  let Registry { id, .. } = root;
  id.delete();
}
