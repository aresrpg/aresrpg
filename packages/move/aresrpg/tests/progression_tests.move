// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Progression math tests: level_from_xp edges (1, threshold-exact, 199↔200, clamp), the 5-stat/1-spell grant
/// per level, xp accrual with multiplier + cap-discard (and the frozen-config refusal), and the ANNEX §4c
/// max-HP formula off the GameConfig class rows.
#[test_only]
module aresrpg::progression_tests;

use aresrpg::{admin::{Self, AdminCap}, config::{Self, GameConfig}, progression, version::{Self, Version}};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;

const C_ENotEnabled: u64 = 101; // config

const IKARI: u64 = 2; // base HP 120
const YOGEN: u64 = 6; // base HP 30

fun begin(): Scenario {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  sc.next_tx(OWNER);
  sc
}

// ╔════════════════ [ Level from xp (no config needed) ] ═════════════════════ ]

#[test]
fun level_from_xp_edges() {
  assert_eq!(progression::level_from_xp(0), 1); // level 1 at 0 xp
  assert_eq!(progression::level_from_xp(109), 1); // just below the level-2 threshold
  assert_eq!(progression::level_from_xp(110), 2); // exactly the level-2 threshold
  assert_eq!(progression::level_from_xp(111), 2); // just past it, still level 2
  assert_eq!(progression::level_from_xp(7_407_231_999), 199); // one below the level-200 threshold
  assert_eq!(progression::level_from_xp(7_407_232_000), 200); // exactly the max-level threshold
  assert_eq!(progression::level_from_xp(999_999_999_999), 200); // oversized xp clamps, never aborts
}

// ╔════════════════ [ Level-up grants ] ══════════════════════════════════════ ]

#[test]
fun points_for_level_range_grants() {
  let (s0, p0) = progression::points_for_level_range(1, 1);
  assert_eq!(s0, 0); assert_eq!(p0, 0); // no level gained
  let (s1, p1) = progression::points_for_level_range(1, 2);
  assert_eq!(s1, 5); assert_eq!(p1, 1); // one level from 2 → 5 stat / 1 spell
  let (s9, p9) = progression::points_for_level_range(1, 10);
  assert_eq!(s9, 45); assert_eq!(p9, 9);
  let (s5, p5) = progression::points_for_level_range(50, 55);
  assert_eq!(s5, 25); assert_eq!(p5, 5);
  let (sd, pd) = progression::points_for_level_range(10, 4); // to < from → zero, never underflows
  assert_eq!(sd, 0); assert_eq!(pd, 0);
}

// ╔════════════════ [ XP accrual: multiplier + cap-discard + frozen refusal ] ═ ]

#[test]
fun xp_add_multiplier_and_below_cap() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());

  // default 1.00× multiplier, default cap (level 200) → gain is untouched
  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 0, 110), 110);
  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 500, 150), 650); // level-3 threshold

  // 2.00× multiplier doubles the gain
  config::set_xp_multiplier(&cap, &mut cfg, 200, &ver, sc.ctx());
  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 0, 100), 200);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

#[test]
fun xp_add_discards_at_cap() {
  let mut sc = begin();
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  // cap the reachable level at 2 → xp threshold 110; earning past it is DISCARDED, not banked
  config::set_max_reachable_level(&cap, &mut cfg, 2, &ver, sc.ctx());

  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 100, 5), 105); // still below cap
  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 100, 1_000), 110); // overflow discarded to the cap
  assert_eq!(progression::xp_add_with_cap_discard(&cfg, 110, 500), 110); // already at cap → all discarded

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = C_ENotEnabled, location = config)]
fun xp_add_refuses_when_frozen() {
  let sc = begin();
  let cfg = sc.take_shared<GameConfig>(); // ships dark (enabled == false)
  progression::xp_add_with_cap_discard(&cfg, 0, 100); // frozen game → abort
  abort 0
}

// ╔════════════════ [ Max HP (ANNEX §4c) ] ══════════════════════════════════ ]

#[test]
fun max_hp_formula() {
  let sc = begin();
  let cfg = sc.take_shared<GameConfig>();

  // IKARI base 120: level 1 no vit = base; growth is +5/level from level 2; vitality adds flat.
  assert_eq!(progression::max_hp(cfg.class_row(IKARI), 1, 0), 120);
  assert_eq!(progression::max_hp(cfg.class_row(IKARI), 10, 0), 165); // 120 + 9*5
  assert_eq!(progression::max_hp(cfg.class_row(IKARI), 10, 50), 215); // + vitality
  assert_eq!(progression::max_hp(cfg.class_row(YOGEN), 1, 0), 30); // lowest-HP class, level 1

  ts::return_shared(cfg);
  sc.end();
}

// ╔════════════════ [ Lazy HP regen (ANNEX §5.4 — pure; no scenario) ] ═══════ ]
// Level 1, wisdom 0 ⇒ rate num = 50 + 6 = 56 over denom 75000 ms ⇒ 1 HP every 75000/56 ≈ 1339.29 ms.

#[test]
/// THE remainder-carry proof: two SUB-unit ticks must sum to 1 HP, not starve to 0. A partial tick that
/// re-stamped to `now` would discard its fraction; carrying (stamp unchanged) preserves it.
fun regen_remainder_carries_across_two_slow_ticks() {
  // tick 1 — 700 ms < 1339 ms/HP ⇒ 0 whole HP; the stamp MUST stay at 0 (carry, not re-stamped to 700)
  let (hp1, st1) = progression::regen_hp(0, 0, 100, 1, 0, 700);
  assert_eq!(hp1, 0);
  assert_eq!(st1, 0);
  // tick 2 — from the carried stamp, another 700 ms (now 1400 total) ⇒ the two fractions sum to 1 whole HP.
  // Had tick 1 re-stamped to 700, tick 2's 700 ms would again yield 0 — starved. It does not.
  let (hp2, _st2) = progression::regen_hp(hp1, st1, 100, 1, 0, 1_400);
  assert_eq!(hp2, 1);
}

#[test]
/// The consumed-time carry: 1 HP consumes 1339 ms, so a 1459 ms span banks 1 HP and leaves the 120 ms remainder ON
/// the clock (stamp advances to 1339, NOT to 1459).
fun regen_consumes_only_whole_hp_time() {
  let (hp, st) = progression::regen_hp(0, 0, 100, 1, 0, 1_459);
  assert_eq!(hp, 1);
  assert_eq!(st, 1_339); // 1 HP = 1339 ms; the leftover 120 ms is carried, never discarded
}

#[test]
/// A 0-HP character regenerates normally (§5.4: only FIGHTS are gated at 0 HP, not regen). 3000 ms → 2 HP.
fun regen_from_zero_hp() {
  let (hp, _st) = progression::regen_hp(0, 0, 100, 1, 0, 3_000); // 3000×56/75000 = 2.24 → 2
  assert_eq!(hp, 2);
}

#[test]
/// Caps at max HP and stamps `now` (no overheal banked); an already-full character is a no-op that stamps `now`.
fun regen_caps_at_max() {
  let (hp, st) = progression::regen_hp(98, 0, 100, 1, 0, 1_000_000); // plenty of time → pinned to max
  assert_eq!(hp, 100);
  assert_eq!(st, 1_000_000);
  let (hp2, st2) = progression::regen_hp(100, 500, 100, 1, 0, 9_999); // already full
  assert_eq!(hp2, 100);
  assert_eq!(st2, 9_999);
}

#[test]
/// The rate matches the annex formula `2.0 + (level×0.4 + wisdom/7.5)/5` HP/s, over exactly 1 s (1000 ms).
fun regen_rate_matches_annex() {
  let (l50, _) = progression::regen_hp(0, 0, 10_000, 50, 0, 1000); // 0.667 + (50×0.4)/5 = 4.667 → floor 4
  assert_eq!(l50, 4);
  let (wis, _) = progression::regen_hp(0, 0, 10_000, 1, 75, 1000); // 0.667 + (0.4 + 75/7.5)/5 = 2.747 → floor 2
  assert_eq!(wis, 2);
}

#[test]
/// No elapsed time (same block) and clock skew (now < stamp) both leave HP + stamp untouched.
fun regen_no_time_is_noop() {
  let (hp, st) = progression::regen_hp(50, 1000, 100, 1, 0, 1000); // now == stamp
  assert_eq!(hp, 50);
  assert_eq!(st, 1000);
  let (hp2, st2) = progression::regen_hp(50, 1000, 100, 1, 0, 999); // clock skew (now < stamp)
  assert_eq!(hp2, 50);
  assert_eq!(st2, 1000);
}
