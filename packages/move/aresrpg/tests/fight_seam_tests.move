// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT-SEAM tests: the cross-package reads/writes the `aresrpg_fight` lane consumes — `zones::claim_mob_group`
/// (travel-verify + entry checkpoint + free the spawn; happy path, double-claim, travel-too-far), the
/// `character_link::combat_stats` snapshot (fresh-character defaults), the cap-gated progression writes
/// `grant_fight_xp` (stored-level + cap-discard, wrong-cap abort) and `write_back_hp`, and an owner-gated
/// `flip_world` dungeon seam. All run against the REAL value paths on the `test_world` harness.
#[test_only]
module aresrpg::fight_seam_tests;

use aresrpg::{
  character_link,
  checkpoint,
  config::GameConfig,
  extension,
  test_world,
  version::Version,
  world::{Self, World},
  zones,
  zones_view
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::{string::String, unit_test::assert_eq};
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

// ── mirrored error values (location disambiguates which module aborted) ──
const EWrongCapNamespace: u64 = 101; // character_link
const ETravelTooFar: u64 = 102; // checkpoint
const ESpawnNotFound: u64 = 108; // zones
const EAlreadyFullHp: u64 = 105; // character_link (heal_hp — blocked when pointless)

const HUGE_ELAPSED: u64 = 10_000_000_000; // dwarfs any in-zone distance → travel always passes
const MOB_TEMPLATE: address = @0xB0B; // the mob entry `test_world::make_world` seeds

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
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
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
  // FORMAT-1 PREMISE (#1110): a fresh search now writes a MEMBER-LIST (format 3) commitment, and the original
  // claim doors this suite exercises refuse those zones by design. Dropping it leaves the zone in exactly the
  // shape every zone the deployed package ever discovered carries — legacy — which is the population these
  // doors serve forever. The member doors have their own end-to-end suite (`member_claim_tests`).
  { let (zx, zy) = world::zone_of(&w, x, z); zones::remove_group_commitment_for_testing(&mut w, zx, zy); };
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

fun do_claim(sc: &mut Scenario, who: address, cid: ID, spawn_id: u64, now: u64): (ID, u32, u32, u16, u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  let wid = object::id(&w);
  let ticket = zones::claim_mob_group(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  // the ticket is the provenance contract: it must bind the CLAIMED world + character + spawn, not just the facts
  let (tw, tc, tsid, t, x, z, gs, sms, _seed) = zones::consume_group_ticket(ticket);
  assert!(tw == wid);
  assert!(tc == cid);
  assert!(tsid == spawn_id);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  (t, x, z, gs, sms)
}

/// Claim through the GLOBAL-SEARCH door `claim_mob_group_in_zone(zx, zy, spawn_id)` — the zone is named
/// EXPLICITLY (not derived from the checkpoint). Consumes + asserts the same provenance contract as `do_claim`.
fun do_claim_in_zone(sc: &mut Scenario, who: address, cid: ID, zx: u32, zy: u32, spawn_id: u64, now: u64): (ID, u32, u32, u16, u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  let wid = object::id(&w);
  let ticket = zones::claim_mob_group_in_zone(&mut w, &mut k, &pkcap, cid, zx, zy, spawn_id, &cfg, &ver, &clk);
  let (tw, tc, tsid, t, x, z, gs, sms, _seed) = zones::consume_group_ticket(ticket);
  assert!(tw == wid);
  assert!(tc == cid);
  assert!(tsid == spawn_id);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  (t, x, z, gs, sms)
}

/// Overwrite the character's checkpoint to a known position (deterministic travel setup).
fun pin_checkpoint(sc: &mut Scenario, who: address, cid: ID, wid: ID, x: u32, z: u32, time: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::write_checkpoint(chr, wid, checkpoint::new_checkpoint(x, z, time, false), &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

fun occupied_zone(sc: &mut Scenario, who: address, cid: ID, wid: ID): (u32, u32) {
  sc.next_tx(who);
  let w = sc.take_shared<World>();
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  let (zx, zy) = world::zone_of(&w, checkpoint::x(&cp), checkpoint::z(&cp));
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  (zx, zy)
}

fun cp_of(sc: &mut Scenario, who: address, cid: ID, wid: ID): checkpoint::Checkpoint {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  cp
}

fun combat_of(sc: &mut Scenario, who: address, cid: ID): (String, u64, u64, u64, u64, u64) {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let (cl, lvl, hp, mhp, ap, mp) = character_link::combat_stats(k.borrow(personal_kiosk::borrow(&pkcap), cid), &cfg);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  (cl, lvl, hp, mhp, ap, mp)
}

fun current_hp_of(sc: &mut Scenario, who: address, cid: ID, now: u64): u64 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  let hp = character_link::current_hp(k.borrow(personal_kiosk::borrow(&pkcap), cid), &cfg, &clk);
  clk.destroy_for_testing();
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  hp
}

fun level_of(sc: &mut Scenario, who: address, cid: ID): u64 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let l = character_link::level(k.borrow(personal_kiosk::borrow(&pkcap), cid));
  ts::return_shared(k); sc.return_to_sender(pkcap);
  l
}

fun grant_xp(sc: &mut Scenario, who: address, cid: ID, xp: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::grant_fight_xp(&cfg, chr, xp, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

fun write_hp(sc: &mut Scenario, who: address, cid: ID, hp: u64, now: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::write_back_hp(chr, hp, now, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

/// Heal `amount` HP on `who`'s character `cid` at `now` through the NS_PROGRESSION-cap `heal_hp` primitive (the
/// consumable-use seam; a throwaway test progression cap stands in for the fight-registry-custodied one).
fun heal(sc: &mut Scenario, who: address, cid: ID, amount: u64, now: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::heal_hp(&cfg, chr, amount, now, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

fun flip(sc: &mut Scenario, who: address, cid: ID, world_id: ID) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  character_link::flip_world(&mut k, &pkcap, cid, world_id, &ver);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

fun in_world_of(sc: &mut Scenario, who: address, cid: ID, world_id: ID): bool {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let r = character_link::in_world(k.borrow(personal_kiosk::borrow(&pkcap), cid), world_id);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  r
}

/// Full setup: boot, resource template, world (with the mob entry), character, join, search the occupied zone
/// (so the zone holds 2 live mob groups). Returns (cid, wid, zx, zy).
fun discovered(sc: &mut Scenario): (ID, ID, u32, u32) {
  test_world::boot(sc);
  let tid = test_world::make_resource_template(sc);
  let wid = test_world::make_world(sc, tid, 0, 1);
  let cid = test_world::mint_character(sc, test_world::owner());
  do_join(sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(sc, test_world::owner(), cid, wid);
  let cp = cp_of(sc, test_world::owner(), cid, wid);
  do_search(sc, test_world::owner(), cid, checkpoint::x(&cp), checkpoint::z(&cp), 2000);
  (cid, wid, zx, zy)
}

// ╔════════════════ [ SEAM 1 — claim_mob_group ] ═════════════════════════════ ]

#[test]
fun claim_returns_facts_writes_checkpoint_frees_spawn() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, zx, zy) = discovered(&mut sc);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let (mx, mz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let size0 = zones_view::mob_group_size(&w, &cfg, zx, zy, 0);
  assert_eq!(zones_view::mob_group_count(&w, zx, zy), 2);
  ts::return_shared(w);
  ts::return_shared(cfg);

  let (t, x, z, gs, sms) = do_claim(&mut sc, test_world::owner(), cid, spawn0, 2000 + HUGE_ELAPSED);
  assert_eq!(t, object::id_from_address(MOB_TEMPLATE)); // the group's template id
  assert_eq!(x, mx);
  assert_eq!(z, mz);
  assert_eq!(gs, size0);
  assert_eq!(sms, 2000); // spawned_at_ms = the search time (aging reads this, never claim time)

  // entry checkpoint advanced to the group; the spawn freed (2 → 1)
  let cp = cp_of(&mut sc, test_world::owner(), cid, wid);
  assert_eq!(checkpoint::x(&cp), mx);
  assert_eq!(checkpoint::z(&cp), mz);
  assert_eq!(checkpoint::time_ms(&cp), 2000 + HUGE_ELAPSED);
  sc.next_tx(test_world::owner());
  let w2 = sc.take_shared<World>();
  assert_eq!(zones_view::mob_group_count(&w2, zx, zy), 1);
  ts::return_shared(w2);
  sc.end();
}

#[test, expected_failure(abort_code = ESpawnNotFound, location = zones)]
fun claim_double_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, zx, zy) = discovered(&mut sc);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  ts::return_shared(w);
  do_claim(&mut sc, test_world::owner(), cid, spawn0, 2000 + HUGE_ELAPSED); // frees it
  do_claim(&mut sc, test_world::owner(), cid, spawn0, 2000 + HUGE_ELAPSED); // gone → ESpawnNotFound
  abort
}

#[test, expected_failure(abort_code = ETravelTooFar, location = checkpoint)]
fun claim_travel_too_far_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, zx, zy) = discovered(&mut sc);
  // read the group's position + zone origin, pin the checkpoint to the FAR corner of the SAME zone (≥256 blocks)
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let (mx, mz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (ox, oz) = world::zone_origin(&w, zx, zy);
  ts::return_shared(w);
  let fx = if (mx >= ox + 256) ox else ox + 511;
  let fz = if (mz >= oz + 256) oz else oz + 511;
  pin_checkpoint(&mut sc, test_world::owner(), cid, wid, fx, fz, 2000);
  do_claim(&mut sc, test_world::owner(), cid, spawn0, 2001); // 1s later, ≥256 blocks away → ETravelTooFar
  abort
}

// ╔════════════════ [ SEAM 1b — claim_mob_group_in_zone (global-search door) ] ═ ]

#[test]
/// THE GLOBAL-SEARCH UNLOCK: claim a group in a searched zone that is NOT the caller's
/// checkpoint zone. Setup: search zone A (2 groups, checkpoint in A), walk EAST and search the adjacent zone B
/// (checkpoint now sits in B) — the OLD occupied-zone door would derive B and abort ESpawnNotFound; the new door
/// NAMES zone A explicitly, travel-verifies B → the group in A, and claims it (checkpoint advances to the group).
fun claim_in_zone_from_a_different_searched_zone_passes() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, zx, zy) = discovered(&mut sc); // zone A = (zx,zy), searched @2000, 2 live groups, checkpoint in A
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let (mx, mz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (ox, oz) = world::zone_origin(&w, zx, zy);
  ts::return_shared(w);

  // walk into the adjacent zone B (one zone east: origin.x + zone_size) and SEARCH it → checkpoint moves to B
  let now1 = 2000 + HUGE_ELAPSED;
  do_search(&mut sc, test_world::owner(), cid, ox + 512, oz, now1);

  // claim the group still standing in zone A via the global-search door (checkpoint is in B — a DIFFERENT zone)
  let now2 = now1 + HUGE_ELAPSED;
  let (t, x, z, _gs, _sms) = do_claim_in_zone(&mut sc, test_world::owner(), cid, zx, zy, spawn0, now2);
  assert_eq!(t, object::id_from_address(MOB_TEMPLATE));
  assert_eq!(x, mx);
  assert_eq!(z, mz);

  // zone A's group freed (2 → 1) and the entry checkpoint advanced to the claimed group in A
  sc.next_tx(test_world::owner());
  let w2 = sc.take_shared<World>();
  assert_eq!(zones_view::mob_group_count(&w2, zx, zy), 1);
  ts::return_shared(w2);
  let cp = cp_of(&mut sc, test_world::owner(), cid, wid);
  assert_eq!(checkpoint::x(&cp), mx);
  assert_eq!(checkpoint::z(&cp), mz);
  sc.end();
}

#[test, expected_failure(abort_code = ESpawnNotFound, location = zones)]
/// The global-search door on an UNSEARCHED zone: no Zone DF exists there → find_mob_group's `df::exists` fails.
fun claim_in_zone_unsearched_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, zx, zy) = discovered(&mut sc);
  // a zone that was never searched (no Zone dynamic field) — spawn_id is irrelevant, the df lookup aborts first
  do_claim_in_zone(&mut sc, test_world::owner(), cid, zx + 50, zy + 50, 0, 2000 + HUGE_ELAPSED);
  abort
}

#[test, expected_failure(abort_code = ETravelTooFar, location = checkpoint)]
/// The proximity gate holds on the new door too: checkpoint pinned to the FAR corner of the target zone, 1s
/// later (budget ~5.5 blocks/s) — ≥256 blocks away → ETravelTooFar (same math the occupied-zone door enforces).
fun claim_in_zone_travel_too_far_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, zx, zy) = discovered(&mut sc);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let (mx, mz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (ox, oz) = world::zone_origin(&w, zx, zy);
  ts::return_shared(w);
  let fx = if (mx >= ox + 256) ox else ox + 511;
  let fz = if (mz >= oz + 256) oz else oz + 511;
  pin_checkpoint(&mut sc, test_world::owner(), cid, wid, fx, fz, 2000);
  do_claim_in_zone(&mut sc, test_world::owner(), cid, zx, zy, spawn0, 2001);
  abort
}

#[test]
/// DESIGN RIDER (2026-07-10) — a fight then a re-search brings the zone back to target, never doubles: claim one
/// of the 2 groups (2 → 1), then re-search the SAME zone past its TTL. Under the search-cost rework the re-search
/// RE-ROLLS the zone (new seed, bitmaps reset) and the fixed density derives exactly 2 groups again → back to 2,
/// never 3/4 — the derivation-model successor of the retired live-row top-up, preserving the same target-count guarantee.
fun research_after_claim_replaces_one_group_never_doubles() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, zx, zy) = discovered(&mut sc); // zone (zx,zy) searched @2000, 2 groups, checkpoint inside it
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let (mx, mz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  ts::return_shared(w);

  do_claim(&mut sc, test_world::owner(), cid, spawn0, 2000 + HUGE_ELAPSED); // a fight frees one group: 2 → 1
  sc.next_tx(test_world::owner());
  let w1 = sc.take_shared<World>();
  assert_eq!(zones_view::mob_group_count(&w1, zx, zy), 1);
  ts::return_shared(w1);

  // re-search from the group's position (now the checkpoint, distance 0) past the 2h TTL → re-roll back to 2
  do_search(&mut sc, test_world::owner(), cid, mx, mz, 2000 + HUGE_ELAPSED + 7_200_001);
  sc.next_tx(test_world::owner());
  let w2 = sc.take_shared<World>();
  assert_eq!(zones_view::mob_group_count(&w2, zx, zy), 2); // exactly the ONE replacement — never 3 or 4
  ts::return_shared(w2);
  sc.end();
}

// ╔════════════════ [ SEAM 2 — combat_stats ] ════════════════════════════════ ]

#[test]
fun combat_stats_fresh_character_defaults() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  let (cl, lvl, hp, mhp, ap, mp) = combat_of(&mut sc, test_world::owner(), cid);
  assert_eq!(cl, b"senshi".to_string()); // class slug straight from the character
  assert_eq!(lvl, 1); // exp 0 → level 1
  assert_eq!(hp, 70); // senshi base 70, level 1, vitality 0 → full HP
  assert_eq!(mhp, 70);
  assert_eq!(ap, 6); // §17.31 default base AP
  assert_eq!(mp, 3); // default base MP
  sc.end();
}

// ╔════════════════ [ SEAM 3 — grant_fight_xp / write_back_hp ] ══════════════ ]

#[test]
fun grant_fight_xp_raises_stored_level_and_cap_discards() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  assert_eq!(level_of(&mut sc, test_world::owner(), cid), 1); // fresh (no block) → curve over base xp
  grant_xp(&mut sc, test_world::owner(), cid, 2800); // level-5 threshold → block born, stored level 5
  assert_eq!(level_of(&mut sc, test_world::owner(), cid), 5);
  grant_xp(&mut sc, test_world::owner(), cid, 10_000_000_000); // >> max-level cap → xp discarded, stored level 200
  assert_eq!(level_of(&mut sc, test_world::owner(), cid), 200);
  sc.end();
}

#[test]
fun write_back_hp_persists_and_combat_stats_reads_it() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  write_hp(&mut sc, test_world::owner(), cid, 25, 5000); // wounded to 25/70
  let (_cl, lvl, hp, mhp, _ap, _mp) = combat_of(&mut sc, test_world::owner(), cid);
  assert_eq!(lvl, 1);
  assert_eq!(hp, 25); // the stored wounded HP (a 0-HP character would be barred from the next fight)
  assert_eq!(mhp, 70); // max is still derived from the class row
  sc.end();
}

#[test]
/// `current_hp` regenerates the STORED HP by elapsed time (ANNEX §5.4): a fresh (block-less) character reads FULL;
/// a wounded character reads stored + lazy regen. Senshi level 1 (max 70), rate 156/75000 HP/ms ⇒ +10 HP over 5s.
fun current_hp_regenerates_stored_block() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  assert_eq!(current_hp_of(&mut sc, test_world::owner(), cid, 999_999), 70); // no block → full HP
  write_hp(&mut sc, test_world::owner(), cid, 25, 5000); // wounded to 25/70, stamped at t=5000
  assert_eq!(current_hp_of(&mut sc, test_world::owner(), cid, 5000), 25); // same instant → no regen
  assert_eq!(current_hp_of(&mut sc, test_world::owner(), cid, 10_000), 35); // +5000ms × 156/75000 = +10 → 35
  sc.end();
}

#[test]
/// heal_hp SETTLES lazy regen FIRST then adds: wounded to 25/70 @5000, healed +20 @10000. Over 5000ms senshi L1
/// regenerates 156/75000×5000 = +10 → 35, THEN the heal adds 20 → 55 (a naive add-without-regen would read 45).
fun heal_hp_settles_regen_then_adds() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  write_hp(&mut sc, test_world::owner(), cid, 25, 5000);
  heal(&mut sc, test_world::owner(), cid, 20, 10_000);
  let (_cl, _lvl, hp, mhp, _ap, _mp) = combat_of(&mut sc, test_world::owner(), cid);
  assert_eq!(hp, 55); // 25 →(regen +10)→ 35 →(heal +20)→ 55
  assert_eq!(mhp, 70);
  sc.end();
}

#[test]
/// The heal is CLAMPED to max_hp: wounded to 60/70 @5000, an over-heal of 100 @5000 (no elapsed → no regen) pins to 70.
fun heal_hp_caps_at_max() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  write_hp(&mut sc, test_world::owner(), cid, 60, 5000);
  heal(&mut sc, test_world::owner(), cid, 100, 5000);
  let (_cl, _lvl, hp, _mhp, _ap, _mp) = combat_of(&mut sc, test_world::owner(), cid);
  assert_eq!(hp, 70); // 60 + 100 capped at max 70
  sc.end();
}

#[test, expected_failure(abort_code = EAlreadyFullHp, location = character_link)]
/// A heal at FULL HP is blocked when pointless (SPEC §10): a stored 70/70 block aborts (the tx reverts, the item un-burns).
fun heal_hp_at_full_aborts() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  write_hp(&mut sc, test_world::owner(), cid, 70, 5000); // stored full HP
  heal(&mut sc, test_world::owner(), cid, 10, 6000); // full → EAlreadyFullHp
  abort
}

#[test, expected_failure(abort_code = EAlreadyFullHp, location = character_link)]
/// A BLOCK-LESS character is full HP by definition, so a heal has nothing to do → EAlreadyFullHp (no block is created).
fun heal_hp_blockless_aborts() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  heal(&mut sc, test_world::owner(), cid, 10, 1000); // no progression block → EAlreadyFullHp
  abort
}

#[test]
/// REMAINDER-CARRY preserved (§5.4): wounded to 25 @t=0, healed +5 @t=100 where regen has accrued only a SUB-UNIT
/// (100ms → 0 whole HP), so the heal stores 30 AND leaves the regen stamp at 0 (not re-stamped to 100). Proof: a
/// later read at t=481 regenerates +1 (481ms from stamp 0) → 31; had the stamp wrongly advanced to 100, it would read 30.
fun heal_hp_remainder_carry_preserved() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  write_hp(&mut sc, test_world::owner(), cid, 25, 0);
  heal(&mut sc, test_world::owner(), cid, 5, 100); // sub-unit regen window → stamp carries at 0
  let (_cl, _lvl, hp, _mhp, _ap, _mp) = combat_of(&mut sc, test_world::owner(), cid);
  assert_eq!(hp, 30); // 25 + 5 (no whole regen at 100ms)
  assert_eq!(current_hp_of(&mut sc, test_world::owner(), cid, 481), 31); // regen from stamp 0 (carry), not 100
  sc.end();
}

// ╔════════════════ [ SEAM 7 — flip_world (dungeon enter / restore) ] ════════ ]

#[test]
fun flip_world_owner_moves_and_restores_field() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  let overworld = object::id_from_address(@0x0ac);
  let dungeon = object::id_from_address(@0xd0d);

  flip(&mut sc, test_world::owner(), cid, overworld);
  assert!(in_world_of(&mut sc, test_world::owner(), cid, overworld));
  flip(&mut sc, test_world::owner(), cid, dungeon); // enter the dungeon world
  assert!(in_world_of(&mut sc, test_world::owner(), cid, dungeon));
  assert!(!in_world_of(&mut sc, test_world::owner(), cid, overworld));
  flip(&mut sc, test_world::owner(), cid, overworld); // restore the overworld
  assert!(in_world_of(&mut sc, test_world::owner(), cid, overworld));
  sc.end();
}

// ── the loot-chance kernel (core results — moved from pure_tests at the S-46 final split) ──
#[test]
fun loot_chance_kernel() {
  // no chance stat → unchanged bp.
  assert_eq!(aresrpg::results::loot_effective_bp(1000, 0), 1000);
  // +700 chance → doubles the drop bp (×(700+700)/700 = ×2).
  assert_eq!(aresrpg::results::loot_effective_bp(1000, 700), 2000);
  // caps at 100.00% (10_000 bp) — a rich mob with high chance can't exceed certainty.
  assert_eq!(aresrpg::results::loot_effective_bp(9000, 700), 10000);
}

