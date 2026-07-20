/// ADMIN — the engine package's authority: one SUPER AdminCap (epoch-scoped temp caps), Version enable/bump.
/// No authoring doors — the engine carries NO content (content lives in the core package's templates).
module aresrpg_social::admin;

use aresrpg_social::version::Version;
use sui::tx_context::sender;

const EAdminCapExpired: u64 = 101; // a temp cap was used after its epoch
const ESuperAdmin: u64 = 102; // delete_admin_cap: the super cap cannot be destroyed
const ENotSuperAdmin: u64 = 103; // mint_temp_admin_cap: only the super cap may mint temp caps

public struct AdminCap has key, store {
  id: UID,
  epoch: Option<u64>,
}

fun init(ctx: &mut TxContext) {
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: option::none() }, sender(ctx));
}

public fun mint_temp_admin_cap(super: &AdminCap, recipient: address, ctx: &mut TxContext) {
  assert!(super.epoch.is_none(), ENotSuperAdmin);
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: option::some(ctx.epoch()) }, recipient);
}

entry fun delete_admin_cap(cap: AdminCap) {
  assert!(cap.epoch.is_some(), ESuperAdmin);
  let AdminCap { id, epoch: _ } = cap;
  object::delete(id);
}

public(package) fun verify(cap: &AdminCap, ctx: &TxContext) {
  if (cap.epoch.is_some()) {
    assert!(*cap.epoch.borrow() == ctx.epoch(), EAdminCapExpired);
  };
}

public fun admin_set_enabled(cap: &AdminCap, version: &mut Version, enabled: bool, ctx: &TxContext) {
  cap.verify(ctx);
  version.set_enabled(enabled);
}

public fun admin_bump_version(cap: &AdminCap, version: &mut Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.bump();
}

/// One-time Party brand configuration. SUPER-only because changing which nominal type counts as a Character
/// is deployment authority, not an epoch-scoped tuning operation. The pin lives as a Version dynamic field, so
/// this upgrade adds no field to the frozen Version layout.
public fun admin_set_party_character_type<T>(cap: &AdminCap, version: &mut Version, ctx: &TxContext) {
  assert!(cap.epoch.is_none(), ENotSuperAdmin);
  cap.verify(ctx);
  version.set_party_character_type<T>();
}

public fun is_super(cap: &AdminCap): bool { cap.epoch.is_none() }

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
