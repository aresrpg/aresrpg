/// MOB_TEMPLATE tests: an admin-minted mob blueprint round-trips its authored content through the free getters
/// (min/max level, xp reward, loot table). Cap + version gated at mint; the getters are free reads the world's
/// mob entries and the fight-door spec mirror consume.
#[test_only]
module aresrpg::mob_template_tests;

use aresrpg::{admin::{Self, AdminCap}, mob_template::{Self, MobTemplate}, version::{Self, Version}};
use aresrpg_fight::mob;
use aresrpg_foundation::spell;
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const TEMP: address = @0xD;
const A_EAdminCapExpired: u64 = 101; // admin (mirrored; `location` disambiguates the aborting module)
const V_EWrongVersion: u64 = 101; // version (mirrored; `location` disambiguates the aborting module)
const MT_ETooManyLoot: u64 = 102; // mob_template ETooManyLoot (mirrored; `location` disambiguates)

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
