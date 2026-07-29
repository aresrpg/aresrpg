// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MOB_TEMPLATE tests: an admin-minted mob blueprint round-trips its authored content through the free getters
/// (min/max level, xp reward, loot table). Cap + version gated at mint; the getters are free reads the world's
/// mob entries and the fight-door spec mirror consume.
#[test_only]
module aresrpg::mob_template_tests;

use aresrpg::{admin::{Self, AdminCap}, mob_template::{Self, MobTemplate}, version::{Self, Version}};
use aresrpg_fight::mob;
use aresrpg_foundation::{spell, spell_effect};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const TEMP: address = @0xD;
const A_EAdminCapExpired: u64 = 101; // admin (mirrored; `location` disambiguates the aborting module)
const V_EWrongVersion: u64 = 101; // version (mirrored; `location` disambiguates the aborting module)
const MT_ETooManyLoot: u64 = 102; // mob_template ETooManyLoot (mirrored; `location` disambiguates)
const MT_ETooManySpells: u64 = 101; // mob_template ETooManySpells (mirrored; `location` disambiguates)

#[test]
fun mint_reflects_content_getters() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  // an empty spell kit + empty loot table (both within their bounds); resistances neutral (0-centered).
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 3, 9, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 250, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  assert_eq!(mob_template::template_id(&tmpl), tid);
  assert_eq!(mob_template::mob_min_level(&tmpl), 3);
  assert_eq!(mob_template::mob_max_level(&tmpl), 9);
  assert_eq!(mob_template::mob_xp_reward(&tmpl), 250);
  assert_eq!(mob_template::mob_loot(&tmpl).length(), 0); // empty loot table round-trips
  ts::return_shared(tmpl);
  sc.end();
}

// ╔════════════════ [ Burn ] ═════════════════════════════════════════════════ ]

#[test]
/// Mint a mob template, burn it (cap + version gated), and prove the shared object is GONE.
fun burn_deletes_the_shared_template() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 3, 9, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 250, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  mob_template::burn_mob_template(&cap, tmpl, &ver, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<MobTemplate>()); // the shared template no longer exists
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Burning on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `mint`.
fun burn_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  mob_template::burn_mob_template(&cap, tmpl, &ver, sc.ctx()); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// Burning with a temporary admin cap after its epoch aborts (`EAdminCapExpired`) before deletion.
fun burn_with_expired_temp_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &super_cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let temp_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  mob_template::burn_mob_template(&temp_cap, tmpl, &ver, sc.ctx()); // EAdminCapExpired
  abort
}

// ╔════════════════ [ set_stats — the live stat-tune retune door ] ══════════════════════════ ]

#[test]
/// The one atomic setter retunes the FULL tunable surface (base_hp, ap, mp, the `Stats` block, xp_reward) in
/// place while leaving the mint-only IDENTITY fields (min/max level) untouched. Cap + version gated at the door.
fun set_stats_retunes_the_tunable_surface() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 3, 9, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 250, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  // hp 50→80 · ap 6→7 · mp 3→4 · strength 0→12 · earth_res centered 40000 (+7232 resist) · xp 250→900
  mob_template::set_stats(
    &cap, &ver, &mut tmpl, 80, 7, 4,
    spell::new_stats(12, 0, 0, 0, 0, 0, 0, 32768, 32768, 40000, 32768), 900, sc.ctx(),
  );
  assert_eq!(mob_template::mob_base_hp(&tmpl), 80);
  assert_eq!(mob_template::mob_ap(&tmpl), 7);
  assert_eq!(mob_template::mob_mp(&tmpl), 4);
  assert_eq!(mob_template::mob_xp_reward(&tmpl), 900);
  let s = mob_template::mob_stats(&tmpl);
  assert_eq!(spell::stat_strength(&s), 12);
  assert_eq!(spell::stat_earth_resistance(&s), 40000);
  // identity/kit fields are mint-only — the setter never touches them
  assert_eq!(mob_template::mob_min_level(&tmpl), 3);
  assert_eq!(mob_template::mob_max_level(&tmpl), 9);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// A resistance-only retune APPLIES (earth_res 32768→32758, a -10 weakness) while every other field — carried
/// at its current value in the read-modify-write call — survives BYTE-IDENTICAL (required for the apply-script's read-modify-write round-trip).
fun set_stats_resistance_only_change_preserves_the_rest() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  // fire_res centered 32783 (+15), strength 5, hp 40, ap 6, mp 3, xp 120
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 2, 5, 40, 6, 3, 0,
    spell::new_stats(5, 0, 0, 0, 0, 0, 0, 32783, 32768, 32768, 32768), vector[], vector[], 120, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  // change ONLY earth_res (32768→32758); re-send the current value for hp/ap/mp/strength/fire_res/xp
  mob_template::set_stats(
    &cap, &ver, &mut tmpl, 40, 6, 3,
    spell::new_stats(5, 0, 0, 0, 0, 0, 0, 32783, 32768, 32758, 32768), 120, sc.ctx(),
  );
  let s = mob_template::mob_stats(&tmpl);
  assert_eq!(spell::stat_earth_resistance(&s), 32758); // the single changed field
  assert_eq!(mob_template::mob_base_hp(&tmpl), 40);
  assert_eq!(mob_template::mob_ap(&tmpl), 6);
  assert_eq!(mob_template::mob_mp(&tmpl), 3);
  assert_eq!(mob_template::mob_xp_reward(&tmpl), 120);
  assert_eq!(spell::stat_strength(&s), 5);
  assert_eq!(spell::stat_fire_resistance(&s), 32783);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Retuning on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `mint`/`burn`.
fun set_stats_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  mob_template::set_stats(&cap, &ver, &mut tmpl, 20, 7, 4, spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), 5, sc.ctx()); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// Retuning with a temporary admin cap after its epoch aborts (`EAdminCapExpired`) before any write.
fun set_stats_with_expired_temp_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &super_cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let temp_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  mob_template::set_stats(&temp_cap, &ver, &mut tmpl, 20, 7, 4, spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), 5, sc.ctx()); // EAdminCapExpired
  abort
}

// ╔════════════════ [ set_loot — the live loot-table retune door ] ═══════════════════════════ ]

#[test]
/// The additive setter REPLACES the whole loot table in place (the twin of `set_stats`) while leaving the
/// mint-only IDENTITY fields (name, min/max level) untouched. Cap + version gated at the door; each entry
/// round-trips its fields (item template, chance_bp, qty band) through the free `mob_loot` getter.
fun set_loot_replaces_the_loot_table() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  // mint with an EMPTY loot table (the ceremony's baseline: chain drops that never got authored)
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 3, 9, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 250, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  let item_a = object::id_from_address(@0xA11CE);
  let item_b = object::id_from_address(@0xB0B);
  mob_template::set_loot(
    &cap, &ver, &mut tmpl,
    vector[mob::new_loot_entry(item_a, 5000, 1, 3), mob::new_loot_entry(item_b, 300, 1, 1)],
    sc.ctx(),
  );
  let loot = mob_template::mob_loot(&tmpl);
  assert_eq!(loot.length(), 2); // empty table → 2 entries (the fill class)
  let e0 = loot.borrow(0);
  assert_eq!(mob::loot_entry_item_template(e0), item_a);
  assert_eq!(mob::loot_entry_chance_bp(e0), 5000);
  assert_eq!(mob::loot_entry_min_qty(e0), 1);
  assert_eq!(mob::loot_entry_max_qty(e0), 3);
  assert_eq!(mob::loot_entry_chance_bp(loot.borrow(1)), 300);
  // identity/kit fields stay mint-only — the setter never touches them
  assert_eq!(mob_template::mob_min_level(&tmpl), 3);
  assert_eq!(mob_template::mob_max_level(&tmpl), 9);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = MT_ETooManyLoot, location = mob_template)]
/// A loot table exceeding MAX_LOOT (16) aborts `ETooManyLoot` — the SAME bound `mint` asserts (mirrored, never
/// weaker), so the setter can never bake a table `mint` would have rejected.
fun set_loot_over_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  let mut loot = vector[];
  let mut i = 0;
  while (i < 17) { loot.push_back(mob::new_loot_entry(object::id_from_address(@0x1), 100, 1, 1)); i = i + 1 };
  mob_template::set_loot(&cap, &ver, &mut tmpl, loot, sc.ctx()); // ETooManyLoot (17 > 16)
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Retuning loot on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `set_stats`.
fun set_loot_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  mob_template::set_loot(&cap, &ver, &mut tmpl, vector[mob::new_loot_entry(object::id_from_address(@0x1), 100, 1, 1)], sc.ctx()); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// Retuning loot with a temporary admin cap after its epoch aborts (`EAdminCapExpired`) before any write.
fun set_loot_with_expired_temp_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &super_cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let temp_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  mob_template::set_loot(&temp_cap, &ver, &mut tmpl, vector[mob::new_loot_entry(object::id_from_address(@0x1), 100, 1, 1)], sc.ctx()); // EAdminCapExpired
  abort
}

// ╔════════════════ [ set_spells — the live spell-kit correction door ] ══════════════════════ ]

/// The signed-effect centering (#904 final ruling), mirrored: ALTER_STAT (9) and ALTER_RESIST (11) store their
/// delta CENTERED — `value = 32768 + delta` — and the sign lives in the VALUE, never in `FLAG_NEGATIVE`. The
/// pinned constant and the decode below mirror `engine/sources/participant.move:295-301` (`SIGNED_SHIFT` /
/// `alter_delta`), which is `public(package)` in `aresrpg_fight` and so unreachable from this package's tests.
/// A drift in the mirror reds against the engine's own `centered_value_round_trips_through_alter_delta`.
#[test_only]
const SIGNED_SHIFT: u64 = 32768;

/// DECODE a signed alter row the way the fold does → (magnitude, negative).
#[test_only]
fun alter_delta(e: &spell_effect::Effect): (u64, bool) {
  let v = spell_effect::value(e);
  if (v >= SIGNED_SHIFT) (v - SIGNED_SHIFT, false) else (SIGNED_SHIFT - v, true)
}

/// One `SpellLevel` carrying a single ALTER_STAT effect of the raw stored `value` — the bytes the correction
/// door writes on chain, so every call site spells its authoring arithmetic (`SIGNED_SHIFT + 25` for a `+25`
/// buff, `SIGNED_SHIFT - 15` for a `−15` debuff) rather than a bare magnitude.
#[test_only]
fun kit_level(value: u64): spell_effect::SpellLevel {
  spell_effect::new_spell_level(
    1, 3, 1, 6, false, false, true, false, 1, 1, 0, 100, false, vector[], vector[],
    vector[spell_effect::new_effect(
      spell_effect::k_alter_stat(), spell::el_none(), value, spell_effect::shape_point(), 0,
      spell_effect::tf_not_team(), 100, 3, spell_effect::stat_strength(), 0, spell_effect::phase_on_enter(),
    )],
    vector[],
  )
}

#[test]
/// The additive setter REPLACES the whole spell kit in place (the twin of `set_loot`) while leaving the
/// mint-only IDENTITY fields (name, min/max level) and the sibling `loot` table untouched. Cap + version gated
/// at the door; the re-pushed kit round-trips through the free `mob_spells` getter AND back through the fold's
/// own decode — the #904 final ruling's on-chain half: what the door writes is CENTERED (`32768 + delta`), and
/// folding those bytes yields the authored y26, sign and all. Asserting the storage bytes alone would stay
/// green under the retired magnitude dialect, where an authored `+25` folds as a `−32743` debuff.
fun set_spells_replaces_the_spell_kit() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  // mint a live-shaped kit (a centered `+25`, the encoding the census found and the ruling ratified) + a loot
  // entry to guard
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 3, 9, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[kit_level(SIGNED_SHIFT + 25)],
    vector[mob::new_loot_entry(object::id_from_address(@0xA11CE), 5000, 1, 3)], 250, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  assert_eq!(spell_effect::value(mob_template::mob_spells(&tmpl).borrow(0).sl_effects().borrow(0)), 32793);
  // the correction driver re-pushes the COMPLETE kit, wholesale — here a 3-level kit: two buffs and a debuff
  mob_template::set_spells(
    &cap, &ver, &mut tmpl,
    vector[kit_level(SIGNED_SHIFT + 25), kit_level(SIGNED_SHIFT + 40), kit_level(SIGNED_SHIFT - 15)], sc.ctx(),
  );
  let spells = mob_template::mob_spells(&tmpl);
  assert_eq!(spells.length(), 3); // 1 level → 3 (the wholesale-replace class)
  assert_eq!(spell_effect::value(spells.borrow(0).sl_effects().borrow(0)), 32793); // stored CENTERED, not `25`
  // …and the stored bytes fold back to what the author meant — the tooth a storage round-trip cannot grow
  let (amount, negative) = alter_delta(spells.borrow(0).sl_effects().borrow(0));
  assert_eq!(amount, 25);
  assert!(!negative); // a buff: value above the shift
  let (amount, negative) = alter_delta(spells.borrow(1).sl_effects().borrow(0));
  assert_eq!(amount, 40);
  assert!(!negative);
  // the debuff proves the SIGN comes from the value alone — its `flags` are 0, FLAG_NEGATIVE clear
  let (amount, negative) = alter_delta(spells.borrow(2).sl_effects().borrow(0));
  assert_eq!(amount, 15);
  assert!(negative);
  assert_eq!(spell_effect::flags(spells.borrow(2).sl_effects().borrow(0)), 0);
  assert_eq!(spells.borrow(0).sl_ap_cost(), 3); // the level's non-effect surface round-trips too
  // identity fields and the sibling loot table stay untouched — the setter only replaces `spells`
  assert_eq!(mob_template::mob_min_level(&tmpl), 3);
  assert_eq!(mob_template::mob_max_level(&tmpl), 9);
  assert_eq!(mob_template::mob_loot(&tmpl).length(), 1);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// #1406's sanctioned boss shape: both authoring doors admit all five SpellLevels and store the fifth row.
/// This is the boundary value; the six-row refusal below proves the bounded-compute guard remains armed.
fun five_spell_kit_is_admitted_by_mint_and_setter() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut five = vector[];
  let mut i = 0;
  while (i < 5) { five.push_back(kit_level(SIGNED_SHIFT + i)); i = i + 1 };
  let tid = mob_template::mint(
    &cap, &ver, b"boss".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), five, vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  assert_eq!(mob_template::mob_spells(&tmpl).length(), 5);
  let mut replacement = vector[];
  let mut i = 0;
  while (i < 5) { replacement.push_back(kit_level(SIGNED_SHIFT + 10 + i)); i = i + 1 };
  mob_template::set_spells(&cap, &ver, &mut tmpl, replacement, sc.ctx());
  let stored = mob_template::mob_spells(&tmpl);
  assert_eq!(stored.length(), 5);
  assert_eq!(spell_effect::value(stored.borrow(4).sl_effects().borrow(0)), SIGNED_SHIFT + 14);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = MT_ETooManySpells, location = mob_template)]
/// A kit exceeding MAX_SPELLS (5) aborts `ETooManySpells` — the SAME bound `mint` asserts (mirrored, never
/// weaker), so the correction door can never bake a kit `mint` would have rejected.
fun set_spells_over_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  let mut spells = vector[];
  let mut i = 0;
  while (i < 6) { spells.push_back(kit_level(SIGNED_SHIFT + 25)); i = i + 1 };
  mob_template::set_spells(&cap, &ver, &mut tmpl, spells, sc.ctx()); // ETooManySpells (6 > 5)
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Correcting a kit on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `set_loot`.
fun set_spells_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  version::test_set_stale(&mut ver);
  mob_template::set_spells(&cap, &ver, &mut tmpl, vector[kit_level(SIGNED_SHIFT + 25)], sc.ctx()); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
/// Correcting a kit with a temporary admin cap after its epoch aborts (`EAdminCapExpired`) before any write —
/// the door is CAP-GATED: no capless caller can ever reach the kit.
fun set_spells_with_expired_temp_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &super_cap, &ver, b"rat".to_string(), 1, 2, 10, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 1, sc.ctx(),
  );
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(super_cap);

  sc.next_epoch(TEMP);
  let temp_cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut tmpl = ts::take_shared_by_id<MobTemplate>(&sc, tid);
  mob_template::set_spells(&temp_cap, &ver, &mut tmpl, vector[kit_level(SIGNED_SHIFT + 25)], sc.ctx()); // EAdminCapExpired
  abort
}
