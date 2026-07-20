/// Version + admin tests — the upgrade/enable gate and the SUPER/temp AdminCap machine. Covers the
/// enabled-switch toggle, version bump (stale → package version), super-vs-temp cap distinction, temp-cap
/// minting/expiry/deletion, and the super-cap-cannot-be-deleted guard. Runs RAW (no test_harness stand_up) —
/// these tests want the un-shared-registry version/admin state directly, not the friends registry too.
#[test_only]
module aresrpg_social::version_admin_tests;

use aresrpg_social::{admin::{Self, AdminCap}, version::{Self, Version}};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0x0A; // matches test_harness's OWNER — holds the AdminCap after init
const TEMP: address = @0xD;

// ── mirrored error values ──
const EAdminCapExpired: u64 = 101;
const ESuperAdmin: u64 = 102;
const ENotSuperAdmin: u64 = 103;
const ECharacterTypeAlreadySet: u64 = 105;

public struct TestCharacter has key, store { id: UID }
public struct OtherCharacter has key, store { id: UID }

fun init_all(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
}

// ╔════════════════ [ Version ] ═══════════════════════════════════════════════ ]

#[test]
fun admin_bump_version_resets_stale_to_package_version() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  assert!(version::current_version(&ver) != version::package_version());
  admin::admin_bump_version(&cap, &mut ver, sc.ctx());
  assert!(version::current_version(&ver) == version::package_version());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun admin_toggles_enabled_switch() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  assert!(!version::is_enabled(&ver));
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  assert!(version::is_enabled(&ver));
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun super_admin_pins_party_character_type() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_party_character_type<TestCharacter>(&cap, &mut ver, sc.ctx());
  ver.assert_party_character_type<TestCharacter>();
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = ECharacterTypeAlreadySet, location = version)]
fun party_character_type_pin_is_one_time() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_party_character_type<TestCharacter>(&cap, &mut ver, sc.ctx());
  admin::admin_set_party_character_type<OtherCharacter>(&cap, &mut ver, sc.ctx());
  abort
}

// ╔════════════════ [ Admin — super vs temp caps ] ════════════════════════════ ]

#[test]
fun super_cap_is_super_temp_is_not() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  assert!(admin::is_super(&cap));
  admin::mint_temp_admin_cap(&cap, TEMP, sc.ctx());
  sc.return_to_sender(cap);
  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  assert!(!admin::is_super(&temp));
  sc.return_to_sender(temp);
  sc.end();
}

#[test]
fun delete_temp_admin_cap_succeeds() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&cap, TEMP, sc.ctx());
  sc.return_to_sender(cap);
  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  admin::delete_admin_cap(temp);
  sc.end();
}

#[test, expected_failure(abort_code = ESuperAdmin, location = admin)]
fun delete_super_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  admin::delete_admin_cap(cap);
  abort
}

#[test, expected_failure(abort_code = ENotSuperAdmin, location = admin)]
fun temp_cannot_mint_temp() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&cap, TEMP, sc.ctx());
  sc.return_to_sender(cap);
  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&temp, @0xE, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = ENotSuperAdmin, location = admin)]
fun temp_cannot_pin_party_character_type() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&cap, TEMP, sc.ctx());
  sc.return_to_sender(cap);
  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_party_character_type<TestCharacter>(&temp, &mut ver, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = EAdminCapExpired, location = admin)]
fun temp_cap_expires_next_epoch() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&cap, TEMP, sc.ctx());
  sc.return_to_sender(cap);
  sc.next_epoch(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&temp, &mut ver, true, sc.ctx()); // EAdminCapExpired
  abort
}
