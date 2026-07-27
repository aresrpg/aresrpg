// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Live ItemTemplate damage-line update tests: the authored lines replace WHOLESALE (old lines gone, not merged), a
/// template authored WITHOUT lines heals through the same door, an empty replacement CLEARS back to the
/// never-authored state, an invalid (expired) AdminCap is rejected, and a stale Version is rejected. The production
/// door lives in `admin` so authority stays single-homed.
#[test_only]
module aresrpg::template_damages_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  item::{Self, ItemTemplate},
  item_damages::{Self, ItemDamages},
  version::{Self, Version}
};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xD;
const A_EAdminCapExpired: u64 = 101;
const V_EWrongVersion: u64 = 101;

fun init_all(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"sword".to_string(), &ver, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// The MIS-AUTHORED weapon line the re-magnitude cure replaces (one fire line, far too weak).
fun authored_line(): ItemDamages {
  item_damages::new(10, 20, b"fixed".to_string(), b"fire".to_string())
}

/// The corrected payload: two lines, different magnitudes, different elements — proves full replacement, not a merge.
fun cured_lines(): vector<ItemDamages> {
  vector[
    item_damages::new(100, 200, b"fixed".to_string(), b"water".to_string()),
    item_damages::new(5, 7, b"steal".to_string(), b"earth".to_string()),
  ]
}

/// A weapon template carrying `damages` from birth.
fun create_template(sc: &mut Scenario, damages: vector<ItemDamages>): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let id = admin::create_template(
    &cap,
    &cat,
    b"Seed Blade".to_string(),
    b"unchanged".to_string(),
    b"seed_blade".to_string(),
    b"sword".to_string(),
    42,
    option::none(),
    option::none(),
    damages,
    option::none(),
    &ver,
    sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  id
}

/// Drive the production door over the shared template `tid`.
fun set_damages(sc: &mut Scenario, tid: ID, damages: vector<ItemDamages>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  admin::set_template_damages(&cap, &mut tmpl, damages, &ver, sc.ctx());
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

#[test]
/// THE WEAPON CURE: the authored lines are replaced WHOLESALE — the old (10,20,fire) line is gone, both new lines
/// land verbatim, and every base template field survives (the object ID above all, so minted items stay valid).
fun set_template_damages_replaces_all_lines_only() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, vector[authored_line()]);

  set_damages(&mut sc, tid, cured_lines());

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(item_damages::has_damages(&tmpl));
  let lines = item_damages::damages(&tmpl);
  assert_eq!(lines.length(), 2); // the single authored line did not survive alongside the new ones

  let first = &lines[0];
  assert_eq!(item_damages::from(first), 100);
  assert_eq!(item_damages::to(first), 200);
  assert_eq!(item_damages::damage_type(first), b"fixed".to_string());
  assert_eq!(item_damages::element(first), b"water".to_string());

  let second = &lines[1];
  assert_eq!(item_damages::from(second), 5);
  assert_eq!(item_damages::to(second), 7);
  assert_eq!(item_damages::damage_type(second), b"steal".to_string());
  assert_eq!(item_damages::element(second), b"earth".to_string());

  // the OLD magnitude is nowhere in the replacement
  assert!(item_damages::from(first) != 10 && item_damages::from(second) != 10);

  assert_eq!(item::template_id(&tmpl), tid); // patched IN PLACE — every minted item / kiosk lock stays valid
  assert_eq!(item::template_name(&tmpl), b"Seed Blade".to_string());
  assert_eq!(item::template_description(&tmpl), b"unchanged".to_string());
  assert_eq!(item::template_item_type(&tmpl), b"seed_blade".to_string());
  assert_eq!(item::template_category(&tmpl), b"sword".to_string());
  assert_eq!(item::template_level(&tmpl), 42);
  ts::return_shared(tmpl);
  sc.end();
}

#[test]
/// A weapon authored WITHOUT lines (the DF never existed) heals through the SAME door — the attach path.
fun set_template_damages_attaches_when_template_had_none() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, vector[]);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(!item_damages::has_damages(&tmpl)); // nothing to overwrite
  ts::return_shared(tmpl);

  set_damages(&mut sc, tid, vector[authored_line()]);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(item_damages::has_damages(&tmpl));
  let lines = item_damages::damages(&tmpl);
  assert_eq!(lines.length(), 1);
  assert_eq!(item_damages::from(&lines[0]), 10);
  assert_eq!(item_damages::to(&lines[0]), 20);
  ts::return_shared(tmpl);
  sc.end();
}

#[test]
/// An EMPTY replacement CLEARS the lines back to the never-authored state — `has_damages` answers `false`, exactly
/// as it would for a template created with an empty `damages` argument. One home for "carries no lines".
fun set_template_damages_empty_clears_to_unauthored_state() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, vector[authored_line()]);

  set_damages(&mut sc, tid, vector[]);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(!item_damages::has_damages(&tmpl)); // no empty-vector DF left behind
  ts::return_shared(tmpl);
  sc.end();
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// ADVERSARIAL: a leaked TEMP cap used AFTER its epoch cannot re-magnitude a weapon. (A caller holding no cap at all
/// cannot reach the door — the `&AdminCap` parameter is unforgeable.)
fun set_template_damages_wrong_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, vector[authored_line()]);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let expired_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  admin::set_template_damages(&expired_cap, &mut tmpl, cured_lines(), &ver, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// A stale Version refuses the door — the re-magnitude cannot land against an outdated package.
fun set_template_damages_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, vector[authored_line()]);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  admin::set_template_damages(&cap, &mut tmpl, cured_lines(), &ver, sc.ctx());
  abort
}
