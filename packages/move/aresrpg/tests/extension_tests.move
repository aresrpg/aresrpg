// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Extension-gate tests (G8), post S-46: the MINT door (mints an item + forces a personal-kiosk lock; aborts
/// while dark), the namespaced DF writes (write → free read round-trip on both Item and Character), the
/// NAMESPACE ISOLATION invariant (two namespaces writing the SAME logical key coexist in distinct slots), and
/// the enabled gate on writes. S-46 deleted the ExtensionCap machinery — the namespace is a plain u8 the
/// in-package caller passes; the 4 cap-authority tests (cap-per-namespace init, scoped-mint rejection,
/// field-cap barring, fight-mint acceptance) died WITH the machinery they tested.
#[test_only]
module aresrpg::extension_tests;

use aresrpg::{admin::{Self, AdminCap}, catalog::{Self, Catalog}, character, extension, item::{Self, Item, ItemTemplate}, item_stats, version::{Self, Version}};
use kiosk::personal_kiosk;
use std::unit_test::{assert_eq, destroy};
use sui::{kiosk, package::Publisher, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const V_ENotEnabled: u64 = 102; // version

/// A module-local DF key — the SAME logical key both namespaces write, to prove isolation.
public struct TestKey has copy, drop, store {}

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// version + admin + item + catalog, optionally enabled, one authored template shared. Returns nothing; tests
/// take the shared `ItemTemplate`/`Version`.
fun setup(sc: &mut Scenario, enable: bool) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  if (enable) admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  admin::add_category(&cap, &mut cat, b"sword".to_string(), &ver, sc.ctx());
  admin::create_template(
    &cap, &cat, b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Share an item TransferPolicy (for the lock path) and return it shared for the caller to take.
fun share_item_policy(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let ver = sc.take_shared<Version>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, OWNER);
  transfer::public_transfer(publisher, OWNER);
  ts::return_shared(ver);
}

// ╔════════════════ [ Mint door ] ═════════════════════════════════════════════ ]

#[test]
/// The mint door mints an item and forces a personal-kiosk lock (the LockPledge is consumed by
/// `item::lock_in_kiosk`, which asserts personal — G9).
fun mint_door_mints_and_locks_personal() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, true);
  share_item_policy(&mut sc);

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let policy = sc.take_shared<TransferPolicy<Item>>();

  let (item, pledge) = extension::z505(&tmpl, option::none(), &ver, sc.ctx());
  let iid = object::id(&item);
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, item, &mut kiosk, personal_kiosk::borrow(&pkcap), &policy);
  assert!(kiosk.has_item(iid)); // minted then locked — never address-delivered

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(policy);
  sc.end();
}

#[test]
/// #758 — the ONE gear-mint door owns the roll, so no seam can forget it: given a seed, a RANGED template mints
/// with its `StatsKey` already attached and inside the authored band; a rangeless template mints blank (nothing to
/// roll); and a seedless call mints blank even on a ranged template (the caller has no entropy to offer, and an
/// invented one would be dry-runnable). Distinct seeds give distinct rolls — the roll is a pure function of the seed.
fun mint_door_rolls_ranged_template_from_its_seed() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, true);

  // a RANGED sibling template: vitality [100,200], every other field degenerate at 100
  sc.next_tx(OWNER);
  let ranged_tid = {
    let cap = sc.take_from_sender<AdminCap>();
    let cat = sc.take_shared<Catalog>();
    let ver = sc.take_shared<Version>();
    let tid = admin::create_template(
      &cap, &cat, b"Relic".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1,
      option::some(item_stats::new(100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100)),
      option::some(item_stats::new(200, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100)),
      vector[], option::none(), &ver, sc.ctx(),
    );
    ts::return_shared(cat); ts::return_shared(ver); sc.return_to_sender(cap);
    tid
  };

  sc.next_tx(OWNER);
  let ranged = ts::take_shared_by_id<ItemTemplate>(&sc, ranged_tid);
  let plain = sc.take_shared<ItemTemplate>(); // the rangeless "Sword" from `setup`
  let ver = sc.take_shared<Version>();

  let (rolled_a, p1) = extension::z505(&ranged, option::some(1), &ver, sc.ctx());
  let (rolled_b, p2) = extension::z505(&ranged, option::some(999), &ver, sc.ctx());
  let (unseeded, p3) = extension::z505(&ranged, option::none(), &ver, sc.ctx());
  let (rangeless, p4) = extension::z505(&plain, option::some(1), &ver, sc.ctx());

  assert!(item_stats::has_rolled_stats(&rolled_a));
  assert!(item_stats::has_rolled_stats(&rolled_b));
  let va = item_stats::vitality(item_stats::rolled_stats(&rolled_a));
  let vb = item_stats::vitality(item_stats::rolled_stats(&rolled_b));
  assert!(va >= 100 && va <= 200);
  assert!(vb >= 100 && vb <= 200);
  assert!(va != vb); // different seed, different roll
  assert_eq!(item_stats::wisdom(item_stats::rolled_stats(&rolled_a)), 100); // degenerate field is fixed
  assert!(!item_stats::has_rolled_stats(&unseeded)); // no entropy offered → honestly blank
  assert!(!item_stats::has_rolled_stats(&rangeless)); // nothing authored to roll

  destroy(rolled_a); destroy(rolled_b); destroy(unseeded); destroy(rangeless);
  destroy(p1); destroy(p2); destroy(p3); destroy(p4);
  ts::return_shared(ranged); ts::return_shared(plain); ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
/// The mint door is a value path — it aborts while the package is dark.
fun mint_door_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, false); // NOT enabled

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let (item, pledge) = extension::z505(&tmpl, option::none(), &ver, sc.ctx()); // V_ENotEnabled
  destroy(item); destroy(pledge);
  abort
}

// ╔════════════════ [ Namespaced writes + free reads ] ═══════════════════════ ]

#[test]
/// A namespaced write then a free read round-trips on an Item (and the field lives under the given namespace).
fun item_field_write_read_roundtrip() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, true);
  share_item_policy(&mut sc);

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let policy = sc.take_shared<TransferPolicy<Item>>();

  let (mut item, pledge) = item::mint(&tmpl, sc.ctx());
  extension::z20(extension::z506(), &mut item, TestKey {}, 42u64, &ver);
  assert!(extension::z26(&item, extension::z506(), TestKey {}));
  assert_eq!(*extension::z27<TestKey, u64>(&item, extension::z506(), TestKey {}), 42);
  *extension::z21<TestKey, u64>(extension::z506(), &mut item, TestKey {}, &ver) = 99; // mutate in place
  assert_eq!(*extension::z27<TestKey, u64>(&item, extension::z506(), TestKey {}), 99);
  let removed: u64 = extension::remove_item_field(extension::z506(), &mut item, TestKey {}, &ver); // detach the slot
  assert_eq!(removed, 99);
  assert!(!extension::z26(&item, extension::z506(), TestKey {})); // slot is gone

  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, item, &mut kiosk, personal_kiosk::borrow(&pkcap), &policy);

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(policy);
  sc.end();
}

#[test]
/// A namespaced write then a free read round-trips on a Character (the twin API).
fun character_field_write_read_roundtrip() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, true);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let cust = character::new_customization(1, 2, 3);
  let (mut chr, pledge) = character::new_for_testing(b"hero".to_string(), b"senshi".to_string(), true, cust, 0, sc.ctx());

  let ns = extension::z30();
  extension::z22(ns, &mut chr, TestKey {}, 7u64, &ver);
  assert!(extension::z28(&chr, ns, TestKey {}));
  assert_eq!(*extension::z29<TestKey, u64>(&chr, ns, TestKey {}), 7);
  let removed: u64 = extension::z24(ns, &mut chr, TestKey {}, &ver);
  assert_eq!(removed, 7);
  assert!(!extension::z28(&chr, ns, TestKey {}));

  destroy(chr); destroy(pledge);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// NAMESPACE ISOLATION: ns0 and ns1 both write the SAME logical `TestKey` onto one item. Both writes SUCCEED
/// and COEXIST (no df-dup, no overwrite) because each lands under its own `NsKey` envelope — the physical-slot
/// isolation the reserved-namespace layout guarantees.
fun namespace_isolation_between_namespaces() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, true);
  share_item_policy(&mut sc);

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let policy = sc.take_shared<TransferPolicy<Item>>();

  let (mut item, pledge) = item::mint(&tmpl, sc.ctx());
  extension::z20(0, &mut item, TestKey {}, 100u64, &ver);
  extension::z20(1, &mut item, TestKey {}, 200u64, &ver); // SAME key, other namespace → coexists

  // each namespace holds its own value; neither clobbered the other
  assert_eq!(*extension::z27<TestKey, u64>(&item, 0, TestKey {}), 100);
  assert_eq!(*extension::z27<TestKey, u64>(&item, 1, TestKey {}), 200);
  // a third namespace never saw either write
  assert!(!extension::z26(&item, 2, TestKey {}));

  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, item, &mut kiosk, personal_kiosk::borrow(&pkcap), &policy);

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(policy);
  sc.end();
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
/// A namespaced write is a value path — it aborts while the package is dark.
fun write_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc, false); // NOT enabled

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let (mut item, pledge) = item::mint(&tmpl, sc.ctx());
  extension::z20(extension::z506(), &mut item, TestKey {}, 1u64, &ver); // V_ENotEnabled
  destroy(item); destroy(pledge);
  abort
}
