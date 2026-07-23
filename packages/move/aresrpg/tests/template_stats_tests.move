// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Live ItemTemplate stat-range update tests: all 17 min/max slots replace in place, an invalid (expired) AdminCap
/// is rejected, and a stale Version is rejected. The production door lives in `admin` so authority stays single-homed.
#[test_only]
module aresrpg::template_stats_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  item::{Self, ItemTemplate},
  item_stats,
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

fun neutral(): item_stats::ItemStatistics {
  item_stats::new(
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  )
}

fun create_template(sc: &mut Scenario): ID {
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
    option::some(neutral()),
    option::some(neutral()),
    vector[],
    option::none(),
    &ver,
    sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  id
}

fun set_fixture_stats(cap: &AdminCap, tmpl: &mut ItemTemplate, ver: &Version, sc: &mut Scenario) {
  admin::set_template_stats(
    cap,
    tmpl,
    32_769, 32_770, 32_771, 32_772, 32_773, 32_774, 32_775, 32_776, 32_777,
    32_778, 32_779, 32_780, 32_781, 32_782, 32_783, 32_784, 32_785,
    32_801, 32_802, 32_803, 32_804, 32_805, 32_806, 32_807, 32_808, 32_809,
    32_810, 32_811, 32_812, 32_813, 32_814, 32_815, 32_816, 32_817,
    ver,
    sc.ctx(),
  );
}

#[test]
fun set_template_stats_replaces_all_ranges_only() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  set_fixture_stats(&cap, &mut tmpl, &ver, &mut sc);

  let min = item_stats::stats_min(&tmpl);
  assert_eq!(item_stats::vitality(min), 32_769);
  assert_eq!(item_stats::wisdom(min), 32_770);
  assert_eq!(item_stats::strength(min), 32_771);
  assert_eq!(item_stats::intelligence(min), 32_772);
  assert_eq!(item_stats::chance(min), 32_773);
  assert_eq!(item_stats::agility(min), 32_774);
  assert_eq!(item_stats::range(min), 32_775);
  assert_eq!(item_stats::movement(min), 32_776);
  assert_eq!(item_stats::action(min), 32_777);
  assert_eq!(item_stats::critical(min), 32_778);
  assert_eq!(item_stats::raw_damage(min), 32_779);
  assert_eq!(item_stats::critical_chance(min), 32_780);
  assert_eq!(item_stats::critical_outcomes(min), 32_781);
  assert_eq!(item_stats::earth_resistance(min), 32_782);
  assert_eq!(item_stats::fire_resistance(min), 32_783);
  assert_eq!(item_stats::water_resistance(min), 32_784);
  assert_eq!(item_stats::air_resistance(min), 32_785);

  let max = item_stats::stats_max(&tmpl);
  assert_eq!(item_stats::vitality(max), 32_801);
  assert_eq!(item_stats::wisdom(max), 32_802);
  assert_eq!(item_stats::strength(max), 32_803);
  assert_eq!(item_stats::intelligence(max), 32_804);
  assert_eq!(item_stats::chance(max), 32_805);
  assert_eq!(item_stats::agility(max), 32_806);
  assert_eq!(item_stats::range(max), 32_807);
  assert_eq!(item_stats::movement(max), 32_808);
  assert_eq!(item_stats::action(max), 32_809);
  assert_eq!(item_stats::critical(max), 32_810);
  assert_eq!(item_stats::raw_damage(max), 32_811);
  assert_eq!(item_stats::critical_chance(max), 32_812);
  assert_eq!(item_stats::critical_outcomes(max), 32_813);
  assert_eq!(item_stats::earth_resistance(max), 32_814);
  assert_eq!(item_stats::fire_resistance(max), 32_815);
  assert_eq!(item_stats::water_resistance(max), 32_816);
  assert_eq!(item_stats::air_resistance(max), 32_817);

  assert_eq!(item::template_id(&tmpl), tid);
  assert_eq!(item::template_name(&tmpl), b"Seed Blade".to_string());
  assert_eq!(item::template_description(&tmpl), b"unchanged".to_string());
  assert_eq!(item::template_item_type(&tmpl), b"seed_blade".to_string());
  assert_eq!(item::template_category(&tmpl), b"sword".to_string());
  assert_eq!(item::template_level(&tmpl), 42);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
fun set_template_stats_wrong_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let expired_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  set_fixture_stats(&expired_cap, &mut tmpl, &ver, &mut sc);
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun set_template_stats_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  set_fixture_stats(&cap, &mut tmpl, &ver, &mut sc);
  abort
}
