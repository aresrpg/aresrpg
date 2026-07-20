/// Version + admin coverage: version bump/enable round-trip, the super-cap/temp-cap authority split (mint,
/// delete, epoch expiry), and is_super. Mirrors the byte-identical admin/version modules' own test pattern in
/// aresrpg::admin_tests (aresrpg package) — same shape, this package's address.
#[test_only]
module aresrpg_spells::version_admin_tests;

use aresrpg_spells::{admin::{Self, AdminCap}, version::{Self, Version}};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xD;

const EAdminCapExpired: u64 = 101;
const ESuperAdmin: u64 = 102;
const ENotSuperAdmin: u64 = 103;

fun init_all(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
}

#[test]
fun admin_bump_version_resets_to_package_version() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_bump_version(&cap, &mut ver, sc.ctx());
  assert!(version::current_version(&ver) == version::package_version());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun admin_toggles_enabled_switch_and_assert_enabled_passes_when_live() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  assert!(!version::is_enabled(&ver));
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  assert!(version::is_enabled(&ver));
  version::assert_enabled(&ver); // must not abort now that it's live
  admin::admin_set_enabled(&cap, &mut ver, false, sc.ctx());
  assert!(!version::is_enabled(&ver));
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

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
