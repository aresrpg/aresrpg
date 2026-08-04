// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE GAS PROBE (#2194) — the instrument behind the format-4 decision, not a behaviour suite.
///
/// The gas audit's finding is that fight-start's dominant cost is the claim door re-deriving the WHOLE zone to
/// locate ONE spawn. That cost is a function of the zone's COMPLEXITY (the audit measured 13.2 → 115.7 mSUI
/// across zones), so a toy 1-row/2-group test world cannot see it. These probes stand up a REALISTIC zone —
/// a 64-row mob table at the lattice's group density — and isolate one number each.
///
/// HOW TO READ IT: `sui move test --path packages/move/aresrpg zone_claim_gas_probe -s` prints a `Gas Used`
/// column. The probes share their setup byte-for-byte and differ by exactly ONE call, so
///   derive-claim compute = `probe_derive_claim` − `probe_baseline`
///   proof-claim  compute = `probe_proof_claim`  − `probe_baseline`
/// Both probes compose the witness, baseline included, so witness composition cancels out of both deltas.
/// `packages/move/scripts/gas_probe_zone_claim.mjs` runs the subtraction and prints the verdict.
///
/// WHAT THE NUMBER IS: Move-VM gas units under the unit-test meter — a deterministic, local proxy for on-chain
/// COMPUTATION, not a MIST price and not storage. It is the ratio that carries the argument.
#[test_only]
module aresrpg::zone_claim_gas_probe_tests;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, test_world, version::Version, world::{Self, World}, zones};
use aresrpg_foundation::zone_gen;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const HUGE_ELAPSED: u64 = 10_000_000_000;
const MOB_ROWS: u64 = 64; // a realistic authored mob table — the pick table EVERY derived group scans, twice
/// PRODUCTION density, not a guess: both seeders pin the ruled band at 48-64 groups per zone
/// (`seed_testnet.mjs` / `seed_full_corpus.mjs` `DENSITY`). The probe takes the FLOOR — the conservative end.
const GROUPS: u16 = 48;

/// A world whose zones cost what a real zone costs: `MOB_ROWS` authored mob rows and `GROUPS` groups per search.
fun big_world(sc: &mut Scenario): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"glacial".to_string(), sc.ctx());
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, GROUPS, GROUPS, 2, 2, &ver, sc.ctx());
  let mut i = 0;
  while (i < MOB_ROWS) {
    world::add_mob_entry(
      &cap, &mut w, object::id_from_address(@0xB0B), ((i % 17) as u16) + 1, 6, 6, &ver, sc.ctx(),
    );
    i = i + 1;
  };
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  wid
}

fun join(sc: &mut Scenario, cid: ID, now: u64) {
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
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

/// Boot, stand up the big world, join, search the occupied zone. Returns `(character, zx, zy)`.
fun searched(sc: &mut Scenario): (ID, u32, u32) {
  test_world::boot(sc);
  let wid = big_world(sc);
  let cid = test_world::mint_character(sc, test_world::owner());
  join(sc, cid, 1000);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  let (px, pz) = (world::x(&cp), world::z(&cp));
  let (zx, zy) = world::zone_of(&w, px, pz);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000);
  zones::search_for_testing(&mut w, &mut k, &pkcap, cid, px, pz, &cfg, &ver, &clk);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  (cid, zx, zy)
}

/// The witness a client composes off its own mirror — the full stream, then one inclusion path.
public struct Witness has drop {
  index: u64,
  spawn_id: u64,
  template: ID,
  members: vector<ID>,
  progress: u64,
  x: u32,
  z: u32,
  group_size: u16,
  group_seed: u64,
  proof: vector<u8>,
}

fun witness(sc: &mut Scenario, zx: u32, zy: u32): Witness {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let seed = zones::zone_seed(&w, zx, zy);
  let at = zones::zone_discovered_at(&w, zx, zy);
  let (sids, tpls, rosters, xs, zs, sizes, gseeds, progress) =
    zones::member_stream_for_testing(&w, zx, zy, cfg.team_size_bound());
  let proof = zone_gen::mob_group_member_proof_for_testing(
    object::id(&w), zx, zy, seed, at, progress, &sids, &tpls, &rosters, &xs, &zs, &sizes, &gseeds, 0,
  );
  let mut members = rosters[0];
  while (members.length() > (sizes[0] as u64)) { members.pop_back(); };
  let out = Witness {
    index: 0, spawn_id: sids[0], template: tpls[0], members, progress, x: xs[0], z: zs[0],
    group_size: sizes[0], group_seed: gseeds[0], proof,
  };
  ts::return_shared(w); ts::return_shared(cfg);
  out
}

#[test]
/// BASELINE — realistic zone searched, witness composed, NO claim. Subtract this from the two below.
fun probe_0_baseline() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, zx, zy) = searched(&mut sc);
  let w = witness(&mut sc, zx, zy);
  assert!(w.proof.length() > 0);
  sc.end();
}

#[test]
/// THE OLD PATH — the derive door re-runs the whole zone composition to find one spawn_id.
fun probe_1_derive_claim() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy) = searched(&mut sc);
  let wit = witness(&mut sc, zx, zy);
  assert!(wit.proof.length() > 0);
  let spawn_id = wit.spawn_id;
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  let ticket = zones::claim_mob_group_in_zone_members(&mut w, &mut k, &pkcap, cid, zx, zy, spawn_id, &cfg, &ver, &clk);
  zones::y75(ticket);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  sc.end();
}

#[test]
/// THE NEW PATH — one leaf hash plus an O(log n) sibling fold; the zone is never derived.
fun probe_2_proof_claim() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy) = searched(&mut sc);
  let wit = witness(&mut sc, zx, zy);
  assert!(wit.proof.length() > 0);
  let Witness { index, spawn_id, template, members, progress, x, z, group_size, group_seed, proof } = wit;
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  let ticket = zones::claim_mob_group_in_zone_members_with_proof(
    &mut w, &mut k, &pkcap, cid, zx, zy, index, spawn_id, template, members, progress, x, z,
    group_size, group_seed, proof, &cfg, &ver, &clk,
  );
  zones::y75(ticket);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  sc.end();
}

// The two probes above measure the CLAIM DOORS, which share a security tail (travel-verify, checkpoint write,
// consumed bit, event). These two isolate the mechanism #2194 is actually about, with no tail in the number:
//   zone derivation  = `probe_3_derivation_only` − `probe_0_baseline`
//   inclusion verify = `probe_4_path_verify_only` − `probe_0_baseline`

#[test]
/// ONE extra full zone derivation on top of the baseline — what the old claim door pays to find a spawn_id.
fun probe_3_derivation_only() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, zx, zy) = searched(&mut sc);
  let w = witness(&mut sc, zx, zy);
  assert!(w.proof.length() > 0);
  sc.next_tx(test_world::owner());
  let world = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let (sids, _t, _r, _x, _z, _s, _g, _p) = zones::member_stream_for_testing(&world, zx, zy, cfg.team_size_bound());
  assert!(sids.length() > 0);
  ts::return_shared(world); ts::return_shared(cfg);
  sc.end();
}

#[test]
/// ONE extra inclusion verify on top of the baseline — what the new claim door pays instead.
fun probe_4_path_verify_only() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, zx, zy) = searched(&mut sc);
  let wit = witness(&mut sc, zx, zy);
  assert!(wit.proof.length() > 0);
  sc.next_tx(test_world::owner());
  let world = sc.take_shared<World>();
  let Witness { index, spawn_id, template, members, progress, x, z, group_size, group_seed, proof } = wit;
  let root = zones::group_commitment_root_for_testing(&world, zx, zy);
  let count = zones::group_commitment_count_for_testing(&world, zx, zy);
  assert!(zone_gen::mob_group_member_root_matches(
    &root, count, object::id(&world), zx, zy, zones::zone_seed(&world, zx, zy),
    zones::zone_discovered_at(&world, zx, zy), progress, index, spawn_id, template, members, x, z,
    group_size, group_seed, &proof,
  ));
  ts::return_shared(world);
  sc.end();
}

// THE OTHER HALF OF THE LEDGER: the flip moves work onto the SEARCH door (a tree is ~2n hashes; a whole-set
// commitment is one hash over one big preimage). Search happens ONCE per zone and claims happen per fight, so
// the trade only has to be favourable — but it has to be MEASURED, not assumed:
//   format-3 commitment build = `probe_5_format_3_commitment` − `probe_0_baseline`
//   format-4 tree build       = `probe_6_format_4_tree`       − `probe_0_baseline`

#[test]
/// The OLD search-side commitment: one hash over the whole derived set.
fun probe_5_format_3_commitment() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, zx, zy) = searched(&mut sc);
  let w = witness(&mut sc, zx, zy);
  assert!(w.proof.length() > 0);
  sc.next_tx(test_world::owner());
  let world = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let (sids, tpls, rosters, xs, zs, sizes, gseeds, _p) =
    zones::member_stream_for_testing(&world, zx, zy, cfg.team_size_bound());
  let root = zone_gen::mob_group_commitment_members(
    object::id(&world), zx, zy, zones::zone_seed(&world, zx, zy), zones::zone_discovered_at(&world, zx, zy),
    &sids, &tpls, &rosters, &xs, &zs, &sizes, &gseeds,
  );
  assert!(root.length() == 33);
  ts::return_shared(world); ts::return_shared(cfg);
  sc.end();
}

#[test]
/// The NEW search-side commitment: a Merkle tree over per-group leaves.
fun probe_6_format_4_tree() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, zx, zy) = searched(&mut sc);
  let w = witness(&mut sc, zx, zy);
  assert!(w.proof.length() > 0);
  sc.next_tx(test_world::owner());
  let world = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let (sids, tpls, rosters, xs, zs, sizes, gseeds, progress) =
    zones::member_stream_for_testing(&world, zx, zy, cfg.team_size_bound());
  let root = zone_gen::mob_group_member_root(
    object::id(&world), zx, zy, zones::zone_seed(&world, zx, zy), zones::zone_discovered_at(&world, zx, zy),
    progress, &sids, &tpls, &rosters, &xs, &zs, &sizes, &gseeds,
  );
  assert!(root.length() == 33);
  ts::return_shared(world); ts::return_shared(cfg);
  sc.end();
}
