// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE RULED SPAWN MODEL (#1110 + #1111) at the PIPELINE level — `zone_gen`'s kernel tests pin the draw stream;
/// this file pins what the world's own tables do to it.
///
/// The measured defect: `eligible_mob_weights` zeroes a row whose eligibility level sits above the zone's
/// distance level cap, so at a world's own spawn box the roster collapses (9 of 20 live worlds admitted ≤2
/// species there; 7 of them ran at 100% one mob). The ruling replaces that filter rather than adding to it —
/// membership stops depending on distance, DIFFICULTY starts to. Both halves are asserted here on ONE world:
/// the legacy path still shows the monoculture (it must — in-flight zones replay it), and the format-3 path
/// shows the full roster at the same box.
#[test_only]
module aresrpg::spawn_ruled_model_tests;

use aresrpg::{admin::{Self, AdminCap}, version::{Self, Version}, world::{Self, World}, zone_comp};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const SEED: u64 = 16076161905812157559;
const TEAM_BOUND: u64 = 6;
/// Zone 487:487 intersects the centred 1000×1000 first-join box → progress 0, the world's easiest ring.
const SPAWN_ZX: u32 = 487;
/// Zone 500:488 sits past the authored 5000-block edge → progress 1000, the world's hardest ring.
const FAR_ZX: u32 = 500;

/// Three rows: a level-3 chicklet, a level-50 mid, a level-120 boss. Under the legacy level cap only the
/// chicklet is eligible at the spawn box — the monoculture, measured.
const ROW_CHICKLET: u16 = 0;
const ROW_MID: u16 = 1;
const ROW_BOSS: u16 = 2;

fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
}

/// A world with the three-row roster, 24 groups per zone, a flat 4-strong group band (so a derived ROSTER is 4
/// members long while the spawn-box SIZE cap clamps to 2 — the two are deliberately different numbers).
fun make(sc: &mut Scenario, boss_mask: vector<u16>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  world::create_world(&cap, &ver, SEED, b"verdant".to_string(), sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  let chicklet = object::id_from_address(@0xC1);
  let mid = object::id_from_address(@0xC2);
  let boss = object::id_from_address(@0xC3);
  world::add_mob_entry(&cap, &mut w, chicklet, 100, 4, 4, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, mid, 100, 4, 4, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, boss, 100, 4, 4, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, chicklet, 3, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, mid, 50, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, boss, 120, &ver, sc.ctx());
  world::set_density(&cap, &mut w, 24, 24, 1, 1, &ver, sc.ctx());
  if (!boss_mask.is_empty()) world::set_boss_mask(&cap, &mut w, boss_mask, &ver, sc.ctx());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
}

/// How many DISTINCT rows appear anywhere in a member-list derivation (primaries and members alike).
fun distinct_rows(members: &vector<vector<ID>>): u64 {
  let mut seen = vector<ID>[];
  let mut i = 0;
  while (i < members.length()) {
    let roster = &members[i];
    let mut j = 0;
    while (j < roster.length()) {
      if (!seen.contains(&roster[j])) seen.push_back(roster[j]);
      j = j + 1;
    };
    i = i + 1;
  };
  seen.length()
}

fun single_spec(roster: &vector<ID>): bool {
  let mut i = 1;
  while (i < roster.length()) {
    if (roster[i] != roster[0]) return false;
    i = i + 1;
  };
  true
}

#[test]
/// THE SUBSTITUTION, both halves on one world. LEGACY: at the spawn box the level cap admits exactly the
/// chicklet, and every one of the 24 groups is that same row — the monoculture the ruling kills. FORMAT 3: the
/// same zone, the same seed, the whole three-row roster present. Membership stopped depending on distance.
fun the_ruled_model_opens_the_whole_roster_at_the_spawn_box() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();

  // LEGACY (format 1/2) — untouched, and it must STAY the monoculture: in-flight zones replay this path, so a
  // change here would re-derive every live zone into fiction.
  let (_s, tpls, _x, _z, _sz, _g) = zone_comp::derive_mobs(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  assert_eq!(tpls.length(), 24);
  let chicklet = object::id_from_address(@0xC1);
  let mut i = 0;
  while (i < tpls.length()) { assert_eq!(tpls[i], chicklet); i = i + 1; };

  // FORMAT 3 — the ruled model: equal spawn, the full roster, at the very same box.
  let (sids, primaries, members, _mx, _mz, sizes, _mg, progress) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  assert_eq!(sids.length(), 24);
  assert_eq!(primaries.length(), 24);
  assert_eq!(distinct_rows(&members), 3); // all three authored rows reachable at progress 0
  assert_eq!(progress, 0);
  // and the ROSTER is the raw 4-strong roll while the spawn-box SIZE cap clamps the spawn count to 2 — the
  // stream must never bend to the live engine bound (`zones_view` derives ids with bound 1).
  let mut j = 0;
  while (j < members.length()) {
    assert_eq!(members[j].length(), 4);
    assert_eq!(sizes[j], 2);
    assert_eq!(members[j][0], primaries[j]); // members[0] IS the primary
    j = j + 1;
  };
  ts::return_shared(w);
  sc.end();
}

#[test]
/// DIFFICULTY IS WHAT DISTANCE MOVES NOW. The same world, two zones: the spawn box reports progress 0 and caps
/// groups at 2; the far ring reports the saturated 1000 and opens them to the full engine bound. `progress` is
/// returned by the derivation precisely so the fight door can plumb it into the engine's level draw.
fun distance_grades_difficulty_not_membership() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();

  let (_a, _b, near_members, _c, _d, near_sizes, _e, near_progress) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  let (_f, _g, far_members, _h, _i, far_sizes, _j, far_progress) =
    zone_comp::derive_mobs_members(&w, FAR_ZX, SPAWN_ZX + 1, SEED, TEAM_BOUND);
  assert_eq!(near_progress, 0);
  assert_eq!(far_progress, 1000);
  assert_eq!(near_sizes[0], 2); // §4 size cap near the spawn
  assert_eq!(far_sizes[0], 4); // the rolled 4 survives the full-bound cap out at the edge
  // membership does NOT narrow with distance any more — both rings reach the whole roster
  assert_eq!(distinct_rows(&near_members), 3);
  assert_eq!(distinct_rows(&far_members), 3);
  ts::return_shared(w);
  sc.end();
}

#[test]
/// THE BOSS FENCE, read off the world's own mask. With row 2 marked, no derived pack holds the boss plus
/// anything else, and the boss's own packs are single-spec — the content-QA finding that 9 boss rows sit in the
/// live pick tables, closed at the pipeline level rather than trusted from the kernel suite.
fun the_world_boss_mask_fences_the_member_draw() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[ROW_BOSS]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  let boss = object::id_from_address(@0xC3);

  let (_s, primaries, members, _x, _z, _sz, _g, _p) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  let mut boss_groups = 0;
  let mut i = 0;
  while (i < members.length()) {
    if (members[i].contains(&boss)) {
      assert!(single_spec(&members[i])); // fixture ① — a boss rides with nobody
      assert_eq!(primaries[i], boss); // and it can only be there as the PRIMARY
      boss_groups = boss_groups + 1;
    };
    i = i + 1;
  };
  assert!(boss_groups > 0); // a vacuous pass would prove nothing — the boss must actually be drawn
  ts::return_shared(w);
  sc.end();
}

#[test]
/// A MASK-ABSENT WORLD DEGRADES ALONG THE SAME PATH (fixture ③). No `boss_mask` dynamic field reads as an EMPTY
/// index vector, so the member table IS the pick table — the derivation is well-formed and identical to the one
/// an explicitly-empty mask produces. There is exactly one degradation path, never two.
fun a_mask_absent_world_matches_an_explicitly_empty_mask() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]); // never writes the DF
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  assert_eq!(world::boss_mask(&w), vector<u16>[]);
  let (absent_ids, _p, absent_members, _x, _z, _sz, _g, _pr) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  ts::return_shared(w);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_boss_mask(&cap, &mut w, vector<u16>[], &ver, sc.ctx()); // explicitly empty
  let (empty_ids, _p2, empty_members, _x2, _z2, _sz2, _g2, _pr2) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  assert_eq!(absent_ids, empty_ids);
  assert_eq!(absent_members, empty_members);
  assert!(!absent_members.is_empty());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// A row the mask names STOPS being drawable as a member the moment the mask is written — the same world, the
/// same seed, mask off then on. This is the fence's actual delta, isolated: without it the boss row appears
/// inside other species' packs.
fun writing_the_mask_removes_the_boss_from_other_packs() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  let boss = object::id_from_address(@0xC3);
  let (_a, unmasked_primaries, unmasked, _b, _c, _d, _e, _f) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  let mut riding = 0;
  let mut i = 0;
  while (i < unmasked.length()) {
    if (unmasked[i].contains(&boss) && unmasked_primaries[i] != boss) riding = riding + 1;
    i = i + 1;
  };
  assert!(riding > 0); // UNMASKED: the boss rides along in other packs — the defect the mask exists to close
  ts::return_shared(w);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_boss_mask(&cap, &mut w, vector<u16>[ROW_BOSS], &ver, sc.ctx());
  let (_g, masked_primaries, masked, _h, _i2, _j, _k, _l) =
    zone_comp::derive_mobs_members(&w, SPAWN_ZX, SPAWN_ZX, SEED, TEAM_BOUND);
  let mut still_riding = 0;
  let mut m = 0;
  while (m < masked.length()) {
    if (masked[m].contains(&boss) && masked_primaries[m] != boss) still_riding = still_riding + 1;
    m = m + 1;
  };
  assert_eq!(still_riding, 0); // MASKED: never again
  assert_eq!(ROW_CHICKLET + ROW_MID, 1); // the row constants are the table order this file authored
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}
