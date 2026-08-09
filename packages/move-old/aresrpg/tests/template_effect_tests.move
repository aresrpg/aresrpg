// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Live ItemTemplate consumable-effect update tests — the #1442 cure path: a consumable minted EFFECT-LESS gets its
/// effect through `admin::set_template_effect` (the attach leg), an authored effect is REPLACED not appended (the
/// overwrite leg), the same call twice is the same state (idempotent), a non-consumable category is refused, a kind
/// outside the frozen vocabulary is refused, an expired AdminCap is refused, and a stale Version is refused. The
/// production door lives in `admin` so authority stays single-homed.
#[test_only]
module aresrpg::template_effect_tests;

use aresrpg::{
    admin::{Self, AdminCap, Catalog},
    consumable_effect,
    item::{Self, ItemTemplate},
    version::{Self, Version}
};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xD;
const A_EAdminCapExpired: u64 = 101;
const A_EEffectNotConsumable: u64 = 106;
const C_EInvalidEffectKind: u64 = 101;
const V_EWrongVersion: u64 = 101;

fun init_all(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"consumable".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"sword".to_string(), &ver, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// A template of `category`, carrying `effect` (`none` = the effect-less state every live consumable is in).
fun create_template(sc: &mut Scenario, category: vector<u8>, effect: Option<consumable_effect::ConsumableEffect>): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let id = admin::create_template(
    &cap,
    &cat,
    b"Small Health Potion".to_string(),
    b"unchanged".to_string(),
    b"small_health_potion".to_string(),
    category.to_string(),
    12,
    option::none(),
    option::none(),
    vector[],
    effect,
    &ver,
    sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  id
}

/// Drive the production door over the shared template `tid`.
fun set_effect(sc: &mut Scenario, tid: ID, kind: u8, amount: u64) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  admin::set_template_effect(&cap, &mut tmpl, kind, amount, &ver, sc.ctx());
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Assert the template behind `tid` carries exactly `(kind, amount)`.
fun assert_effect(sc: &Scenario, tid: ID, kind: u8, amount: u64) {
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  assert!(consumable_effect::has_effect(&tmpl));
  let e = consumable_effect::effect(&tmpl);
  assert_eq!(consumable_effect::kind(e), kind);
  assert_eq!(consumable_effect::amount(e), amount);
  ts::return_shared(tmpl);
}

#[test]
/// THE #1442 CURE: a consumable authored WITHOUT an effect (the state of all 140 live templates) gets one through
/// the door — the attach leg — and every base field survives, the object ID above all so minted stacks stay valid.
fun set_template_effect_attaches_when_template_had_none() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"consumable", option::none());

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(!consumable_effect::has_effect(&tmpl)); // inert: eating it does nothing
  ts::return_shared(tmpl);

  set_effect(&mut sc, tid, consumable_effect::heal(), 250);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  assert!(consumable_effect::has_effect(&tmpl));
  let e = consumable_effect::effect(&tmpl);
  assert_eq!(consumable_effect::kind(e), consumable_effect::heal());
  assert_eq!(consumable_effect::amount(e), 250);

  assert_eq!(item::template_id(&tmpl), tid); // patched IN PLACE — every minted stack / kiosk lock stays valid
  assert_eq!(item::template_name(&tmpl), b"Small Health Potion".to_string());
  assert_eq!(item::template_description(&tmpl), b"unchanged".to_string());
  assert_eq!(item::template_item_type(&tmpl), b"small_health_potion".to_string());
  assert_eq!(item::template_category(&tmpl), b"consumable".to_string());
  assert_eq!(item::template_level(&tmpl), 12);
  ts::return_shared(tmpl);
  sc.end();
}

#[test]
/// An authored effect is REPLACED wholesale — a template carries exactly one effect before and after, and both the
/// kind and the amount are the new ones (a mis-authored heal becomes a stat reset, nothing lingers).
fun set_template_effect_replaces_the_authored_effect() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(
    &mut sc,
    b"consumable",
    option::some(consumable_effect::new(consumable_effect::heal(), 10)),
  );

  set_effect(&mut sc, tid, consumable_effect::stat_reset(), 1);

  sc.next_tx(OWNER);
  assert_effect(&sc, tid, consumable_effect::stat_reset(), 1);
  sc.end();
}

#[test]
/// IDEMPOTENT: the cure driver re-running the same write lands the same single effect — a replay is a no-op, never a
/// second row and never the `attach` double-add abort.
fun set_template_effect_is_idempotent() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"consumable", option::none());

  set_effect(&mut sc, tid, consumable_effect::heal(), 250);
  set_effect(&mut sc, tid, consumable_effect::heal(), 250);

  sc.next_tx(OWNER);
  assert_effect(&sc, tid, consumable_effect::heal(), 250);
  sc.end();
}

#[test, expected_failure(abort_code = A_EEffectNotConsumable, location = admin)]
/// A non-consumable template cannot be given an effect — the SAME gate `create_template` applies, so no upgrade door
/// can smuggle an effect onto a sword.
fun set_template_effect_non_consumable_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"sword", option::none());

  set_effect(&mut sc, tid, consumable_effect::heal(), 250);
  abort
}

#[test, expected_failure(abort_code = C_EInvalidEffectKind, location = consumable_effect)]
/// A discriminant outside the FROZEN vocabulary is refused at the constructor — the scalar signature keeps the exact
/// validation the `ConsumableEffect` argument would have had.
fun set_template_effect_invalid_kind_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"consumable", option::none());

  set_effect(&mut sc, tid, 200, 1); // KIND_MAX is 4
  abort
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// ADVERSARIAL: a leaked TEMP cap used AFTER its epoch cannot write an effect. (A caller holding no cap at all cannot
/// reach the door — the `&AdminCap` parameter is unforgeable.)
fun set_template_effect_wrong_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"consumable", option::none());

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let expired_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  admin::set_template_effect(&expired_cap, &mut tmpl, consumable_effect::heal(), 250, &ver, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// A stale Version refuses the door — the cure cannot land against an outdated package.
fun set_template_effect_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);
  let tid = create_template(&mut sc, b"consumable", option::none());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  admin::set_template_effect(&cap, &mut tmpl, consumable_effect::heal(), 250, &ver, sc.ctx());
  abort
}
