// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORMAT-4 (member-list MERKLE) claim tests — #2194. A fresh search commits the derived pack list as a tree of
/// per-group leaves; the proof door authenticates ONE leaf with an inclusion path and never derives the zone,
/// while the format-3 derive door stays live for the zones that carry a whole-set commitment and as the
/// fallback a client keeps when it cannot compose a witness.
#[test_only]
module aresrpg::zone_member_proof_tests;

use aresrpg::{character_link, config::GameConfig, test_world, version::Version, world::{Self, World}, zones};
use aresrpg_foundation::zone_gen;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const ESpawnNotFound: u64 = 108;
const EBadGroupProof: u64 = 110;
const EMemberZone: u64 = 112;
const ENotMemberZone: u64 = 113;
const HUGE_ELAPSED: u64 = 10_000_000_000;

/// The witness a client composes off its own mirror of the derivation — the exact argument list the proof door
/// takes, carried as one value so a test can tamper with a single field and nothing else.
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

public struct TicketFacts has copy, drop {
  world: ID,
  character: ID,
  spawn_id: u64,
  template: ID,
  members: vector<ID>,
  progress: u64,
  x: u32,
  z: u32,
  group_size: u16,
  spawned_at_ms: u64,
  group_seed: u64,
}

fun ticket_facts(ticket: zones::MemberGroupTicket): TicketFacts {
  let (world, character, spawn_id, template, members, progress, x, z, group_size, spawned_at_ms, group_seed) =
    zones::y75(ticket);
  TicketFacts { world, character, spawn_id, template, members, progress, x, z, group_size, spawned_at_ms, group_seed }
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

/// Stamp the zone back to the FORMAT-3 whole-set commitment a pre-#2194 search wrote — the in-flight shape the
/// derive door must keep serving forever.
fun restamp_format_3(sc: &mut Scenario, zx: u32, zy: u32) {
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  zones::set_member_set_commitment_for_testing(&mut w, zx, zy, 6);
  ts::return_shared(w);
}

/// Standard searched occupied zone; returns world/character/zone plus a far standing point in another zone.
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
  let (px, pz) = (world::x(&cp), world::z(&cp));
  let (zx, zy) = world::zone_of(&w, px, pz);
  let (ox, oz) = world::zone_origin(&w, zx, zy);
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  search(sc, cid, px, pz, 2000);
  (wid, cid, zx, zy, ox + 512, oz)
}

/// Compose the witness the way a client does: rebuild the FULL member stream locally, then take the inclusion
/// path for one index. Nothing here reads chain state a `/v1` reader could not.
fun witness(sc: &mut Scenario, zx: u32, zy: u32, index: u64): Witness {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let cfg = sc.take_shared<GameConfig>();
  let seed = zones::zone_seed(&w, zx, zy);
  let at = zones::zone_discovered_at(&w, zx, zy);
  let (sids, tpls, rosters, xs, zs, sizes, gseeds, progress) =
    zones::member_stream_for_testing(&w, zx, zy, cfg.team_size_bound());
  let proof = zone_gen::mob_group_member_proof_for_testing(
    object::id(&w), zx, zy, seed, at, progress, &sids, &tpls, &rosters, &xs, &zs, &sizes, &gseeds, index,
  );
  // the COMMITTED roster is the seating list — the raw derived roster truncated to the group's size, which is
  // exactly what `derive_zone` hands a client and what the fight will seat
  let mut members = rosters[index];
  while (members.length() > (sizes[index] as u64)) { members.pop_back(); };
  let out = Witness {
    index,
    spawn_id: sids[index],
    template: tpls[index],
    members,
    progress,
    x: xs[index],
    z: zs[index],
    group_size: sizes[index],
    group_seed: gseeds[index],
    proof,
  };
  ts::return_shared(w); ts::return_shared(cfg);
  out
}

fun claim_with_proof(sc: &mut Scenario, cid: ID, zx: u32, zy: u32, w: Witness, at: u64): TicketFacts {
  let Witness { index, spawn_id, template, members, progress, x, z, group_size, group_seed, proof } = w;
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(at);
  let ticket = zones::claim_mob_group_in_zone_members_with_proof(
    &mut world, &mut k, &pkcap, cid, zx, zy, index, spawn_id, template, members, progress, x, z,
    group_size, group_seed, proof, &cfg, &ver, &clk,
  );
  let out = ticket_facts(ticket);
  clk.destroy_for_testing();
  ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  out
}

fun claim_derived(sc: &mut Scenario, cid: ID, zx: u32, zy: u32, spawn_id: u64, at: u64): TicketFacts {
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(at);
  let ticket = zones::claim_mob_group_in_zone_members(
    &mut world, &mut k, &pkcap, cid, zx, zy, spawn_id, &cfg, &ver, &clk,
  );
  let out = ticket_facts(ticket);
  clk.destroy_for_testing();
  ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  out
}

#[test]
/// THE FORMAT FLIP: a fresh search commits `0x04 ‖ root` — the byte every deriver dispatches on.
fun a_fresh_search_commits_the_member_tree() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, _cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones::group_commitment_format_for_testing(&w, zx, zy), 4);
  ts::return_shared(w);
  sc.end();
}

#[test]
/// THE POINT OF THE TICKET: the proof door and the derive door hand back the SAME pack — same primary, same
/// roster, same progress, same anchor. One re-derives the zone; the other verifies one path.
fun proof_and_derive_doors_seat_the_same_pack() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  let spawn_id = w.spawn_id;
  let derived = claim_derived(&mut sc, cid, zx, zy, spawn_id, 2000 + HUGE_ELAPSED);
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  zones::reopen_mob_group_for_testing(&mut world, zx, zy, 0);
  ts::return_shared(world);
  let proven = claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + 2 * HUGE_ELAPSED);
  assert_eq!(derived.template, proven.template);
  assert_eq!(derived.members, proven.members);
  assert_eq!(derived.progress, proven.progress);
  assert_eq!(derived.spawn_id, proven.spawn_id);
  assert_eq!(derived.x, proven.x);
  assert_eq!(derived.z, proven.z);
  assert_eq!(derived.group_size, proven.group_size);
  assert_eq!(derived.group_seed, proven.group_seed);
  assert_eq!(derived.spawned_at_ms, proven.spawned_at_ms);
  assert_eq!(derived.world, proven.world);
  assert_eq!(derived.character, proven.character);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
/// The class the roster is IN the leaf for: swapping one member for a softer species must not authenticate.
fun a_swapped_member_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  let primary = w.template;
  w.members.push_back(primary); // one more body than the commitment names
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
/// A softer pack: keep the length, change WHO is in it.
fun a_substituted_species_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  let fake = object::id_from_address(@0xfa4e);
  *(&mut w.members[0]) = fake;
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
/// An easier fight by shrinking the committed size.
fun a_shrunk_group_size_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  w.group_size = w.group_size + 1;
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
/// A softer level window: `progress` rides the leaf, so it cannot be dialled down at claim time.
fun a_lowered_progress_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  w.progress = w.progress + 1;
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
fun a_tampered_path_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  let byte = &mut w.proof[0];
  *byte = *byte ^ 0xff;
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = EBadGroupProof, location = zones)]
/// A path of the wrong LENGTH is refused before a single node is hashed (the depth check).
fun a_truncated_path_never_authenticates() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let mut w = witness(&mut sc, zx, zy, 0);
  w.proof = vector[];
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = ESpawnNotFound, location = zones)]
/// No double-fight of one group: the consumed bit is checked on the proof path exactly as on the derive path.
fun a_consumed_group_refuses_the_proof_door() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let first = witness(&mut sc, zx, zy, 0);
  let again = witness(&mut sc, zx, zy, 0);
  claim_with_proof(&mut sc, cid, zx, zy, first, 2000 + HUGE_ELAPSED);
  claim_with_proof(&mut sc, cid, zx, zy, again, 2000 + 2 * HUGE_ELAPSED);
  sc.end();
}

#[test, expected_failure(abort_code = ENotMemberZone, location = zones)]
/// FORMAT IS THE ROUTER: a whole-set (format-3) zone commits no per-group leaf, so the proof door refuses it
/// rather than falling back — a present commitment never degrades into a derivation after a bad proof.
fun a_format_3_zone_refuses_the_proof_door() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  restamp_format_3(&mut sc, zx, zy);
  claim_with_proof(&mut sc, cid, zx, zy, w, 2000 + HUGE_ELAPSED);
  sc.end();
}

#[test]
/// THE FALLBACK LAW: a client that cannot compose a witness keeps a working door — the derive claim still
/// serves a format-4 zone, so a proof-side failure is never an unplayable group.
fun the_derive_door_still_serves_a_format_4_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  let expected = w.members;
  let spawn_id = w.spawn_id;
  let facts = claim_derived(&mut sc, cid, zx, zy, spawn_id, 2000 + HUGE_ELAPSED);
  assert_eq!(facts.members, expected);
  sc.end();
}

#[test, expected_failure(abort_code = EMemberZone, location = zones)]
/// The single-spec ticket has nowhere to put a roster, so it refuses a member-tree zone exactly as it refuses
/// a format-3 one.
fun the_single_spec_door_refuses_a_format_4_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (_wid, cid, zx, zy, _bx, _bz) = discovered(&mut sc);
  let w = witness(&mut sc, zx, zy, 0);
  let spawn_id = w.spawn_id;
  sc.next_tx(test_world::owner());
  let mut world = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  let ticket = zones::claim_mob_group_in_zone(&mut world, &mut k, &pkcap, cid, zx, zy, spawn_id, &cfg, &ver, &clk);
  zones::y74(ticket);
  clk.destroy_for_testing();
  ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  sc.end();
}
