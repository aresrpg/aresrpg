// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Spell-template tests: derived-object canonicity, exact six-level shape, structural effect-vocabulary rejection,
/// uncapped numeric admission/tuning, version gating, and a full 12-class starter fixture.
#[test_only]
module aresrpg_spells::spell_template_tests;

use aresrpg_foundation::{spell, spell_effect::{Self, Effect, SpellLevel}};
use aresrpg_spells::{
  admin::{Self, AdminCap},
  spell_template::{Self, SpellRegistry, SpellTemplate},
  version::{Self, Version}
};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const B: u64 = 40; // legacy ABI argument; structural validation ignores it
const P: u64 = 5; // legacy ABI argument; structural validation ignores it

// ── mirrored error values ──
const EWrongLevelCount: u64 = 101; // spell_template
const EIllegalLevel: u64 = 102; // spell_template
const V_EWrongVersion: u64 = 101; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

fun setup(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  spell_template::test_init(sc.ctx());
}

fun fire(): u8 { spell::el_fire() }

/// One structurally legal spell level: ap 4, range 1..4, LOS, and base/crit damage effects.
fun lvl(min_char_level: u16, base: u64): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 4, 1, 4, false, false, true, false, 255, 255, 0, 50, false, vector[], vector[],
    vector[spell_effect::damage(fire(), base)],
    vector[spell_effect::damage(fire(), base + 10)],
  )
}

fun lvl_with_effect(min_char_level: u16, effect: Effect): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 4, 1, 4, false, false, true, false, 255, 255, 0, 50, false, vector[], vector[],
    vector[effect], vector[],
  )
}

/// Six structurally legal levels used by common fixtures.
fun legal_levels(unlock: u16): vector<SpellLevel> {
  vector[lvl(1, 15), lvl(20, 17), lvl(40, 19), lvl(60, 21), lvl(80, 23), lvl(unlock + 100, 25)]
}

/// Mint a supplied six-level spell and return its shared-object id.
fun mint_levels_named(
  sc: &mut Scenario,
  cls: vector<u8>,
  unlock: u16,
  name: vector<u8>,
  levels: vector<SpellLevel>,
): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut reg = sc.take_shared<SpellRegistry>();
  let ver = sc.take_shared<Version>();
  let id = spell_template::mint_spell(
    &cap, &mut reg, cls.to_string(), unlock, name.to_string(), levels, B, P, &ver, sc.ctx(),
  );
  ts::return_shared(reg);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  id
}

/// Mint one legal spell for `cls` at `unlock` under the spell slug `name`, returning its id.
fun mint_named(sc: &mut Scenario, cls: vector<u8>, unlock: u16, name: vector<u8>): ID {
  mint_levels_named(sc, cls, unlock, name, legal_levels(unlock))
}

/// Mint one legal spell for `cls` at `unlock` under the default slug `b"spell"` (the common single-spell-per-level
/// case), returning its id.
fun mint(sc: &mut Scenario, cls: vector<u8>, unlock: u16): ID { mint_named(sc, cls, unlock, b"spell") }

// ╔════════════════ [ Admission — happy + canonicity ] ═══════════════════════ ]

#[test]
fun mint_shares_derived_template() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let sid = mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let reg = sc.take_shared<SpellRegistry>();
  let tmpl = ts::take_shared_by_id<SpellTemplate>(&sc, sid);
  assert_eq!(spell_template::spell_id(&tmpl), sid);
  assert_eq!(spell_template::class(&tmpl), b"senshi".to_string());
  assert_eq!(spell_template::unlock_level(&tmpl), 1);
  assert_eq!(spell_template::name(&tmpl), b"spell".to_string());
  assert_eq!(spell_template::levels(&tmpl).length(), 6);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_ap_cost(), 4);
  assert_eq!(spell_template::level_of(&tmpl, 6).min_char_level(), 101); // unlock 1 + 100
  // canonicity: the (class, unlock, name) key is claimed and the derived-address helper matches the actual object.
  assert!(spell_template::spell_exists(&reg, b"senshi".to_string(), 1, b"spell".to_string()));
  assert_eq!(spell_template::spell_id_for(&reg, b"senshi".to_string(), 1, b"spell".to_string()), object::id_to_address(&sid));

  ts::return_shared(tmpl);
  ts::return_shared(reg);
  sc.end();
}

#[test, expected_failure]
/// §17.16 (amended): a second (class, unlock_level, name) with the same TRIPLE is UNCONSTRUCTIBLE —
/// `derived_object::claim` aborts on the taken address (clever-error, matched generically). Both mint the slug b"spell".
fun duplicate_class_unlock_name_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);
  mint(&mut sc, b"senshi", 1); // same (class, unlock, name=b"spell") → claim aborts
  abort
}

#[test]
/// §17.16 (amended) — the fix: a class fields MULTIPLE spells at ONE unlock level via distinct spell names.
/// Two spells at (senshi, 1) named "ember" and "charge" BOTH mint (its three level-1 starters share unlock 1 the
/// same way, each a distinct slug).
fun same_class_unlock_distinct_names_admit() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let s0 = mint_named(&mut sc, b"senshi", 1, b"ember");
  let s1 = mint_named(&mut sc, b"senshi", 1, b"charge");
  assert!(s0 != s1); // distinct derived addresses under the same (class, unlock)

  sc.next_tx(OWNER);
  let reg = sc.take_shared<SpellRegistry>();
  assert!(spell_template::spell_exists(&reg, b"senshi".to_string(), 1, b"ember".to_string()));
  assert!(spell_template::spell_exists(&reg, b"senshi".to_string(), 1, b"charge".to_string()));
  assert_eq!(spell_template::spell_id_for(&reg, b"senshi".to_string(), 1, b"ember".to_string()), object::id_to_address(&s0));
  assert_eq!(spell_template::spell_id_for(&reg, b"senshi".to_string(), 1, b"charge".to_string()), object::id_to_address(&s1));
  ts::return_shared(reg);
  sc.end();
}

// ╔════════════════ [ Admission — shape rules ] ══════════════════════════════ ]

#[test, expected_failure(abort_code = EWrongLevelCount, location = spell_template)]
fun wrong_level_count_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut reg = sc.take_shared<SpellRegistry>();
  let ver = sc.take_shared<Version>();
  spell_template::mint_spell(
    &cap, &mut reg, b"senshi".to_string(), 1, b"s".to_string(), vector[lvl(1, 15)], B, P, &ver, sc.ctx(),
  ); // only 1 level → EWrongLevelCount
  abort
}

#[test]
fun numeric_level_values_admit_unchanged() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  // Non-monotone character gates, a non-formula L6 gate, and damage above the old B+P*level budget are data.
  let levels = vector[lvl(50, 1_000), lvl(20, 17), lvl(10, 19), lvl(60, 21), lvl(80, 23), lvl(90, 25)];
  let sid = mint_levels_named(&mut sc, b"senshi", 1, b"numeric", levels);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<SpellTemplate>(&sc, sid);
  assert_eq!(spell_template::level_of(&tmpl, 1).min_char_level(), 50);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_effects().borrow(0).value(), 1_000);
  assert_eq!(spell_template::level_of(&tmpl, 3).min_char_level(), 10);
  assert_eq!(spell_template::level_of(&tmpl, 6).min_char_level(), 90);
  ts::return_shared(tmpl);
  sc.end();
}

#[test, expected_failure(abort_code = EIllegalLevel, location = spell_template)]
fun unknown_effect_kind_at_admission_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let unknown = spell_effect::new_effect(
    200, 255, 1, spell_effect::shape_point(), 0, spell_effect::tf_not_team(), 100, 0, 0, 0,
    spell_effect::phase_on_enter(),
  );
  let levels = vector[
    lvl_with_effect(1, unknown), lvl(20, 17), lvl(40, 19), lvl(60, 21), lvl(80, 23), lvl(101, 25),
  ];
  mint_levels_named(&mut sc, b"senshi", 1, b"unknown", levels);
  abort
}

// ╔════════════════ [ Live-tune setters — numeric data is uncapped, structure is enforced ] ═ ]

#[test]
fun setter_ap_in_band_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_ap_cost(&cap, &mut tmpl, 1, 6, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_ap_cost(), 6); // edit applied next read/cast

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun setter_ap_above_legacy_band_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_ap_cost(&cap, &mut tmpl, 1, 13, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_ap_cost(), 13);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun setter_effect_magnitude_above_legacy_budget_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  let restored = vector[spell_effect::damage(fire(), 1_000)];
  spell_template::set_level_effects(&cap, &mut tmpl, 1, restored, vector[], B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_effects().borrow(0).value(), 1_000);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EIllegalLevel, location = spell_template)]
fun setter_unknown_crit_effect_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  let unknown = spell_effect::new_effect(
    200, 255, 1, spell_effect::shape_point(), 0, spell_effect::tf_not_team(), 100, 0, 0, 0,
    spell_effect::phase_on_enter(),
  );
  spell_template::set_level_effects(
    &cap, &mut tmpl, 1, vector[spell_effect::damage(fire(), 15)], vector[unknown], B, P, &ver, sc.ctx(),
  );
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun setter_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  spell_template::set_level_ap_cost(&cap, &mut tmpl, 1, 6, B, P, &ver, sc.ctx()); // EWrongVersion
  abort
}

#[test]
fun setter_range_in_band_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_range(&cap, &mut tmpl, 1, 2, 10, true, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_range_min(), 2);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_range_max(), 10);
  assert!(spell_template::level_of(&tmpl, 1).sl_modifiable_range());

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun setter_range_above_legacy_band_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_range(&cap, &mut tmpl, 1, 1, 21, true, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_range_min(), 1);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_range_max(), 21);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun setter_limits_in_band_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_limits(&cap, &mut tmpl, 1, 1, 1, 5, 10, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_casts_per_turn(), 1);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_casts_per_target(), 1);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_cooldown_turns(), 5);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_crit_rate(), 10);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun setter_limits_above_legacy_bands_succeed() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  mint(&mut sc, b"senshi", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut tmpl = sc.take_shared<SpellTemplate>();
  let ver = sc.take_shared<Version>();
  spell_template::set_level_limits(&cap, &mut tmpl, 1, 11, 12, 16, 1, B, P, &ver, sc.ctx());
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_casts_per_turn(), 11);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_casts_per_target(), 12);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_cooldown_turns(), 16);
  assert_eq!(spell_template::level_of(&tmpl, 1).sl_crit_rate(), 1);

  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ Full 12-class starter fixture ] ════════════════════════ ]

#[test]
/// Every one of the 12 classes admits its structurally valid starter spell at unlock 1.
fun twelve_class_starter_fixture_all_admitted() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let classes = vector[
    b"senshi", b"yajin", b"ikari", b"mori", b"tokei", b"shugo",
    b"yogen", b"rojin", b"shusen", b"tomoda", b"asobi", b"iyashi",
  ];
  let mut i = 0;
  while (i < classes.length()) {
    mint(&mut sc, *classes.borrow(i), 1);
    i = i + 1;
  };

  sc.next_tx(OWNER);
  let reg = sc.take_shared<SpellRegistry>();
  let mut j = 0;
  while (j < classes.length()) {
    assert!(spell_template::spell_exists(&reg, (*classes.borrow(j)).to_string(), 1, b"spell".to_string()));
    j = j + 1;
  };
  ts::return_shared(reg);
  sc.end();
}
