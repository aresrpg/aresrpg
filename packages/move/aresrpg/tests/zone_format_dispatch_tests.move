// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FORMAT DISPATCH — a zone is read with the derivation it was WRITTEN with, decided by the one byte its
// stored commitment carries. This is the seam whose absence lets two derivers produce two different worlds from
// one seed: the chain reads the byte before it derives, so every other reader must too. `zone_gen_grid_tests`
// (foundation) pins the lattice KERNEL against live chain truth; this file pins the SELECTION.
#[test_only]
module aresrpg::zone_format_dispatch_tests;

use aresrpg::{character_link, config::GameConfig, test_world, version::Version, world::{Self, World}, zone_comp, zones, zones_view};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const TEAM_BOUND: u64 = 6;

fun do_join(sc: &mut Scenario, cid: ID, now: u64) {
  sc.next_tx(test_world::owner());
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

fun do_search(sc: &mut Scenario, cid: ID, x: u32, z: u32, now: u64) {
  sc.next_tx(test_world::owner());
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

/// Boot a world, join, and search the occupied zone. Returns its key.
fun searched_zone(sc: &mut Scenario): (u32, u32) {
  test_world::boot(sc);
  let tid = test_world::make_resource_template(sc);
  let wid = test_world::make_world(sc, tid, 0, 1);
  let cid = test_world::mint_character(sc, test_world::owner());
  do_join(sc, cid, 1000);
  sc.next_tx(test_world::owner());
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  let (px, pz) = (world::x(&cp), world::z(&cp));
  do_search(sc, cid, px, pz, 2000);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (zx, zy) = world::zone_of(&w, px, pz);
  ts::return_shared(w);
  (zx, zy)
}

#[test]
/// A zone with no lattice commitment reads through the LEGACY kernel; the same zone, same seed, with a format-2
/// commitment stored reads through the LATTICE kernel. Asserted against `zone_comp` directly, so the test states
/// the dispatcher's whole contract and cannot pass by the two derivations happening to agree.
fun the_commitment_byte_selects_the_mob_derivation() {
  let mut sc = ts::begin(test_world::owner());
  let (zx, zy) = searched_zone(&mut sc);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let seed = zones::zone_seed(&w, zx, zy);

  // RUNG 3 — a FRESH search writes a member-list commitment, so the dispatcher must reach the member kernel.
  let (mem_ids, _tm, _mm, mem_x, mem_z, _sm, _gm, _pm) = zone_comp::derive_mobs_members(&w, zx, zy, seed, TEAM_BOUND);
  let (got3, _t5, got3_x, got3_z, _s5, _g5) = zones::derive_mobs(&w, zx, zy, seed, TEAM_BOUND);
  assert!(got3 == mem_ids && got3_x == mem_x && got3_z == mem_z, 2); // format 3 ⇒ member kernel

  // RUNG 1 — strip the commitment and the same zone, same seed, reads through the LEGACY kernel.
  zones::remove_group_commitment_for_testing(&mut w, zx, zy);
  let (want_ids, _t, want_x, want_z, _s, _g) = zone_comp::derive_mobs(&w, zx, zy, seed, TEAM_BOUND);
  let (got_ids, _t2, got_x, got_z, _s2, _g2) = zones::derive_mobs(&w, zx, zy, seed, TEAM_BOUND);
  assert!(got_ids == want_ids && got_x == want_x && got_z == want_z, 0); // no commitment ⇒ legacy
  // and the three rungs are genuinely different derivations — the assertions above cannot pass by coincidence
  assert!(mem_x != want_x || mem_z != want_z, 3);

  zones::set_lattice_commitment_for_testing(&mut w, zx, zy, TEAM_BOUND);
  let (grid_ids, _t3, grid_x, grid_z, _s3, _g3) = zone_comp::derive_mobs_grid(&w, zx, zy, seed, TEAM_BOUND);
  let (now_ids, _t4, now_x, now_z, _s4, _g4) = zones::derive_mobs(&w, zx, zy, seed, TEAM_BOUND);
  assert!(now_ids == grid_ids && now_x == grid_x && now_z == grid_z, 1); // format 2 ⇒ lattice

  ts::return_shared(w);
  sc.end();
}

#[test]
/// BOTH streams follow the SAME byte — a zone whose mobs went lattice must never read its resource cells with
/// the legacy sampler, or the two would name different cells for one res-bitmap index (the gather door's key).
fun the_commitment_byte_selects_the_resource_derivation() {
  let mut sc = ts::begin(test_world::owner());
  let (zx, zy) = searched_zone(&mut sc);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let seed = zones::zone_seed(&w, zx, zy);

  // A member-list zone is a LATTICE zone: format 3 changed what a group HOLDS, never where anything sits.
  let (mem_ids, _tm, mem_x, mem_z, _jm, _rm) = zone_comp::derive_res_grid(&w, zx, zy, seed);
  let (got3, _t5, got3_x, got3_z, _j5, _r5) = zones::derive_res(&w, zx, zy, seed);
  assert!(got3 == mem_ids && got3_x == mem_x && got3_z == mem_z, 2);

  zones::remove_group_commitment_for_testing(&mut w, zx, zy);
  let (want_ids, _t, want_x, want_z, _j, _r) = zone_comp::derive_res(&w, zx, zy, seed);
  let (got_ids, _t2, got_x, got_z, _j2, _r2) = zones::derive_res(&w, zx, zy, seed);
  assert!(got_ids == want_ids && got_x == want_x && got_z == want_z, 0);

  zones::set_lattice_commitment_for_testing(&mut w, zx, zy, TEAM_BOUND);
  let (grid_ids, _t3, grid_x, grid_z, _j3, _r3) = zone_comp::derive_res_grid(&w, zx, zy, seed);
  let (now_ids, _t4, now_x, now_z, _j4, _r4) = zones::derive_res(&w, zx, zy, seed);
  assert!(now_ids == grid_ids && now_x == grid_x && now_z == grid_z, 1);

  ts::return_shared(w);
  sc.end();
}

#[test]
/// The RPC READ PATH follows the byte too. `zones_view` is how the client and the indexer learn where a group
/// is; if it derived past the dispatch it would hand players positions and ids the claim door rejects — the
/// exact disagreement the format byte exists to prevent. (This getter is the one the chain-truth fixture in
/// `zone_gen_grid_tests` was captured through.)
fun the_view_getters_follow_the_commitment_byte() {
  let mut sc = ts::begin(test_world::owner());
  let (zx, zy) = searched_zone(&mut sc);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let seed = zones::zone_seed(&w, zx, zy);

  // fresh search ⇒ format 3: the view getter must land on the member kernel's placement
  let (mem_vx, mem_vz) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (_i3, _t3, _m3, mx3, mz3, _s3, _g3, _p3) = zone_comp::derive_mobs_members(&w, zx, zy, seed, 1);
  assert!(mem_vx == mx3[0] && mem_vz == mz3[0], 3);

  zones::remove_group_commitment_for_testing(&mut w, zx, zy);
  let (want_x, want_z) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (_i, _t, legacy_x, legacy_z, _s, _g) = zone_comp::derive_mobs(&w, zx, zy, seed, 1);
  assert!(want_x == legacy_x[0] && want_z == legacy_z[0], 0);

  zones::set_lattice_commitment_for_testing(&mut w, zx, zy, TEAM_BOUND);
  let (got_x, got_z) = zones_view::mob_group_pos(&w, zx, zy, 0);
  let (_i2, _t2, grid_x, grid_z, _s2, _g2) = zone_comp::derive_mobs_grid(&w, zx, zy, seed, 1);
  assert!(got_x == grid_x[0] && got_z == grid_z[0], 1);
  assert!(zones_view::mob_spawn_id(&w, zx, zy, 0) != 0, 2);

  ts::return_shared(w);
  sc.end();
}
