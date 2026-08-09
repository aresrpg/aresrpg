// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Admin-authority tests: the super cap authors; a temp cap authors within its epoch but EXPIRES the next
/// epoch; only the super cap mints temp caps; the super cap can never be deleted while a temp cap can; the
/// enabled switch toggles; a stale version blocks authoring. Plus the v2 authoring surface: the category
/// whitelist gate (unknown → abort, admin add/remove), stat RANGES round-trip, both-or-neither range rule, and
/// the consumable-effect-only-on-consumables rule.
#[test_only]
module aresrpg::admin_tests;

use aresrpg::{admin::{Self, AdminCap, Catalog}, consumable_effect, item, item_damages, item_stats, version::{Self, Version}};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xD;

const EAdminCapExpired: u64 = 101; // admin
const ESuperAdmin: u64 = 102; // admin
const ENotSuperAdmin: u64 = 103; // admin
const EUnknownCategory: u64 = 104; // admin
const EStatsRangeMismatch: u64 = 105; // admin
const EEffectNotConsumable: u64 = 106; // admin
const EStackableHasRanges: u64 = 107; // admin
const CE_EInvalidEffectKind: u64 = 101; // consumable_effect
const V_EWrongVersion: u64 = 101; // version

/// Stand the package up (version + admin + item + catalog) and whitelist a standard category set (`misc`,
/// `sword`, `consumable`) so tests can author against them. Releases every control object.
fun init_all(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"misc".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"sword".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"consumable".to_string(), &ver, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// 17 neutral (centered) stats — a convenience block for tests that don't care about specific values.
fun neutral(): item_stats::ItemStatistics {
  item_stats::new(
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  )
}

// ╔════════════════ [ Authoring ] ═══════════════════════════════════════════ ]

#[test]
fun super_cap_creates_template() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  assert!(admin::is_super(&cap));
  let tid = admin::create_template(
    &cap, &cat, b"Potion".to_string(), b"".to_string(), b"potion".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  assert_eq!(item::template_id(&tmpl), tid);
  assert_eq!(item::template_item_type(&tmpl), b"potion".to_string());
  assert_eq!(item::template_category(&tmpl), b"misc".to_string());
  assert_eq!(item::template_level(&tmpl), 1);
  assert!(!item_stats::has_ranges(&tmpl)); // no stats supplied → sealed of nothing

  ts::return_shared(tmpl);
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun create_template_attaches_ranges_and_damages() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  // vitality range [32768+32, 32768+132]; the other 16 stats neutral both ends.
  let stats_min = item_stats::new(
    32_800, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  );
  let stats_max = item_stats::new(
    32_900, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  );
  let dmg = item_damages::new(10, 25, b"melee".to_string(), b"fire".to_string());
  let tid = admin::create_template(
    &cap, &cat, b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 5,
    option::some(stats_min), option::some(stats_max), vector[dmg], option::none(), &version, sc.ctx(),
  );

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  assert_eq!(item::template_id(&tmpl), tid);
  // ranges round-trip
  assert!(item_stats::has_ranges(&tmpl));
  assert_eq!(item_stats::vitality(item_stats::stats_min(&tmpl)), 32_800);
  assert_eq!(item_stats::vitality(item_stats::stats_max(&tmpl)), 32_900);
  assert_eq!(item_stats::strength(item_stats::stats_min(&tmpl)), 32_768);
  assert!(item_damages::has_damages(&tmpl));
  let lines = item_damages::damages(&tmpl);
  assert_eq!(lines.length(), 1);
  assert_eq!(item_damages::element(lines.borrow(0)), b"fire".to_string());
  assert_eq!(item_damages::from(lines.borrow(0)), 10);
  assert_eq!(item_damages::to(lines.borrow(0)), 25);
  assert_eq!(item_damages::damage_type(lines.borrow(0)), b"melee".to_string());

  ts::return_shared(tmpl);
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun temp_cap_creates_template_within_its_epoch() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  assert!(!admin::is_super(&temp));
  admin::create_template(
    &temp, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );

  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(temp);
  sc.end();
}

#[test, expected_failure(abort_code = EAdminCapExpired, location = admin)]
fun temp_cap_expires_after_its_epoch() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  // advance one epoch — the temp cap (stamped with the previous epoch) is now stale
  sc.next_epoch(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &temp, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  ); // EAdminCapExpired
  abort
}

// ╔════════════════ [ Temp cap lifecycle ] ══════════════════════════════════ ]

#[test, expected_failure(abort_code = ENotSuperAdmin, location = admin)]
fun temp_cap_cannot_mint_another_temp() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&temp, @0xE, sc.ctx()); // only the super cap may mint temp → ENotSuperAdmin
  abort
}

#[test]
fun delete_temp_admin_cap_succeeds() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_tx(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  admin::delete_admin_cap(temp); // consumes + deletes the temp cap
  sc.end();
}

#[test, expected_failure(abort_code = ESuperAdmin, location = admin)]
fun delete_super_admin_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::delete_admin_cap(super_cap); // the root authority cannot be destroyed → ESuperAdmin
  abort
}

// ╔════════════════ [ Category whitelist gate ] ═════════════════════════════ ]

#[test, expected_failure(abort_code = EUnknownCategory, location = admin)]
fun create_template_unknown_category_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &cap, &cat, b"Banana".to_string(), b"".to_string(), b"banana".to_string(), b"banana".to_string(), 1, // not whitelisted
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  ); // EUnknownCategory
  abort
}

#[test]
fun admin_adds_then_removes_category() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();

  assert!(!admin::contains(&cat, b"ring".to_string()));
  admin::add_category(&cap, &mut cat, b"ring".to_string(), &version, sc.ctx());
  assert!(admin::contains(&cat, b"ring".to_string()));

  // a template can now be authored in the freshly-whitelisted category
  admin::create_template(
    &cap, &cat, b"Gelano".to_string(), b"".to_string(), b"gelano".to_string(), b"ring".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );

  admin::remove_category(&cap, &mut cat, b"ring".to_string(), &version, sc.ctx());
  assert!(!admin::contains(&cat, b"ring".to_string()));

  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun add_category_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cat = sc.take_shared<Catalog>();
  let mut version = sc.take_shared<Version>();
  version::test_set_stale(&mut version);
  admin::add_category(&cap, &mut cat, b"ring".to_string(), &version, sc.ctx()); // EWrongVersion
  abort
}

// ╔════════════════ [ Stat-range + consumable-effect rules ] ═════════════════ ]

#[test, expected_failure(abort_code = EStatsRangeMismatch, location = admin)]
fun stats_range_min_without_max_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &cap, &cat, b"Half".to_string(), b"".to_string(), b"half".to_string(), b"sword".to_string(), 1,
    option::some(neutral()), option::none(), vector[], option::none(), &version, sc.ctx(),
  ); // EStatsRangeMismatch — min present, max absent
  abort
}

#[test]
fun consumable_effect_attaches_on_consumable() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let effect = consumable_effect::new(consumable_effect::heal(), 50);
  admin::create_template(
    &cap, &cat, b"Bread".to_string(), b"".to_string(), b"bread".to_string(), b"consumable".to_string(), 1,
    option::none(), option::none(), vector[], option::some(effect), &version, sc.ctx(),
  );

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  assert!(consumable_effect::has_effect(&tmpl));
  assert_eq!(consumable_effect::kind(consumable_effect::effect(&tmpl)), consumable_effect::heal());
  assert_eq!(consumable_effect::amount(consumable_effect::effect(&tmpl)), 50);

  ts::return_shared(tmpl);
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EEffectNotConsumable, location = admin)]
fun consumable_effect_on_non_consumable_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let effect = consumable_effect::new(consumable_effect::heal(), 50);
  admin::create_template(
    &cap, &cat, b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1, // NOT consumable
    option::none(), option::none(), vector[], option::some(effect), &version, sc.ctx(),
  ); // EEffectNotConsumable
  abort
}

#[test, expected_failure(abort_code = CE_EInvalidEffectKind, location = consumable_effect)]
/// G4 closed vocabulary: a discriminant outside the frozen set (0..4) is rejected at the constructor.
fun consumable_effect_invalid_kind_aborts() {
  let _ = consumable_effect::new(5, 50); // kind 5 > KIND_MAX → EInvalidEffectKind
  abort
}

#[test]
/// G4: every frozen discriminant (heal/stat_reset/spell_reset/bag_open/gacha_roll) constructs, and the public
/// accessors expose the exact u8 ids the cross-package dispatcher switches on.
fun consumable_effect_vocabulary_ids() {
  assert_eq!(consumable_effect::heal(), 0);
  assert_eq!(consumable_effect::stat_reset(), 1);
  assert_eq!(consumable_effect::spell_reset(), 2);
  assert_eq!(consumable_effect::bag_open(), 3);
  assert_eq!(consumable_effect::gacha_roll(), 4);
  // the max valid kind constructs; the amount round-trips
  let e = consumable_effect::new(consumable_effect::gacha_roll(), 7);
  assert_eq!(consumable_effect::kind(&e), 4);
  assert_eq!(consumable_effect::amount(&e), 7);
}

// ╔════════════════ [ Template burn ] ═══════════════════════════════════════ ]

#[test]
/// Author a fully-loaded gear template (stat ranges + damages), burn it, and prove the shared object is GONE.
fun burn_item_template_deletes_the_shared_template() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let dmg = item_damages::new(10, 25, b"melee".to_string(), b"fire".to_string());
  admin::create_template(
    &cap, &cat, b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 5,
    option::some(neutral()), option::some(neutral()), vector[dmg], option::none(), &version, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let version = sc.take_shared<Version>();
  let tmpl = sc.take_shared<item::ItemTemplate>();
  admin::burn_item_template(&cap, tmpl, &version, sc.ctx()); // detaches ranges+damages DFs, deletes the object
  ts::return_shared(version);
  sc.return_to_sender(cap);

  // the shared template no longer exists
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<item::ItemTemplate>());

  sc.end();
}

#[test]
/// Burn a CONSUMABLE template (exercises the effect-DF detach), then re-author the same `item_type` — proves no
/// lingering on-chain state blocks a fresh template under the same slug.
fun burn_consumable_then_recreate_same_type() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let effect = consumable_effect::new(consumable_effect::heal(), 50);
  admin::create_template(
    &cap, &cat, b"Bread".to_string(), b"".to_string(), b"bread".to_string(), b"consumable".to_string(), 1,
    option::none(), option::none(), vector[], option::some(effect), &version, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let version = sc.take_shared<Version>();
  let tmpl = sc.take_shared<item::ItemTemplate>();
  admin::burn_item_template(&cap, tmpl, &version, sc.ctx()); // detaches effect DF, deletes the object
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<item::ItemTemplate>()); // gone

  // re-author the same slug — succeeds
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, b"Bread".to_string(), b"".to_string(), b"bread".to_string(), b"consumable".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  assert_eq!(item::template_id(&tmpl), tid);
  assert_eq!(item::template_item_type(&tmpl), b"bread".to_string());

  ts::return_shared(tmpl);
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EAdminCapExpired, location = admin)]
/// Burning with a temp cap used AFTER its epoch aborts (`EAdminCapExpired`) — same authority gate as authoring.
fun burn_item_template_with_expired_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &super_cap, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(super_cap);

  // advance one epoch — the temp cap is now stale
  sc.next_epoch(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let version = sc.take_shared<Version>();
  let tmpl = sc.take_shared<item::ItemTemplate>();
  admin::burn_item_template(&temp, tmpl, &version, sc.ctx()); // EAdminCapExpired
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Burning on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `create_template`.
fun burn_item_template_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &cap, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut version = sc.take_shared<Version>();
  let tmpl = sc.take_shared<item::ItemTemplate>();
  version::test_set_stale(&mut version);
  admin::burn_item_template(&cap, tmpl, &version, sc.ctx()); // EWrongVersion
  abort
}

// ╔════════════════ [ Template rename (in-place name/description patch) ] ════ ]

#[test]
/// The name/description setter patches BOTH fields in place while leaving every OTHER field byte-unchanged
/// (item_type / category / level) and the typed stat/damage DFs intact — a rename is not a re-author, and the
/// template object ID is preserved (no re-mint).
fun set_template_name_description_patches_name_and_desc_only() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  let stats_min = item_stats::new(
    32_800, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  );
  let stats_max = item_stats::new(
    32_900, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  );
  let dmg = item_damages::new(10, 25, b"melee".to_string(), b"fire".to_string());
  let tid = admin::create_template(
    &cap, &cat, b"A Rock on a String".to_string(), b"joke desc".to_string(), b"sword".to_string(), b"sword".to_string(), 5,
    option::some(stats_min), option::some(stats_max), vector[dmg], option::none(), &version, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let version = sc.take_shared<Version>();
  let mut tmpl = sc.take_shared<item::ItemTemplate>();
  admin::set_template_name_description(
    &cap, &mut tmpl, b"Pebble Pendant".to_string(), b"canon desc".to_string(), &version, sc.ctx(),
  );
  // name + description patched…
  assert_eq!(item::template_name(&tmpl), b"Pebble Pendant".to_string());
  assert_eq!(item::template_description(&tmpl), b"canon desc".to_string());
  // …identity preserved (same object id, no re-mint)…
  assert_eq!(item::template_id(&tmpl), tid);
  // …and EVERY other field byte-unchanged.
  assert_eq!(item::template_item_type(&tmpl), b"sword".to_string());
  assert_eq!(item::template_category(&tmpl), b"sword".to_string());
  assert_eq!(item::template_level(&tmpl), 5);
  // typed DFs survive a rename (stat ranges + damages still attached, values intact)
  assert!(item_stats::has_ranges(&tmpl));
  assert_eq!(item_stats::vitality(item_stats::stats_max(&tmpl)), 32_900);
  assert!(item_damages::has_damages(&tmpl));

  ts::return_shared(tmpl);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Renaming on a stale package version aborts (`EWrongVersion`) — version-gated exactly like create/burn.
fun set_template_name_description_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &cap, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut version = sc.take_shared<Version>();
  let mut tmpl = sc.take_shared<item::ItemTemplate>();
  version::test_set_stale(&mut version);
  admin::set_template_name_description(
    &cap, &mut tmpl, b"new".to_string(), b"new".to_string(), &version, sc.ctx(),
  ); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = EAdminCapExpired, location = admin)]
/// Renaming with a temp cap used AFTER its epoch aborts (`EAdminCapExpired`) — same authority gate as create/burn.
fun set_template_name_description_with_expired_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &super_cap, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(super_cap);

  // advance one epoch — the temp cap (stamped with the previous epoch) is now stale
  sc.next_epoch(TEMP);
  let temp = sc.take_from_sender<AdminCap>();
  let version = sc.take_shared<Version>();
  let mut tmpl = sc.take_shared<item::ItemTemplate>();
  admin::set_template_name_description(
    &temp, &mut tmpl, b"new".to_string(), b"new".to_string(), &version, sc.ctx(),
  ); // EAdminCapExpired
  abort
}

// ╔════════════════ [ Version / enabled control ] ═══════════════════════════ ]

#[test]
fun admin_toggles_enabled_switch() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut version = sc.take_shared<Version>();
  assert!(!version.is_enabled()); // ships dark
  admin::admin_set_enabled(&cap, &mut version, true, sc.ctx());
  assert!(version.is_enabled());
  admin::admin_set_enabled(&cap, &mut version, false, sc.ctx());
  assert!(!version.is_enabled());

  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// The version getters + the admin bump door: a fresh Version reports the source PACKAGE_VERSION; forcing it stale
/// (0) then bumping through the AdminCap door restores it. Covers `version::current_version` / `package_version`
/// and `admin::admin_bump_version` (which drives the package-private `version::bump`).
fun bump_restores_version_and_getters() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut version = sc.take_shared<Version>();
  assert_eq!(version::current_version(&version), version::package_version()); // fresh = source version
  version::test_set_stale(&mut version);
  assert_eq!(version::current_version(&version), 0);
  admin::admin_bump_version(&cap, &mut version, sc.ctx()); // bump door → version::bump writes PACKAGE_VERSION
  assert_eq!(version::current_version(&version), version::package_version());

  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun create_template_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let mut version = sc.take_shared<Version>();
  version::test_set_stale(&mut version);
  admin::create_template(
    &cap, &cat, b"x".to_string(), b"".to_string(), b"x".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  ); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = EStackableHasRanges, location = admin)]
/// (b) A stackable category (consumable/resource) may not carry stat ranges — rejected at AUTHORING (root cause,
/// so a stackable-with-ranges template can never exist; `shop::buy` re-asserts on the money path).
fun create_template_stackable_with_ranges_aborts() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc); // whitelists `consumable`

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  admin::create_template(
    &cap, &cat, b"Potion".to_string(), b"".to_string(), b"potion".to_string(), b"consumable".to_string(), 1,
    option::some(neutral()), option::some(neutral()), vector[], option::none(), &version, sc.ctx(),
  ); // EStackableHasRanges (consumable stacks → no ranges allowed)
  abort
}

// ╔════════════════ [ item_stats::template_max_raw — the forge's max-range projection ] ═ ]

#[test]
/// `item_stats::template_max_raw` projects a template's MAX roll ranges to the de-centered raw 17-vector the forge
/// rates a scribe against: a RANGELESS template yields the all-zero vector (`zero_raw` — EXOTIC-rated), a ranged
/// one yields `to_raw(stats_max)` (here vitality max = +132 raw, every other field at centre → 0).
fun template_max_raw_projects_ranges() {
  let mut sc = ts::begin(OWNER);
  init_all(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let version = sc.take_shared<Version>();
  // (a) rangeless template → template_max_raw == zero_raw (the EXOTIC all-zero rating).
  let plain_tid = admin::create_template(
    &cap, &cat, b"Plain".to_string(), b"".to_string(), b"plain".to_string(), b"misc".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &version, sc.ctx(),
  );
  // (b) ranged (non-stackable) template: vitality max = centre+132, every other field at centre both ends.
  let stats_max = item_stats::new(
    32_768 + 132, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
    32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768, 32_768,
  );
  let ranged_tid = admin::create_template(
    &cap, &cat, b"Sword".to_string(), b"".to_string(), b"sword2".to_string(), b"sword".to_string(), 5,
    option::some(neutral()), option::some(stats_max), vector[], option::none(), &version, sc.ctx(),
  );

  sc.next_tx(OWNER);
  let plain = ts::take_shared_by_id<item::ItemTemplate>(&sc, plain_tid);
  let ranged = ts::take_shared_by_id<item::ItemTemplate>(&sc, ranged_tid);
  assert!(item_stats::template_max_raw(&plain) == item_stats::zero_raw()); // rangeless → all-zero
  let raw = item_stats::template_max_raw(&ranged);
  assert_eq!(raw.length(), 17);
  assert_eq!(*raw.borrow(0), 132); // vitality de-centered from its max range
  assert_eq!(*raw.borrow(1), 0); // wisdom centered → 0

  ts::return_shared(plain);
  ts::return_shared(ranged);
  ts::return_shared(cat);
  ts::return_shared(version);
  sc.return_to_sender(cap);
  sc.end();
}
