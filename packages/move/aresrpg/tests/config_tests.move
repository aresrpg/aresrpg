// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GameConfig tests: init defaults land the ratified values (§17.20/.26/.31); dark authoring works while
/// the global switch is off; every clamped setter COERCES out-of-band inputs to the band edge (never stores an
/// out-of-band value); the class-index setters ABORT on a bad id (indices can't be clamped); an expired temp
/// cap and a stale version both block authoring; the global freeze toggles and `assert_enabled` guards it.
#[test_only]
module aresrpg::config_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  config::{Self, GameConfig},
  version::{Self, Version}
};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xD;

// Abort-code mirrors (value + origin module for `location =`).
const C_ENotEnabled: u64 = 101; // config
const C_EBadClass: u64 = 102; // config
const C_EDomainDisabled: u64 = 103; // config
const A_EAdminCapExpired: u64 = 101; // admin
const V_EWrongVersion: u64 = 101; // version

// Class ids (SPEC §3 order) referenced by tests.
const IKARI: u64 = 2; // base HP 120
const YOGEN: u64 = 6; // base HP 30

/// Stand the package up (version + admin + config) and land the caller on a fresh tx holding nothing.
fun begin(): Scenario {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  sc.next_tx(OWNER);
  sc
}

// ╔════════════════ [ Defaults ] ═════════════════════════════════════════════ ]

#[test]
fun init_defaults_match_spec() {
  let sc = begin();
  let cfg = sc.take_shared<GameConfig>();

  assert!(!cfg.is_enabled()); // ships dark (global switch off)
  // §17.20
  assert_eq!(cfg.xp_multiplier(), 100);
  assert_eq!(cfg.loot_multiplier(), 100);
  assert_eq!(cfg.max_reachable_level(), 200);
  // §17.26
  assert_eq!(cfg.turn_duration_ms(), 45_000);
  assert_eq!(cfg.placement_ms(), 60_000);
  assert_eq!(cfg.claim_window_epochs(), 7);
  assert_eq!(cfg.archimob_bp(), 50);
  assert_eq!(cfg.aging_bp_per_hour(), 100);
  assert_eq!(cfg.aging_cap_bp(), 10_000);
  assert_eq!(cfg.pvp_level_gate(), 10);
  assert_eq!(cfg.listing_level_gate(), 30);
  assert_eq!(cfg.team_size_bound(), 6);
  // §17.31 rows
  assert_eq!(config::class_count(), 12);
  assert_eq!(config::base_hp(cfg.class_row(IKARI)), 120);
  assert_eq!(config::base_ap(cfg.class_row(IKARI)), 6);
  assert_eq!(config::base_mp(cfg.class_row(IKARI)), 3);
  assert_eq!(config::base_hp(cfg.class_row(YOGEN)), 30);

  ts::return_shared(cfg);
  sc.end();
}

// ╔════════════════ [ Domain mask + reclaim-cooldown dial ] ══════════════════ ]

#[test]
/// Domain-bit accessors + the reclaim-cooldown dial: a fresh config ships ALL domains on (so `domains()` carries
/// the dungeon + market bits), the reclaim cooldown starts at its placeholder default, and the clamped setter
/// updates it while dark (an over-band input pins to the 24h ceiling).
fun domain_mask_and_reclaim_cooldown() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();

  let mask = config::domains(&cfg); // ships all-on
  assert_eq!(mask & config::domain_dungeon(), config::domain_dungeon());
  assert_eq!(mask & config::domain_market(), config::domain_market());

  assert_eq!(cfg.reclaim_cooldown_ms(), 60_000); // DEFAULT_RECLAIM_MS placeholder
  config::set_reclaim_cooldown_ms(&cap, &mut cfg, 5_000, &ver, sc.ctx());
  assert_eq!(cfg.reclaim_cooldown_ms(), 5_000);
  config::set_reclaim_cooldown_ms(&cap, &mut cfg, 999_999_999, &ver, sc.ctx()); // over 24h → clamps
  assert_eq!(cfg.reclaim_cooldown_ms(), 86_400_000); // RECLAIM_MS_MAX

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ In-band setter + dark authoring ] ══════════════════════ ]

#[test]
fun setter_in_band_updates_while_dark() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();

  // enabled == false here → proves setters gate on assert_latest, NOT assert_enabled (author while dark).
  config::set_xp_multiplier(&cap, &mut cfg, 250, &ver, sc.ctx());
  assert_eq!(cfg.xp_multiplier(), 250);
  config::set_max_reachable_level(&cap, &mut cfg, 150, &ver, sc.ctx());
  assert_eq!(cfg.max_reachable_level(), 150);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// The admin can crank xp/loot to x1000 (bot test suite). Setting EXACTLY the max (100_000
/// hundredths = 1000×) succeeds unclamped, and any value above it pins to the ceiling — for BOTH multipliers.
fun xp_loot_multiplier_reaches_x1000_and_clamps_above() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();

  config::set_xp_multiplier(&cap, &mut cfg, 100_000, &ver, sc.ctx()); // exactly x1000
  assert_eq!(cfg.xp_multiplier(), 100_000);
  config::set_loot_multiplier(&cap, &mut cfg, 100_000, &ver, sc.ctx());
  assert_eq!(cfg.loot_multiplier(), 100_000);
  config::set_xp_multiplier(&cap, &mut cfg, 100_001, &ver, sc.ctx()); // one above → clamps to the ceiling
  assert_eq!(cfg.xp_multiplier(), 100_000);
  config::set_loot_multiplier(&cap, &mut cfg, 9_999_999, &ver, sc.ctx());
  assert_eq!(cfg.loot_multiplier(), 100_000);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ Clamps — over-range and under-range both PIN to the band edge ] ═ ]

#[test]
fun scalar_dials_clamp_both_edges() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();

  // multipliers: band 100..100_000 (1×..1000× — testnet-only boost, 2026-07-11)
  config::set_xp_multiplier(&cap, &mut cfg, 500_000, &ver, sc.ctx());
  assert_eq!(cfg.xp_multiplier(), 100_000); // over-range pins to the x1000 ceiling
  config::set_xp_multiplier(&cap, &mut cfg, 1, &ver, sc.ctx());
  assert_eq!(cfg.xp_multiplier(), 100);
  config::set_loot_multiplier(&cap, &mut cfg, 999_999, &ver, sc.ctx());
  assert_eq!(cfg.loot_multiplier(), 100_000);
  // max level: band 1..200
  config::set_max_reachable_level(&cap, &mut cfg, 9_999, &ver, sc.ctx());
  assert_eq!(cfg.max_reachable_level(), 200);
  config::set_max_reachable_level(&cap, &mut cfg, 0, &ver, sc.ctx());
  assert_eq!(cfg.max_reachable_level(), 1);
  // turn / placement (ms bands)
  config::set_turn_duration_ms(&cap, &mut cfg, 1, &ver, sc.ctx());
  assert_eq!(cfg.turn_duration_ms(), 5_000);
  config::set_turn_duration_ms(&cap, &mut cfg, 9_999_999, &ver, sc.ctx());
  assert_eq!(cfg.turn_duration_ms(), 300_000);
  config::set_placement_ms(&cap, &mut cfg, 0, &ver, sc.ctx());
  assert_eq!(cfg.placement_ms(), 5_000);
  // claim window: 1..365
  config::set_claim_window_epochs(&cap, &mut cfg, 0, &ver, sc.ctx());
  assert_eq!(cfg.claim_window_epochs(), 1);
  config::set_claim_window_epochs(&cap, &mut cfg, 100_000, &ver, sc.ctx());
  assert_eq!(cfg.claim_window_epochs(), 365);
  // basis-point dials: 0..10_000
  config::set_archimob_bp(&cap, &mut cfg, 50_000, &ver, sc.ctx());
  assert_eq!(cfg.archimob_bp(), 10_000);
  config::set_aging_bp_per_hour(&cap, &mut cfg, 999_999, &ver, sc.ctx());
  assert_eq!(cfg.aging_bp_per_hour(), 10_000);
  config::set_aging_cap_bp(&cap, &mut cfg, 9_999_999, &ver, sc.ctx());
  assert_eq!(cfg.aging_cap_bp(), 100_000); // AGING_CAP_MAX
  // team size: ceiling is the hard engine bound 6
  config::set_team_size_bound(&cap, &mut cfg, 100, &ver, sc.ctx());
  assert_eq!(cfg.team_size_bound(), 6);
  config::set_team_size_bound(&cap, &mut cfg, 0, &ver, sc.ctx());
  assert_eq!(cfg.team_size_bound(), 1);
  // level gates: 1..200
  config::set_pvp_level_gate(&cap, &mut cfg, 9_999, &ver, sc.ctx());
  assert_eq!(cfg.pvp_level_gate(), 200);
  config::set_listing_level_gate(&cap, &mut cfg, 0, &ver, sc.ctx());
  assert_eq!(cfg.listing_level_gate(), 1);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun class_rows_clamp_each_field() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();

  // hp band 10..300
  config::set_class_base_hp(&cap, &mut cfg, IKARI, 5, &ver, sc.ctx());
  assert_eq!(config::base_hp(cfg.class_row(IKARI)), 10);
  config::set_class_base_hp(&cap, &mut cfg, IKARI, 9_999, &ver, sc.ctx());
  assert_eq!(config::base_hp(cfg.class_row(IKARI)), 300);
  // ap band 1..12
  config::set_class_base_ap(&cap, &mut cfg, IKARI, 0, &ver, sc.ctx());
  assert_eq!(config::base_ap(cfg.class_row(IKARI)), 1);
  config::set_class_base_ap(&cap, &mut cfg, IKARI, 99, &ver, sc.ctx());
  assert_eq!(config::base_ap(cfg.class_row(IKARI)), 12);
  // mp band 1..6
  config::set_class_base_mp(&cap, &mut cfg, IKARI, 0, &ver, sc.ctx());
  assert_eq!(config::base_mp(cfg.class_row(IKARI)), 1);
  config::set_class_base_mp(&cap, &mut cfg, IKARI, 99, &ver, sc.ctx());
  assert_eq!(config::base_mp(cfg.class_row(IKARI)), 6);
  // an in-band class edit sticks, and does NOT bleed into a neighbor class
  config::set_class_base_hp(&cap, &mut cfg, IKARI, 200, &ver, sc.ctx());
  assert_eq!(config::base_hp(cfg.class_row(IKARI)), 200);
  assert_eq!(config::base_hp(cfg.class_row(YOGEN)), 30);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ Global freeze toggle ] ═════════════════════════════════ ]

#[test]
fun global_enable_toggles_and_guards() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();

  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  assert!(cfg.is_enabled());
  cfg.assert_enabled(); // does not abort
  config::set_enabled(&cap, &mut cfg, false, sc.ctx());
  assert!(!cfg.is_enabled());

  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ Adversarial: bad index / expired cap / stale version / frozen read ] ═ ]

#[test, expected_failure(abort_code = C_EBadClass, location = config)]
fun class_setter_bad_index_aborts() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_class_base_hp(&cap, &mut cfg, 12, 100, &ver, sc.ctx()); // 12 == CLASS_COUNT, out of range
  abort 0
}

#[test, expected_failure(abort_code = C_EBadClass, location = config)]
fun class_row_getter_bad_index_aborts() {
  let sc = begin();
  let cfg = sc.take_shared<GameConfig>();
  let _ = cfg.class_row(99);
  abort 0
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
fun expired_temp_cap_setter_aborts() {
  let mut sc = begin();
  let super_cap = sc.take_from_sender<AdminCap>();
  // Forge a temp cap stamped to a NON-current epoch (5) — the scenario runs at epoch 0, so `verify` rejects it.
  admin::test_mint_temp_at(&super_cap, 5, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);

  sc.next_tx(TEMP);
  let temp_cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_xp_multiplier(&temp_cap, &mut cfg, 200, &ver, sc.ctx()); // expired cap → abort
  abort 0
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun stale_version_setter_aborts() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let mut ver = sc.take_shared<Version>();
  ver.test_set_stale(); // simulate an un-bumped upgrade
  config::set_xp_multiplier(&cap, &mut cfg, 200, &ver, sc.ctx()); // stale version → abort
  abort 0
}

#[test, expected_failure(abort_code = C_ENotEnabled, location = config)]
fun assert_enabled_refuses_when_frozen() {
  let sc = begin();
  let cfg = sc.take_shared<GameConfig>();
  cfg.assert_enabled(); // ships dark → abort
  abort 0
}

// ╔════════════════ [ Per-domain kill switch (S-46) ] ════════════════════════ ]

#[test]
/// The forgemagie domain bit + the per-domain kill switch: a fresh config ships the forgemagie domain ON (its bit
/// is set in the mask and `assert_domain` passes); flipping it off darks ONLY that bit (the mask clears it), and
/// flipping it back on restores it — the whole rest of the game keeps running either way.
fun domain_forgemagie_toggle() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();

  let fm = config::domain_forgemagie();
  assert_eq!(fm, 128); // DOMAIN_FORGEMAGIE
  assert_eq!(config::domains(&cfg) & fm, fm); // ships all-on
  cfg.assert_domain(fm); // live → does not abort

  config::set_domain_enabled(&cap, &mut cfg, fm, false, sc.ctx()); // dark the forge domain
  assert_eq!(config::domains(&cfg) & fm, 0); // bit cleared, siblings untouched
  config::set_domain_enabled(&cap, &mut cfg, fm, true, sc.ctx()); // restore
  assert_eq!(config::domains(&cfg) & fm, fm);
  cfg.assert_domain(fm); // live again

  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = C_EDomainDisabled, location = config)]
/// The kill-switch teeth: once a domain is darked, `assert_domain` on that bit aborts (its entry doors refuse).
fun assert_domain_refuses_when_darked() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_domain_enabled(&cap, &mut cfg, config::domain_forgemagie(), false, sc.ctx());
  cfg.assert_domain(config::domain_forgemagie()); // darked → abort
  abort 0
}
