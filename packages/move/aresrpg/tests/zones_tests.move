// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONES tests: world MEMBERSHIP (first join rolls a spawn + inits the checkpoint; rejoin RESTORES it — never a
/// re-roll or teleport-home; required-level gate) and ZONE DISCOVERY (search proves the claimed STANDING POSITION:
/// travel-verified from the checkpoint and the checkpoint ADVANCES there — the S-71 walked-to-zone y16; a
/// too-far/too-fast claim aborts; a re-search before TTL aborts; a re-search after TTL RE-ROLLS the zone — new
/// seed, bitmaps reset (the search-cost rework's successor of the live-row top-up); a frozen game refuses). Under
/// the rework a search stores ONLY {seed, bitmaps} — every spawn getter DERIVES (zones_view/zone_comp), and the
/// cost-shape test below pins that nothing per-mob is ever stored. Discovery/join run through the deterministic
/// `*_for_testing` doors (the real `&Random` entries share the exact body).
#[test_only]
module aresrpg::zones_tests;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, test_world, version::{Self, Version}, world::{Self, World}, zone_comp, zones, zones_view};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, random::{Self, Random}, test_scenario::{Self as ts, Scenario}};

// ── mirrored error values ──
const ELevelTooLow: u64 = 101; // zones
const ETravelTooFar: u64 = 102; // checkpoint (search travel-verifies the claimed position)
const EZoneFresh: u64 = 105; // zones
const ENodeEmpty: u64 = 107; // zones (double-harvest of one derived cell)
const EBadDrainInput: u64 = 109; // zones (drain_zones: mismatched zx/zy list lengths)
const C_ENotEnabled: u64 = 101; // config (global freeze)
const V_EWrongVersion: u64 = 101; // version

// ╔════════════════ [ Local drivers ] ════════════════════════════════════════ ]

fun do_join(sc: &mut Scenario, who: address, cid: ID, now: u64) {
  sc.next_tx(who);
  let w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  zones::join_for_testing(&w, &mut k, &pkcap, cid, &cfg, &ver, &clk);
  clk.destroy_for_testing();
  ts::return_shared(w);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

fun do_search(sc: &mut Scenario, who: address, cid: ID, x: u32, z: u32, now: u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  zones::search_for_testing(&mut w, &mut k, &pkcap, cid, x, z, &cfg, &ver, &clk);
  clk.destroy_for_testing();
  ts::return_shared(w);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

/// The checkpoint a character holds for the world (by value).
fun cp_of(sc: &mut Scenario, who: address, cid: ID, wid: ID): world::Checkpoint {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  cp
}

/// The character's checkpoint POSITION (what a search now claims + travel-proves).
fun cp_pos(sc: &mut Scenario, who: address, cid: ID, wid: ID): (u32, u32) {
  let cp = cp_of(sc, who, cid, wid);
  (world::x(&cp), world::z(&cp))
}

/// The zone the character currently occupies (derived from its checkpoint).
fun occupied_zone(sc: &mut Scenario, who: address, cid: ID, wid: ID): (u32, u32) {
  let cp = cp_of(sc, who, cid, wid);
  sc.next_tx(who);
  let w = sc.take_shared<World>();
  let (zx, zy) = world::zone_of(&w, world::x(&cp), world::z(&cp));
  ts::return_shared(w);
  (zx, zy)
}

fun standard_world(sc: &mut Scenario): (ID, ID) {
  test_world::boot(sc);
  let tid = test_world::make_resource_template(sc);
  let wid = test_world::make_world(sc, tid, 0, 1); // FARMER (job 0), tier 1
  (wid, tid)
}

// ╔════════════════ [ Join ] ═════════════════════════════════════════════════ ]

#[test]
fun first_join_spawns_in_zone_and_checkpoints() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);

  let cp = cp_of(&mut sc, test_world::owner(), cid, wid);
  assert_eq!(world::time_ms(&cp), 1000);
  // spawn lands inside the 1000×1000 box CENTERED on the world center (bounds/2 = the client's signed-coord
  // origin, D186 — the old corner roll stranded every first search ~250k blocks from the render; r5 P0 07-11)
  let center = 500_000 / 2; // DEFAULT_BOUND / 2
  assert!(world::x(&cp) >= center - 500 && world::x(&cp) < center + 500);
  assert!(world::z(&cp) >= center - 500 && world::z(&cp) < center + 500);

  sc.next_tx(test_world::owner());
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  assert!(character_link::in_world(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid));
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
fun rejoin_restores_checkpoint_not_rerolled() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000); // first join at t=1000
  let first = cp_of(&mut sc, test_world::owner(), cid, wid);

  do_join(&mut sc, test_world::owner(), cid, 5000); // REJOIN at t=5000 (clock advanced)
  let second = cp_of(&mut sc, test_world::owner(), cid, wid);

  // rejoin restored the EXACT prior checkpoint — position AND the old clock (never re-rolled, never re-stamped)
  assert_eq!(world::x(&second), world::x(&first));
  assert_eq!(world::z(&second), world::z(&first));
  assert_eq!(world::time_ms(&second), 1000); // NOT 5000 — travel debt preserved
  sc.end();
}

#[test, expected_failure(abort_code = ELevelTooLow, location = zones)]
fun join_below_required_level_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _tid) = standard_world(&mut sc);
  test_world::set_required_level(&mut sc, 2); // a level-1 (exp-0) character cannot enter
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000); // ELevelTooLow
  abort
}

// ╔════════════════ [ Search / discovery ] ═══════════════════════════════════ ]

#[test]
fun search_discovers_occupied_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // standing still (distance 0) — spawn zone works

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert!(zones::zone_exists(&w, zx, zy));
  assert_eq!(zones_view::mob_group_count(&w, zx, zy), 2); // fixed density → exactly 2 groups
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 2); // and 2 nodes (each a 1-cell FARMER field at RES_QTY=1)
  assert_eq!(zones::resource_remaining(&w, zx, zy, 0), 1); // a gather CELL is one plant = one harvest (remaining=1)
  assert_eq!(zones_view::resource_tier(&w, zx, zy, 0), 1); // authoring path: the entry's tier (standard_world seeds T1) threads onto the live node
  ts::return_shared(w);
  sc.end();
}

#[test]
/// Discover a zone (a `ZoneKey → Zone` dynamic field on the World UID), then `zones::drain_zones` removes it —
/// the pre-burn reclaim of the DF class THIS module owns. Proves a `Zone` (has `store`, no `drop`) destructures
/// cleanly on removal, so a subsequent `world::destroy_world` strands no discovered-zone storage.
fun drain_zones_removes_discovered_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // discovers the occupied zone

  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  assert!(zones::zone_exists(&w, zx, zy)); // the Zone DF is present
  zones::drain_zones(&cap, &mut w, vector[zx], vector[zy], &ver, sc.ctx());
  assert!(!zones::zone_exists(&w, zx, zy)); // drained — the Zone was destructured + the DF removed
  // RE-DRAIN the same key plus a never-discovered one: every removal is `exists`-guarded → no abort, still gone
  // (idempotent — the ceremony can safely replay a partially-landed drain batch).
  zones::drain_zones(&cap, &mut w, vector[zx, zx + 7], vector[zy, zy + 7], &ver, sc.ctx());
  assert!(!zones::zone_exists(&w, zx, zy));
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EBadDrainInput, location = zones)]
/// `drain_zones` with mismatched zx/zy list lengths aborts (`EBadDrainInput`) — the parallel-list contract.
fun drain_zones_length_mismatch_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _tid) = standard_world(&mut sc);
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  zones::drain_zones(&cap, &mut w, vector[1, 2], vector[1], &ver, sc.ctx()); // 2 zx vs 1 zy
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// `drain_zones` on a stale package version aborts — version-gated exactly like every admin door.
fun drain_zones_on_stale_version_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _tid) = standard_world(&mut sc);
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  version::test_set_stale(&mut ver);
  zones::drain_zones(&cap, &mut w, vector[0], vector[0], &ver, sc.ctx()); // EWrongVersion
  abort
}

#[test]
/// THE S-71 UNLOCK: walk to a FRESH zone (position (2000, 2000) — zones are 512 wide, spawn is inside (0..1,
/// 0..1)) and search it with honest elapsed time. Pre-fix this was IMPOSSIBLE forever (EZoneNotOccupied: the
/// checkpoint could only ever sit in the spawn zone). The checkpoint ADVANCES to the proven position (§5).
fun search_walked_to_fresh_zone_passes_and_advances_checkpoint() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let now = 1000 + 10_000_000_000; // huge elapsed — any in-world walk is coverable at 5.5 b/s
  do_search(&mut sc, test_world::owner(), cid, 2000, 2000, now);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (zx, zy) = world::zone_of(&w, 2000, 2000);
  assert!(zones::zone_exists(&w, zx, zy)); // the WALKED-TO zone got discovered
  assert_eq!(zones_view::mob_group_count(&w, zx, zy), 2);
  ts::return_shared(w);
  let cp = cp_of(&mut sc, test_world::owner(), cid, wid);
  assert_eq!(world::x(&cp), 2000); // discovery is position-proving — the checkpoint advanced
  assert_eq!(world::z(&cp), 2000);
  assert_eq!(world::time_ms(&cp), now);
  sc.end();
}

#[test]
/// Zone resource-entry getters: after a search discovers the spawn zone, node 0 exposes its source template + job,
/// and the zone carries the search-time discovery stamp.
fun discovered_zone_resource_getters() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones_view::resource_template(&w, zx, zy, 0), tid); // node 0 carries the seeded template
  assert_eq!(zones_view::resource_job(&w, zx, zy, 0), 0); // FARMER (standard_world job 0)
  assert_eq!(zones::zone_discovered_at(&w, zx, zy), 2000); // stamped at the search time
  ts::return_shared(w);
  sc.end();
}

#[test, expected_failure(abort_code = ETravelTooFar, location = world)]
/// Too far, too fast: claiming a standing position ≥1000 blocks out 1s after spawn (budget ~5.5 blocks) refuses —
/// the travel verify is the security that REPLACED the occupancy lock.
fun search_too_far_too_fast_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  do_search(&mut sc, test_world::owner(), cid, 2000, 2000, 2000); // 1s elapsed, ~1.4-2.8k blocks away
  abort
}

#[test, expected_failure(abort_code = EZoneFresh, location = zones)]
fun research_before_ttl_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // discover
  do_search(&mut sc, test_world::owner(), cid, px, pz, 3000); // 1s later, well under the 2h TTL → EZoneFresh
  abort
}

#[test]
fun research_after_ttl_rerolls_zone_and_resets_consumption() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // 2 derived cells

  // harvest cell 0 (one-harvest/one-bit) → its bit sets, 1 live cell remains
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let seed_a = zones::zone_seed(&w, zx, zy);
  zones::y78(&mut w, zx, zy, 0);
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 1);
  assert_eq!(zones::res_bitmap_bytes(&w, zx, zy), 1); // the consume grew the bitmap by exactly one byte
  ts::return_shared(w);

  // re-search past the 2h TTL: the zone RE-ROLLS — new seed, bitmaps reset, density derives 2 fresh cells
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000 + 7_200_001);
  sc.next_tx(test_world::owner());
  let w2 = sc.take_shared<World>();
  assert!(zones::zone_seed(&w2, zx, zy) != seed_a); // a fresh &Random seed (P[collision] ≈ 2^-64)
  assert_eq!(zones::res_bitmap_bytes(&w2, zx, zy), 0); // consumption reset with the re-roll
  assert_eq!(zones_view::resource_node_count(&w2, zx, zy), 2); // back to the fixed density target — never 3 or 4
  ts::return_shared(w2);
  sc.end();
}

#[test]
/// DESIGN RIDER (2026-07-10) — re-searching a FULL zone adds NOTHING (never doubles). Under the rework a re-search
/// RE-ROLLS the whole zone (new seed) and the fixed density derives exactly 2 + 2 again — never 4, never additive
/// beyond the max (the derivation can never duplicate: rows don't exist, only the seed does).
fun research_full_zone_adds_nothing() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // discover → full at 2 groups + 2 nodes
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000 + 7_200_001); // re-search past the 2h TTL

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones_view::mob_group_count(&w, zx, zy), 2); // unchanged — never doubled
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 2);
  ts::return_shared(w);
  sc.end();
}

#[test]
/// The REAL &Random terminal entries: `join_world` rolls a spawn off a live framework generator, then
/// `search_zone` discovers the standing zone (distance 0 always clears the travel check). The deterministic
/// `*_for_testing` twins share these exact bodies; this drives the entries themselves with a seeded `Random`.
fun join_and_search_random_entries() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());

  // seed a framework Random — create + the first-round update run as the system address @0x0
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0101010101010101010101010101010101010101010101010101010101010101", sc.ctx());
  ts::return_shared(r);

  // JOIN through the real &Random entry
  sc.next_tx(test_world::owner());
  {
    let w = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let r = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    zones::join_world(&w, &mut k, &pkcap, cid, &cfg, &ver, &clk, &r, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(r);
  };

  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, _wid);

  // SEARCH through the real &Random entry (standing still)
  sc.next_tx(test_world::owner());
  {
    let mut w = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let r = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(2000);
    zones::search_zone(&mut w, &mut k, &pkcap, cid, px, pz, &cfg, &ver, &clk, &r, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(r);
  };

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (zx, zy) = world::zone_of(&w, px, pz);
  assert!(zones::zone_exists(&w, zx, zy)); // the standing zone got discovered by the real entry
  ts::return_shared(w);
  sc.end();
}

#[test, expected_failure(abort_code = C_ENotEnabled, location = aresrpg::config)]
fun search_while_globally_frozen_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);

  // flip the GLOBAL freeze off
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<aresrpg::admin::AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  aresrpg::config::set_enabled(&cap, &mut cfg, false, sc.ctx());
  ts::return_shared(cfg);
  sc.return_to_sender(cap);

  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // ENotEnabled (global)
  abort
}

#[test]
/// FULL-PIPELINE cross-language parity: `zone_comp` (table snapshot → §4 distance filter → kernel → row mapping)
/// against vectors captured LIVE from the JS `zone_derive.js::derive_zone` over the IDENTICAL world doc (one mob
/// row rate 100 band [2,2] · one FARMER resource rate 100 qty [1,1] · density 3 groups / 2 cells · zone (488,488)
/// of a default 500k/512 world · seed 9876543210 — deliberately > u32 to pin the seed-masking path · team bound
/// 6). The kernel-level parity lives in zone_gen_tests; THIS pins the input pipeline both sides compute
/// independently (weights, size cap, geometry, template mapping). The sim suite asserts the same vectors.
fun zone_comp_pipeline_matches_js_derive_zone() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  let _wid = test_world::make_world_tuned(&mut sc, tid, 0, 1, 1, 2, 3); // FARMER qty 1, 2 cells, 3 groups
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();

  let (msids, mtpls, mxs, mzs, msizes, mgseeds) = zone_comp::derive_mobs(&w, 488, 488, 9876543210, 6);
  assert_eq!(msids.length(), 3);
  assert!(msids[0] == 11220703129345358465 && mxs[0] == 250008 && mzs[0] == 250195 && msizes[0] == 2 && mgseeds[0] == 3875465078);
  assert!(msids[1] == 8979526716117528717 && mxs[1] == 250039 && mzs[1] == 249871 && msizes[1] == 2 && mgseeds[1] == 882903168);
  assert!(msids[2] == 8618570982553016694 && mxs[2] == 250239 && mzs[2] == 250329 && msizes[2] == 2 && mgseeds[2] == 3880767024);
  assert_eq!(mtpls[0], object::id_from_address(@0xB0B)); // the world's one mob row

  let (rsids, rtpls, rxs, rzs, rjobs, _rtiers) = zone_comp::derive_res(&w, 488, 488, 9876543210);
  assert_eq!(rsids.length(), 2);
  assert!(rsids[0] == 10736692352345019500 && rxs[0] == 250175 && rzs[0] == 250326 && rjobs[0] == 0);
  assert!(rsids[1] == 4596960998799914108 && rxs[1] == 250267 && rzs[1] == 250287);
  assert_eq!(rtpls[0], tid); // template mapping — derived index → the world's resource row

  ts::return_shared(w);
  sc.end();
}

// ╔════════════════ [ Gather clusters (FIELD spawn — §6) ] ══════════════════ ]

/// Read every live resource cell's (x, z) in a zone into parallel vectors (RPC/commit order).
fun all_node_pos(sc: &mut Scenario, zx: u32, zy: u32): (vector<u32>, vector<u32>) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let n = zones_view::resource_node_count(&w, zx, zy);
  let mut xs = vector<u32>[];
  let mut zs = vector<u32>[];
  let mut i = 0;
  while (i < n) {
    let (x, z) = zones_view::resource_pos(&w, zx, zy, i);
    xs.push_back(x);
    zs.push_back(z);
    i = i + 1;
  };
  ts::return_shared(w);
  (xs, zs)
}

/// Every cell edge-adjacent (Manhattan distance 1) to an EARLIER one → the field is one contiguous blob.
fun connected_field(xs: &vector<u32>, zs: &vector<u32>): bool {
  let n = xs.length();
  let mut k = 1;
  while (k < n) {
    let mut adjacent = false;
    let mut j = 0;
    while (j < k) {
      let dx = if (xs[k] >= xs[j]) xs[k] - xs[j] else xs[j] - xs[k];
      let dz = if (zs[k] >= zs[j]) zs[k] - zs[j] else zs[j] - zs[k];
      if (((dx as u64) + (dz as u64)) == 1) { adjacent = true; break };
      j = j + 1;
    };
    if (!adjacent) return false;
    k = k + 1;
  };
  true
}

#[test]
/// A GATHER entry (job FARMER/HERBALIST/MINER) spawns a CONTIGUOUS FIELD: its qty band is REPURPOSED as the cluster
/// CELL count and each cell is its own `remaining: 1` node. Density 1 node-target + a K=6 band → exactly one 6-cell
/// field of the same template/job, grown on adjacent blocks (not 6 scattered singles).
fun search_gather_entry_spawns_contiguous_field() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world_tuned(&mut sc, tid, 0, 1, 6, 1, 1); // FARMER, K=6, 1 node-target, 1 group
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 6); // K=6 cells, one field
  let mut i = 0;
  while (i < 6) {
    assert_eq!(zones::resource_remaining(&w, zx, zy, i), 1); // one plant per cell
    assert_eq!(zones_view::resource_template(&w, zx, zy, i), tid); // all the same resource…
    assert_eq!(zones_view::resource_job(&w, zx, zy, i), 0); // …all FARMER
    i = i + 1;
  };
  ts::return_shared(w);
  let (xs, zs) = all_node_pos(&mut sc, zx, zy);
  assert!(connected_field(&xs, &zs)); // the 6 cells form ONE adjacent field
  sc.end();
}

#[test]
/// A NON-gather resource entry (job > MINER) is UNTOUCHED by clustering: ONE derived cell at a single position —
/// no field growth. ONE-HARVEST/ONE-BIT: the multi-charge `remaining` branch carried
/// zero real data (2110/2110 seeded resources were remaining:1), so the qty band no longer becomes a charge
/// counter — every cell is exactly one harvest and `remaining` reads 1 (live) or 0 (harvested).
fun search_non_gather_entry_single_cell_one_harvest() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world_tuned(&mut sc, tid, 5, 1, 4, 1, 1); // job 5 = non-gather, qty band 4, 1 cell-target
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);

  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 1); // NOT clustered — a single cell
  assert_eq!(zones::resource_remaining(&w, zx, zy, 0), 1); // one-bit law: 1 live harvest, NEVER the qty band
  assert_eq!(zones_view::resource_job(&w, zx, zy, 0), 5);
  zones::y78(&mut w, zx, zy, 0); // harvest it once
  assert_eq!(zones::resource_remaining(&w, zx, zy, 0), 0); // consumed — the bit, not a counter, went to 0
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 0);
  ts::return_shared(w);
  sc.end();
}

#[test, expected_failure(abort_code = ENodeEmpty, location = zones)]
/// DOUBLE-HARVEST aborts: the consumed bit is already set → ENodeEmpty (the bitmap IS the depletion state).
fun consume_resource_cell_twice_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  zones::y78(&mut w, zx, zy, 0);
  zones::y78(&mut w, zx, zy, 0); // ENodeEmpty
  abort
}

#[test]
/// SPAWN-ID UNIQUENESS across searches: ids now DERIVE from each zone's own seed (64 bits from two decorrelated
/// prng draws — the retired world nonce is gone), so two zones searched with different `&Random` seeds carry
/// distinct ids (P[collision] ≈ 2^-64; the fight-side first-come guard on `(world, spawn_id)` stays the
/// independent backstop even against that).
fun search_derived_spawn_ids_unique_across_zones() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world_tuned(&mut sc, tid, 0, 1, 6, 1, 1); // FARMER K=6, 1 cell-target, 1 group
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx_a, zy_a) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000); // search A (occupied zone)

  // walk far and search a SECOND zone (honest huge elapsed clears the travel budget)
  do_search(&mut sc, test_world::owner(), cid, 2000, 2000, 2000 + 10_000_000_000); // search B

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (zx_b, zy_b) = world::zone_of(&w, 2000, 2000);
  assert!(zones::zone_seed(&w, zx_a, zy_a) != zones::zone_seed(&w, zx_b, zy_b)); // independent &Random draws
  let a_mob = zones_view::mob_spawn_id(&w, zx_a, zy_a, 0);
  let b_mob = zones_view::mob_spawn_id(&w, zx_b, zy_b, 0);
  assert!(a_mob != b_mob); // derived 64-bit ids — distinct across zones/searches
  ts::return_shared(w);
  sc.end();
}

#[test]
/// THE COST SHAPE (the rework's reason to exist): right after a search the Zone stores a seed + EMPTY bitmaps —
/// zero bytes of per-mob/per-cell rows — while the getters still DERIVE the full advertised population. The
/// searcher pays for ~4 scalar fields instead of the retired spawn vectors; the storage the fight/gather actually
/// consumes is paid by (and rebated to) the consumer.
fun search_stores_seed_and_bitmaps_only() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, _tid) = standard_world(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones::mob_bitmap_bytes(&w, zx, zy), 0); // NOTHING stored per mob group…
  assert_eq!(zones::res_bitmap_bytes(&w, zx, zy), 0); // …or per resource cell (bits grow lazily on consume)
  assert_eq!(zones_view::mob_group_count(&w, zx, zy), 2); // yet the full population derives from the seed
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 2);
  ts::return_shared(w);
  sc.end();
}

#[test]
/// THE 20-BLOCK SPAWN-SPACING LAW at the ZONES level: the derived mob groups of a searched
/// zone are pairwise ≥ 20 blocks apart — the kernel's rejection sampling enforced through the real search door.
/// (The kernel-level property test sweeps 60 seeds in zone_gen_tests; this pins the wiring end-to-end.)
fun searched_zone_mob_groups_respect_spacing_law() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world_tuned(&mut sc, tid, 0, 1, 1, 1, 8); // 8 groups — a dense zone stresses spacing
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  do_join(&mut sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(&mut sc, test_world::owner(), cid, wid);
  let (px, pz) = cp_pos(&mut sc, test_world::owner(), cid, wid);
  do_search(&mut sc, test_world::owner(), cid, px, pz, 2000);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let n = zones_view::mob_group_total(&w, zx, zy);
  assert_eq!(n, 8);
  let mut a = 0;
  while (a < n) {
    let (ax, az) = zones_view::mob_group_pos(&w, zx, zy, a);
    let mut b = a + 1;
    while (b < n) {
      let (bx, bz) = zones_view::mob_group_pos(&w, zx, zy, b);
      let dx = if (ax >= bx) (ax - bx) as u64 else (bx - ax) as u64;
      let dz = if (az >= bz) (az - bz) as u64 else (bz - az) as u64;
      assert!(dx * dx + dz * dz >= 400, b); // pairwise ≥ 20 blocks (squared)
      b = b + 1;
    };
    a = a + 1;
  };
  ts::return_shared(w);
  sc.end();
}
