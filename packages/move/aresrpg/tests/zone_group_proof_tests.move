/// Proof-taking mob-group claim tests. Search commits chain-derived group facts; claims authenticate one group
/// without re-running zone derivation, then reuse the original travel/bitmap/checkpoint/GroupTicket gauntlet.
#[test_only]
module aresrpg::zone_group_proof_tests;

use aresrpg::{
  admin::AdminCap,
  character_link,
  checkpoint,
  config::GameConfig,
  test_world,
  version::Version,
  world::{Self, World},
  zone_comp,
  zones
};
use aresrpg_foundation::zone_gen;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const EBadGroupProof: u64 = 110;
const HUGE_ELAPSED: u64 = 10_000_000_000;

public struct Witness has drop {
  index: u64,
  spawn_id: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  group_seed: u64,
  proof: vector<u8>,
}

public struct TicketFacts has copy, drop {
  world: ID,
  character: ID,
  spawn_id: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  spawned_at_ms: u64,
  group_seed: u64,
}

fun ticket_facts(ticket: zones::GroupTicket): TicketFacts {
  let (world, character, spawn_id, template, x, z, group_size, spawned_at_ms, group_seed) =
    zones::consume_group_ticket(ticket);
  TicketFacts { world, character, spawn_id, template, x, z, group_size, spawned_at_ms, group_seed }
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

fun search(sc: &mut Scenario, cid: ID, x: u32, z: u32, now: u64) {
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
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

/// Standard searched occupied zone; returns world/character/zone and the adjacent-zone standing point.
fun discovered(sc: &mut Scenario): (ID, ID, u32, u32, u32, u32) {
  test_world::boot(sc);
  let tid = test_world::make_resource_template(sc);
  let wid = test_world::make_world(sc, tid, 0, 1);
  let cid = test_world::mint_character(sc, test_world::owner());
  join(sc, cid, 1000);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  let (px, pz) = (checkpoint::x(&cp), checkpoint::z(&cp));
  let (zx, zy) = world::zone_of(&w, px, pz);
  let (ox, oz) = world::zone_origin(&w, zx, zy);
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  search(sc, cid, px, pz, 2000);
  (wid, cid, zx, zy, ox + 512, oz)
}

fun witness(sc: &mut Scenario, zx: u32, zy: u32, index: u64): Witness {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let seed = zones::zone_seed(&w, zx, zy);
  let at = zones::zone_discovered_at(&w, zx, zy);
  let (sids, tpls, xs, zs, sizes, gseeds) =
    zone_comp::derive_mobs(&w, zx, zy, seed, cfg.team_size_bound());
  let proof = zone_gen::mob_group_proof_for_testing(
    object::id(&w), zx, zy, seed, at, &sids, &tpls, &xs, &zs, &sizes, &gseeds, index,
  );
  let out = Witness {
    index,
    spawn_id: sids[index],
    template: tpls[index],
    x: xs[index],
    z: zs[index],
    group_size: sizes[index],
    group_seed: gseeds[index],
    proof,
  };
  ts::return_shared(w); ts::return_shared(cfg);
  out
}

fun claim_original(sc: &mut Scenario, cid: ID, spawn_id: u64): TicketFacts {
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  let ticket = zones::claim_mob_group(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  let out = ticket_facts(ticket);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  out
}

fun claim_occupied(sc: &mut Scenario, cid: ID, w: Witness): TicketFacts {
  let Witness { index, spawn_id, template, x, z, group_size, group_seed, proof } = w;
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  let ticket = zones::claim_mob_group_with_proof(
    &mut world, &mut k, &pkcap, cid, index, spawn_id, template, x, z, group_size, group_seed,
    proof, &cfg, &ver, &clk,
  );
  let out = ticket_facts(ticket);
  clk.destroy_for_testing();
  ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  out
}

fun claim_searched(sc: &mut Scenario, cid: ID, zx: u32, zy: u32, w: Witness): TicketFacts {
  let Witness { index, spawn_id, template, x, z, group_size, group_seed, proof } = w;
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + 2 * HUGE_ELAPSED);
  let ticket = zones::claim_mob_group_in_zone_with_proof(
    &mut world, &mut k, &pkcap, cid, zx, zy, index, spawn_id, template, x, z, group_size,
    group_seed, proof, &cfg, &ver, &clk,
  );
  let out = ticket_facts(ticket);
  clk.destroy_for_testing();
  ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  out
}

fun assert_ticket_eq(a: TicketFacts, b: TicketFacts) { assert_eq!(a, b); }

#[test]
fun occupied_proof_ticket_matches_original_door() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  let spawn_id = w.spawn_id;
  let original = claim_original(&mut sc, cid, spawn_id);
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  zones::reopen_mob_group_for_testing(&mut world, zx, zy, 0);
  ts::return_shared(world);
  let proven = claim_occupied(&mut sc, cid, w);
  assert_ticket_eq(original, proven);
  sc.end();
}

#[test]
fun searched_zone_proof_claims_from_another_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, cid, zx, zy, bx, bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  let (expected_x, expected_z) = (w.x, w.z);
  search(&mut sc, cid, bx, bz, 2000 + HUGE_ELAPSED);
  let ticket = claim_searched(&mut sc, cid, zx, zy, w);
  assert_eq!(ticket.world, wid); assert_eq!(ticket.character, cid);
  assert_eq!(ticket.x, expected_x); assert_eq!(ticket.z, expected_z);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
fun forged_proof_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  let byte = &mut w.proof[0];
  *byte = *byte ^ 1;
  let _ticket = claim_occupied(&mut sc, cid, w);
  abort
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
fun forged_group_fact_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  w.group_seed = w.group_seed + 1;
  let _ticket = claim_occupied(&mut sc, cid, w);
  abort
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
fun mismatched_zone_proof_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, bx, bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  search(&mut sc, cid, bx, bz, 2000 + HUGE_ELAPSED);
  claim_searched(&mut sc, cid, zx + 1, zy, w);
  abort
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
fun proof_from_prior_search_aborts_after_reroll() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  search(&mut sc, cid, w.x, w.z, 2000 + HUGE_ELAPSED);
  let _ticket = claim_occupied(&mut sc, cid, w);
  abort
}

#[test]
fun rootless_zone_uses_original_derivation() {
  let mut sc = ts::begin(test_world::owner());
  let (wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  let (expected_spawn, expected_template, expected_x, expected_z, expected_size, expected_seed) =
    (w.spawn_id, w.template, w.x, w.z, w.group_size, w.group_seed);
  w.template = object::id_from_address(@0xBAD);
  w.x = 0; w.z = 0; w.group_size = 99; w.group_seed = 0; w.proof = vector[];
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  zones::remove_group_commitment_for_testing(&mut world, zx, zy);
  ts::return_shared(world);
  let ticket = claim_occupied(&mut sc, cid, w);
  assert_eq!(ticket.world, wid); assert_eq!(ticket.character, cid); assert_eq!(ticket.spawn_id, expected_spawn);
  assert_eq!(ticket.template, expected_template); assert_eq!(ticket.x, expected_x); assert_eq!(ticket.z, expected_z);
  assert_eq!(ticket.group_size, expected_size); assert_eq!(ticket.group_seed, expected_seed);
  sc.end();
}

/// Independent JS/BCS fixture for a three-leaf duplicate-last tree; catches field-order/domain/odd-proof drift.
#[test]
fun fixed_merkle_vector_matches_js() {
  let world = object::id_from_address(@0x1);
  let spawn_ids = vector[21, 22, 23];
  let templates = vector[
    object::id_from_address(@0x1f), object::id_from_address(@0x20), object::id_from_address(@0x21),
  ];
  let xs = vector[41, 42, 43];
  let zs = vector[51, 52, 53];
  let sizes = vector[2, 3, 4];
  let seeds = vector[61, 62, 63];
  let root = zone_gen::mob_group_root(
    world, 7, 9, 11, 13, &spawn_ids, &templates, &xs, &zs, &sizes, &seeds,
  );
  assert_eq!(root, vector[
    52,170,69,100,71,198,129,94,198,138,86,190,214,54,60,180,
    45,113,79,138,182,5,223,221,179,93,106,162,157,210,19,219,
  ]);
  let proof = zone_gen::mob_group_proof_for_testing(
    world, 7, 9, 11, 13, &spawn_ids, &templates, &xs, &zs, &sizes, &seeds, 2,
  );
  assert_eq!(proof, vector[
    199,91,112,185,32,117,37,236,109,195,186,202,114,25,202,212,
    18,230,46,224,206,149,22,224,52,164,157,87,106,4,93,33,
    202,71,4,1,115,177,158,50,236,92,56,127,0,175,191,88,
    179,10,105,183,233,80,17,207,135,92,230,119,45,95,77,162,
  ]);
  assert!(zone_gen::mob_group_root_matches(
    &root, 3, world, 7, 9, 11, 13, 2, 23, templates[2], 43, 53, 4, 63, &proof,
  ));
}

#[test]
fun draining_zone_removes_adjacent_commitment() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut world = sc.take_shared<World>();
  assert!(zones::zone_exists(&world, zx, zy));
  assert!(zones::group_commitment_exists_for_testing(&world, zx, zy));
  zones::drain_zones(&cap, &mut world, vector[zx], vector[zy], &ver, sc.ctx());
  assert!(!zones::zone_exists(&world, zx, zy));
  assert!(!zones::group_commitment_exists_for_testing(&world, zx, zy));
  ts::return_shared(world); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}
