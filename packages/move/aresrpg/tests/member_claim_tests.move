// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE MEMBER PATH END TO END (#1110/#1111) — search a zone, claim a mixed pack, build it template by template,
/// fight it. This is the product's primary path after the wave: a fresh search writes a format-3 commitment, and
/// a format-3 zone is claimable ONLY through the member doors.
///
/// Two things are pinned here that no unit test can reach: the ROUTER (each format has exactly one door, and
/// crossing aborts rather than silently degrading), and the SUBSTITUTION refusal driven through the real claim —
/// the roster the builder checks is the one the chain derived, not one the test handed it.
#[test_only]
module aresrpg::member_claim_tests;

use aresrpg::{admin::AdminCap, config::GameConfig, fight as fight_doors, mob_template::{Self, MobTemplate}, test_world, version::Version, world::{Self, World}, zone_comp, zones, zones_view};
use aresrpg_fight::{
  admin as eadmin,
  fight::{Self as engine, Fight},
  fight_latch::{Self, FightLatch, FightLatchShards},
  fight_registry::{Self, FightRegistry, FightShards},
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const TEAM_BOUND: u64 = 6;
const HUGE_ELAPSED: u64 = 10_000_000_000; // dwarfs any in-zone distance → travel-verify always passes
const NOW: u64 = 2_000 + HUGE_ELAPSED;

const EMemberZone: u64 = 112; // aresrpg::zones — the original doors refuse a member-list zone
const ENotMemberZone: u64 = 113; // aresrpg::zones — the member doors refuse a pre-member zone
const EWrongMember: u64 = 114; // aresrpg_fight::fight — add_member: not the next committed template

fun boot_engine(sc: &mut Scenario) {
  sc.next_tx(test_world::owner());
  fight_registry::test_init(sc.ctx());
  fight_latch::test_init(sc.ctx());
  eversion::test_init(sc.ctx());
  eadmin::test_init(sc.ctx());
  sc.next_tx(test_world::owner());
  let ecap = sc.take_from_sender<eadmin::AdminCap>();
  let mut ever = sc.take_shared<EVersion>();
  eadmin::admin_set_enabled(&ecap, &mut ever, true, sc.ctx());
  ts::return_shared(ever);
  sc.return_to_sender(ecap);
}

/// A real shared `MobTemplate` at its own authored band — the two species a mixed pack draws from.
fun make_template(sc: &mut Scenario, name: vector<u8>, min_level: u16, max_level: u16, xp: u64): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, name.to_string(), min_level, max_level, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], xp, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// A world whose mob table holds BOTH species at equal rate — the ruled model spawns either anywhere, so a
/// derived pack genuinely mixes.
fun make_world_with(sc: &mut Scenario, resource_tid: ID, a: ID, b: ID): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"glacial".to_string(), sc.ctx());
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, 2, 2, 2, 2, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, resource_tid, 100, 3, 3, 0, 1, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, a, 100, 3, 3, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, b, 100, 3, 3, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  wid
}

fun do_join(sc: &mut Scenario, cid: ID) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  zones::join_for_testing(&w, &mut k, &pkcap, cid, &cfg, &ver, &clk);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

fun do_search(sc: &mut Scenario, cid: ID, x: u32, z: u32) {
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000);
  zones::search_for_testing(&mut w, &mut k, &pkcap, cid, x, z, &cfg, &ver, &clk);
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

/// Stand everything up and search the character's own zone. Returns `(cid, zx, zy, rat, wolf)` — the two species
/// are minted HERE because the admin cap only exists after the boot.
fun discovered(sc: &mut Scenario): (ID, u32, u32, ID, ID) {
  test_world::boot(sc);
  boot_engine(sc);
  let rtid = test_world::make_resource_template(sc);
  let a = make_template(sc, b"rat", 1, 1, 100);
  let b = make_template(sc, b"wolf", 40, 40, 900);
  let wid = make_world_with(sc, rtid, a, b);
  let cid = test_world::mint_character(sc, test_world::owner());
  do_join(sc, cid);
  sc.next_tx(test_world::owner());
  let (cx, cz) = {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cp = aresrpg::character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
    ts::return_shared(k);
    sc.return_to_sender(pkcap);
    (aresrpg::world::x(&cp), aresrpg::world::z(&cp))
  };
  do_search(sc, cid, cx, cz);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (zx, zy) = world::zone_of(&w, cx, cz);
  ts::return_shared(w);
  (cid, zx, zy, a, b)
}

/// The roster the chain derived for group `index` — trimmed exactly the way the claim door trims it (the derived
/// roster runs at the RAW rolled size; the live team bound decides how many of it actually seat).
fun derived_roster(sc: &mut Scenario, zx: u32, zy: u32, index: u64): (u64, vector<ID>) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let seed = zones::zone_seed(&w, zx, zy);
  let (sids, _tpls, members, _xs, _zs, sizes, _gs, _p) = zone_comp::y72(&w, zx, zy, seed, TEAM_BOUND);
  let spawn_id = sids[index];
  let mut roster = members[index];
  while (roster.length() > (sizes[index] as u64)) { roster.pop_back(); };
  ts::return_shared(w);
  (spawn_id, roster)
}

fun shards_for(sc: &Scenario, scope: ID, character: ID): (FightRegistry, FightLatch) {
  let registries = sc.take_shared<FightShards>();
  let scope_shard = fight_registry::shard_for(&registries, scope);
  ts::return_shared(registries);
  let latches = sc.take_shared<FightLatchShards>();
  let latch_shard = fight_latch::shard_for(&latches, character);
  ts::return_shared(latches);
  (
    ts::take_shared_by_id<FightRegistry>(sc, scope_shard),
    ts::take_shared_by_id<FightLatch>(sc, latch_shard),
  )
}

/// Drive the whole door: claim → open → add every template in `order` → create. `rat`/`wolf` are the two shared
/// templates the world authored — taken ONCE and reused across the adds, exactly as a PTB passes one object
/// input to several commands.
fun engage(sc: &mut Scenario, cid: ID, spawn_id: u64, order: vector<ID>, rat: ID, wolf: ID) {
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let (mut reg, mut latch) = shards_for(sc, object::id(&w), cid);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(NOW);
  let ticket = zones::claim_mob_group_members(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  let mut build = fight_doors::open_group(ticket, &w, &mut k, &pkcap, true, option::none(), vector[], &cfg, &ver, &ever, &clk);
  let t_rat = ts::take_shared_by_id<MobTemplate>(sc, rat);
  let t_wolf = ts::take_shared_by_id<MobTemplate>(sc, wolf);
  let mut i = 0;
  while (i < order.length()) {
    if (order[i] == rat) fight_doors::add_member(&mut build, &t_rat)
    else fight_doors::add_member(&mut build, &t_wolf);
    i = i + 1;
  };
  ts::return_shared(t_rat);
  ts::return_shared(t_wolf);
  engine::create_members(build, &mut reg, &mut latch, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever); ts::return_shared(reg); ts::return_shared(latch);
}

#[test]
/// THE PATH: a searched zone is format 3, its group carries a real derived roster, and the fight that opens over
/// it seats exactly that roster — member `j` from `members[j]`, each with its own species on the Fight.
fun a_searched_zone_engages_as_the_pack_it_committed() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy, a, b) = discovered(&mut sc);
  let (spawn_id, roster) = derived_roster(&mut sc, zx, zy, 0);
  assert!(roster.length() >= 2); // the density authored 3-mob groups — a pack, not a solo
  engage(&mut sc, cid, spawn_id, roster, a, b);

  sc.next_tx(test_world::owner());
  let fight = sc.take_shared<Fight>();
  assert_eq!(engine::mob_count(&fight), roster.length());
  let mut i = 0;
  while (i < roster.length()) {
    // the per-index content door names the species the COMMITMENT named, position by position
    assert_eq!(engine::mob_template_at(&fight, i), roster[i]);
    i = i + 1;
  };
  assert!(engine::is_mixed(&fight)); // per-member fields exist — settlement will read the pack member by member
  ts::return_shared(fight);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongMember, location = aresrpg_fight::fight)]
/// THE EXPLOIT, driven through the REAL claim: swap the last committed member for the softest row in the table.
/// Under a roster-blind create this is a legal fight paying the committed pack's rewards; here the builder
/// refuses, because the roster it checks came off the chain's own derivation.
fun swapping_a_committed_member_for_the_softest_row_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy, a, b) = discovered(&mut sc);
  let (spawn_id, roster) = derived_roster(&mut sc, zx, zy, 0);
  // swap the LAST committed member for the other species in the table — whatever the seed derived, this is a
  // substitution (the weakest-template-×N shape when the swapped-in row is the soft one)
  let last = roster.length() - 1;
  let other = if (roster[last] == a) b else a;
  let mut forged = roster;
  *&mut forged[last] = other;
  engage(&mut sc, cid, spawn_id, forged, a, b);
  abort 0
}

#[test, expected_failure(abort_code = EMemberZone, location = aresrpg::zones)]
/// THE ROUTER, one way: the original claim door refuses a member-list zone rather than seating the primary N
/// times — a mono-spec fight over a mixed commitment is exactly the divergence the commitment prevents.
fun the_original_claim_door_refuses_a_member_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy, _a, _b) = discovered(&mut sc);
  let (spawn_id, _roster) = derived_roster(&mut sc, zx, zy, 0);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(NOW);
  let ticket = zones::claim_mob_group(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  zones::y74(ticket);
  abort 0
}

#[test, expected_failure(abort_code = ENotMemberZone, location = aresrpg::zones)]
/// THE ROUTER, the other way: a pre-member zone has no roster to commit, so a member claim over it would have to
/// invent one. Refuse — the original doors serve those zones forever.
fun the_member_claim_door_refuses_a_legacy_zone() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, zx, zy, _a, _b) = discovered(&mut sc);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  zones::set_merkle_root_commitment_for_testing(&mut w, zx, zy, TEAM_BOUND);
  let spawn_id = zones_view::mob_spawn_id(&w, zx, zy, 0);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(NOW);
  let ticket = zones::claim_mob_group_members(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  zones::y75(ticket);
  abort 0
}
