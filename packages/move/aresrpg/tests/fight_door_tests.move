// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT-DOOR tests (S-69 — the defeat-brick fix): drive the REAL `fight::create` / `fight::join` doors
/// end-to-end (world → search → claim ticket → engine create/join) and prove the seat snapshot SETTLES lazy
/// natural regen (ANNEX §5.4) before the engine's §17.23 0-HP gate:
///   • a defeated (stored hp=0) character re-enters once regen has accrued — the pre-fix RAW read bricked them
///     FOREVER (every door refused EZeroHp; chain-proven on qasenshi);
///   • immediate re-entry at TRUE zero (no whole HP accrued yet) still refuses EZeroHp — dead can't fight;
///   • the settled read pair (`combat_stats_settled` / `geared_combat_stats_settled`) returns the exact regen
///     value the seat receives (`combatant_of` passes it verbatim), while raw `combat_stats` stays stored.
/// The heal remainder-carry regression (y14 UNTOUCHED) stays proven by fight_seam_tests.
///
/// The DEFEAT-RELEASE door (#609) is proven here too, on the same real harness: a lost fight puts its mob group
/// back in the world at its spot and the group is fightable again, while a victory outcome and a mis-named group
/// are both refused.
#[test_only]
module aresrpg::fight_door_tests;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, equipment, fight as fight_doors, mob_template::{Self, MobTemplate}, results, test_world, version::Version, world::{Self, World}, zones, zones_view};
use aresrpg_fight::{
  actions,
  admin as eadmin,
  fight::{Self as engine, Fight},
  fight_registry::{Self, FightRegistry},
  settlement,
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

// ── mirrored error values (location disambiguates the aborting module) ──
const ENGINE_EZeroHp: u64 = 101; // aresrpg_fight::fight — §17.23 (create/join refuse a 0-HP snapshot)
const ENotDefeat: u64 = 113; // aresrpg::fight — release_group: the seat WON (only defeat releases)
const EWrongGroup: u64 = 114; // aresrpg::fight — release_group: the named group is not the outcome's group

const HUGE_ELAPSED: u64 = 10_000_000_000; // dwarfs any in-zone distance → travel-verify always passes
// Senshi L1 regen: (150 + 6·level)/75_000 HP per ms = 156/75_000 → +10 HP over 5000ms; 0 whole HP over 400ms.
const T0: u64 = 2_000 + HUGE_ELAPSED; // the defeat write-back instant (post-discovery, travel-safe)
const PARTIAL_MS: u64 = 5_000; // → settled hp 10 (not 0, not the 70 max)
const SUBUNIT_MS: u64 = 400; // → settled hp 0 (156×400/75000 < 1 — still truly dead)

// ╔════════════════ [ Harness — engine boot + real mob template + world wired to it ] ═ ]

/// Boot the ENGINE package half: registry + version + admin, then flip the engine Version live.
fun boot_engine(sc: &mut Scenario) {
  sc.next_tx(test_world::owner());
  fight_registry::test_init(sc.ctx());
  eversion::test_init(sc.ctx());
  eadmin::test_init(sc.ctx());
  sc.next_tx(test_world::owner());
  let ecap = sc.take_from_sender<eadmin::AdminCap>();
  let mut ever = sc.take_shared<EVersion>();
  eadmin::admin_set_enabled(&ecap, &mut ever, true, sc.ctx());
  ts::return_shared(ever);
  sc.return_to_sender(ecap);
}

/// Mint + share a REAL MobTemplate (min==max level 1, empty kit/loot) — `fight::create` asserts the ticket's
/// template id equals this object's id, so the world's mob entry must be authored with it (not a fabricated ID).
fun make_mob_template(sc: &mut Scenario): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, b"rat".to_string(), 1, 1, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], 100, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// `test_world::make_world` with the mob entry wired to the REAL template id (same densities: 2 groups/search).
fun make_world_with_mob(sc: &mut Scenario, resource_tid: ID, mob_tid: ID): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"glacial".to_string(), sc.ctx());
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, 2, 2, 2, 2, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, resource_tid, 100, 3, 3, 0, 1, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, mob_tid, 100, 2, 2, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  wid
}

/// Full stand-up: both package halves, a real mob template, a world wired to it, the character owned by OWNER joined +
/// searched (zone holds 2 claimable groups). Returns `(cid, mob_tid, spawn0)`.
fun discovered(sc: &mut Scenario): (ID, ID, u64) {
  test_world::boot(sc);
  boot_engine(sc);
  let rtid = test_world::make_resource_template(sc);
  let mob_tid = make_mob_template(sc);
  let wid = make_world_with_mob(sc, rtid, mob_tid);
  let cid = test_world::mint_character(sc, test_world::owner());
  do_zone_join(sc, test_world::owner(), cid, 1000);
  let (zx, zy, cx, cz) = occupied_zone(sc, cid, wid);
  do_search(sc, test_world::owner(), cid, cx, cz, 2000);
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let spawn0 = zones_view::mob_spawn_id(&w, zx, zy, 0);
  ts::return_shared(w);
  (cid, mob_tid, spawn0)
}

// ╔════════════════ [ Drivers (mirroring fight_seam_tests, plus the real doors) ] ═ ]

fun do_zone_join(sc: &mut Scenario, who: address, cid: ID, now: u64) {
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

fun occupied_zone(sc: &mut Scenario, cid: ID, wid: ID): (u32, u32, u32, u32) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  let (zx, zy) = world::zone_of(&w, aresrpg::world::x(&cp), aresrpg::world::z(&cp));
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  (zx, zy, aresrpg::world::x(&cp), aresrpg::world::z(&cp))
}

/// Defeat write-back on `who`'s character in kiosk `kid` (the §17.23 post-fight hp store, stamped at `now`).
fun write_hp(sc: &mut Scenario, who: address, kid: ID, cid: ID, hp: u64, now: u64) {
  sc.next_tx(who);
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::y13(chr, hp, now, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

/// The settled/raw hp read pair off kiosk `kid`: `(combat_stats_settled hp, geared_combat_stats_settled hp,
/// raw combat_stats hp)` at `now` — the first two are the exact number `combatant_of` seats.
fun hp_reads(sc: &mut Scenario, who: address, kid: ID, cid: ID, now: u64): (u64, u64, u64) {
  sc.next_tx(who);
  let k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
  let (_c, _l, settled, _m, _a, _mp) = character_link::combat_stats_settled(chr, &cfg, now);
  let (_c2, _l2, geared, _m2, _a2, _mp2, _st) = equipment::geared_combat_stats_settled(chr, &cfg, now);
  let (_c3, _l3, raw, _m3, _a3, _mp3) = character_link::combat_stats(chr, &cfg);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  (settled, geared, raw)
}

/// Claim spawn `spawn_id` and CREATE the fight through the REAL door in the same tx (hot-potato ticket law).
fun do_create(sc: &mut Scenario, who: address, cid: ID, spawn_id: u64, mob_tid: ID, now: u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let mut reg = sc.take_shared<FightRegistry>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(sc, mob_tid);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  let ticket = zones::claim_mob_group(&mut w, &mut k, &pkcap, cid, spawn_id, &cfg, &ver, &clk);
  fight_doors::create(&mut reg, ticket, &w, &mut k, &pkcap, &tmpl, true, option::none(), vector[], &cfg, &ver, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  ts::return_shared(reg); ts::return_shared(tmpl);
}

/// Join the (single) shared Fight through the REAL `join` door as `who` (own kiosk `kid`).
fun do_join(sc: &mut Scenario, who: address, kid: ID, cid: ID, now: u64) {
  sc.next_tx(who);
  let mut f = sc.take_shared<Fight>();
  let mut reg = sc.take_shared<FightRegistry>();
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  fight_doors::join(&mut f, &mut reg, &mut k, &pkcap, cid, option::none(), vector[], &cfg, &ver, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(f); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
}

fun owner_kiosk_id(sc: &mut Scenario): ID {
  sc.next_tx(test_world::owner());
  ts::most_recent_id_shared<Kiosk>().destroy_some()
}

fun world_id(sc: &mut Scenario): ID {
  sc.next_tx(test_world::owner());
  ts::most_recent_id_shared<World>().destroy_some()
}

/// LOSE the fight and settle it: abandon in placement empties the players' side → DEFEAT, then the seat takes
/// its own outcome by value (`settle_and_take` — the Fight dies here). `release` chooses whether the same PTB
/// calls the #609 door before the outcome is opened; `index`/`zx`/`zy` name the group to put back.
fun lose_and_settle(sc: &mut Scenario, cid: ID, zx: u32, zy: u32, index: u64, release: bool, now: u64) {
  sc.next_tx(test_world::owner());
  let mut f = sc.take_shared<Fight>();
  let mut reg = sc.take_shared<FightRegistry>();
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  actions::abandon_for_testing(&mut f, cid, &ever, now, test_world::owner());
  let outcome = settlement::settle_and_take(f, cid, &mut reg, &ever, sc.ctx());
  assert_eq!(settlement::outcome(&outcome), engine::status_defeat()); // the mobs won
  if (release) fight_doors::release_group(&mut w, &reg, &outcome, zx, zy, index, &cfg, &ver);
  results::open_for_testing(outcome, &mut k, &pkcap, &cfg, &ver, now, sc.ctx());
  ts::return_shared(reg); ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
}

/// `(live?, the stored mob-bitmap BYTES, the group's engagement round)` for derived group `index`. The bytes are
/// what the client mirror (`packages/sim/src/zone_derive.js`) reads verbatim — the sim's parity fixture
/// (`packages/sim/test/fixtures/zone_group_release.json`) pins the very values asserted here.
fun group_state(sc: &mut Scenario, zx: u32, zy: u32, index: u64): (bool, vector<u8>, u64) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let live = zones::mob_group_live(&w, zx, zy, index);
  let bytes = zones::mob_bitmap_for_testing(&w, zx, zy);
  let round = zones::group_round(&w, zx, zy, zones_view::mob_spawn_id(&w, zx, zy, index));
  ts::return_shared(w);
  (live, bytes, round)
}

// ╔════════════════ [ The settled read pair (the exact seat number) ] ═════════ ]

#[test]
/// `combat_stats_settled`/`geared_combat_stats_settled` regenerate the STORED block by elapsed time while the raw
/// `combat_stats` keeps reading storage: wounded 25/70 @5000 → settled 35 @10000 (+156/75000×5000), raw stays 25.
/// A block-less character settles to FULL (defaults path unchanged).
fun settled_reads_regenerate_raw_stays_stored() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  let kid = owner_kiosk_id(&mut sc);
  let (s0, g0, r0) = hp_reads(&mut sc, test_world::owner(), kid, cid, 999_999);
  assert_eq!(s0, 70); // no block → full HP (defaults path)
  assert_eq!(g0, 70);
  assert_eq!(r0, 70);
  write_hp(&mut sc, test_world::owner(), kid, cid, 25, 5_000);
  let (s1, g1, r1) = hp_reads(&mut sc, test_world::owner(), kid, cid, 10_000);
  assert_eq!(s1, 35); // 25 + 5000ms × 156/75000 = +10
  assert_eq!(g1, 35); // the geared fold seats the SAME settled number (no gear → same scalars)
  assert_eq!(r1, 25); // the raw read still reports storage (block readers unchanged)
  sc.end();
}

// ╔════════════════ [ CREATE — the defeat-brick fix + the still-dead refusal ] ═ ]

#[test]
/// THE S-69 BUG: defeat writes hp=0; after a PARTIAL regen window the character re-enters through the REAL
/// `fight::create` door (pre-fix: the raw snapshot hp=0 hit the engine's EZeroHp forever). The seat receives the
/// exact settled value — 10 HP (not 0, not the 70 max) — asserted at the read `combatant_of` consumes verbatim.
fun create_after_defeat_settles_regen_and_seats() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, mob_tid, spawn0) = discovered(&mut sc);
  let kid = owner_kiosk_id(&mut sc);
  write_hp(&mut sc, test_world::owner(), kid, cid, 0, T0); // defeat → stored 0/70
  let (settled, geared, raw) = hp_reads(&mut sc, test_world::owner(), kid, cid, T0 + PARTIAL_MS);
  assert_eq!(settled, 10); // the regen value: not 0 (door passes), not 70 (elapsed does NOT top it)
  assert_eq!(geared, 10); // the seat snapshot number
  assert_eq!(raw, 0); // storage still says defeated — only the settle unbricks
  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0 + PARTIAL_MS); // pre-fix: aborts EZeroHp
  sc.next_tx(test_world::owner());
  let f = sc.take_shared<Fight>();
  assert_eq!(engine::participant_count(&f), 1); // seated
  assert_eq!(engine::mob_count(&f), 2); // the claimed group materialized
  ts::return_shared(f);
  sc.end();
}

#[test, expected_failure(abort_code = ENGINE_EZeroHp, location = aresrpg_fight::fight)]
/// §17.23 law intact: at TRUE zero (a sub-unit regen window — 0 whole HP accrued) the door still refuses.
/// Dead can't fight; the fix unbricks the healed-by-time, never the dead-right-now.
fun create_at_true_zero_still_refuses() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, mob_tid, spawn0) = discovered(&mut sc);
  let kid = owner_kiosk_id(&mut sc);
  write_hp(&mut sc, test_world::owner(), kid, cid, 0, T0);
  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0 + SUBUNIT_MS); // settled 0 → EZeroHp
  abort
}

// ╔════════════════ [ JOIN — the joiner-side defeat-brick fix ] ═══════════════ ]

#[test]
/// The JOINER path settles too: A (full HP) creates a PUBLIC fight; B — defeated to 0 — joins through the REAL
/// `join` door after the partial window. Two seats prove the whole join lane (snapshot → mark → engine).
fun join_after_defeat_settles_regen_and_seats() {
  let mut sc = ts::begin(test_world::owner());
  let (cid_a, mob_tid, spawn0) = discovered(&mut sc);
  do_create(&mut sc, test_world::owner(), cid_a, spawn0, mob_tid, T0); // A seats fresh (full HP)
  let cid_b = test_world::mint_character(&mut sc, @0xB);
  sc.next_tx(@0xB);
  let kid_b = ts::most_recent_id_shared<Kiosk>().destroy_some(); // B's own kiosk (minted after A's)
  write_hp(&mut sc, @0xB, kid_b, cid_b, 0, T0); // B defeated
  let (settled, _g, raw) = hp_reads(&mut sc, @0xB, kid_b, cid_b, T0 + PARTIAL_MS);
  assert_eq!(settled, 10);
  assert_eq!(raw, 0);
  do_join(&mut sc, @0xB, kid_b, cid_b, T0 + PARTIAL_MS); // pre-fix: EZeroHp bricked B forever
  sc.next_tx(@0xB);
  let f = sc.take_shared<Fight>();
  assert_eq!(engine::participant_count(&f), 2); // A + B seated
  ts::return_shared(f);
  sc.end();
}

// ╔════════════════ [ #609 — DEFEAT RELEASES THE GROUP, VICTORY CONSUMES IT ] ═ ]

#[test]
/// THE #609 BUG, end to end on the real doors: claim + create consumes the group, the player LOSES, and the
/// settlement's defeat outcome releases the group back into the world at its spot — bit clear, bitmap back to
/// its pre-claim byte shape, engagement round 1. Pre-fix the bit stayed set forever, so every player death
/// drained the world by one group. Then the REMATCH lands: a second claim + create over the same spawn succeeds,
/// which round 0's derived address (claimed once, reserved forever) could never have allowed.
fun defeat_releases_the_group_and_the_rematch_lands() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, mob_tid, spawn0) = discovered(&mut sc);
  let wid = world_id(&mut sc);
  let (zx, zy, _cx, _cz) = occupied_zone(&mut sc, cid, wid);

  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0);
  let (live, bytes, round) = group_state(&mut sc, zx, zy, 0);
  assert!(!live); // engaged — the claim consumed it
  assert_eq!(bytes, vector[1u8]); // the fixture's "claimed" step: bit 0 set
  assert_eq!(round, 0);

  lose_and_settle(&mut sc, cid, zx, zy, 0, true, T0);
  let (live, bytes, round) = group_state(&mut sc, zx, zy, 0);
  assert!(live); // THE FIX: the mobs won, so the mobs are still there
  assert_eq!(bytes, vector[]); // the fixture's "released" step: byte-identical to before the claim
  assert_eq!(round, 1); // the next fight over it claims the round-1 address

  // and it is really fightable again (settled regen unbricks the 0-HP defeat write-back, S-69)
  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0 + PARTIAL_MS);
  let (live, _bytes, round) = group_state(&mut sc, zx, zy, 0);
  assert!(!live); // engaged again
  assert_eq!(round, 1); // the round only moves on RELEASE, never on claim
  sc.next_tx(test_world::owner());
  let f = sc.take_shared<Fight>();
  assert_eq!(engine::mob_count(&f), 2); // the same group materialized a second time
  ts::return_shared(f);
  sc.end();
}

#[test, expected_failure(abort_code = ENotDefeat, location = aresrpg::fight)]
/// A VICTORY outcome cannot release: only losing gives the group back (otherwise a farmed group could be
/// respawned by its own killer). The outcome is branded and names the real fight — only its status differs.
fun victory_outcome_cannot_release_the_group() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, mob_tid, spawn0) = discovered(&mut sc);
  let wid = world_id(&mut sc);
  let (zx, zy, _cx, _cz) = occupied_zone(&mut sc, cid, wid);
  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0);
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let reg = sc.take_shared<FightRegistry>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let f = sc.take_shared<Fight>();
  let o = settlement::outcome_for_testing(
    fight_doors::brand_type_for_testing(), object::id(&f), wid, cid,
    engine::status_victory(), 10, 0, 0, 0, 1, vector[], false, 0, option::none(), 100, sc.ctx(),
  );
  fight_doors::release_group(&mut w, &reg, &o, zx, zy, 0, &cfg, &ver);
  abort
}

#[test, expected_failure(abort_code = EWrongGroup, location = aresrpg::fight)]
/// A defeat outcome releases EXACTLY the group it was lost to: naming the zone's OTHER group fails the
/// derived-address binding (that group's fight address is not this outcome's fight).
fun defeat_outcome_cannot_release_another_group() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, mob_tid, spawn0) = discovered(&mut sc);
  let wid = world_id(&mut sc);
  let (zx, zy, _cx, _cz) = occupied_zone(&mut sc, cid, wid);
  do_create(&mut sc, test_world::owner(), cid, spawn0, mob_tid, T0);
  lose_and_settle(&mut sc, cid, zx, zy, 1, true, T0); // index 1 = the group nobody fought
  abort
}

#[test]
/// The PUBLIC snapshot + dial factories (package-split 2026-07-11 — the PvP arena package composes them for its
/// own-branded engine fights): `combat_snapshot` assembles a real Combatant off a kiosk-locked character through
/// the caller's own cap + a real Clock (the un-fakeable regen stamp), and `domain_pvp` names the arena's
/// kill-switch bit (distinct, single-bit). Deep behavioral proof lives in the arena package's e2e (start/seat land
/// real branded fights off these snapshots); this covers the core-side surface.
fun public_snapshot_factories_execute() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  sc.next_tx(test_world::owner());
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  let snapshot = fight_doors::combat_snapshot(&k, &pkcap, cid, vector[], &cfg, &clk);
  std::unit_test::destroy(snapshot); // assembly executed off the real character (getters are engine-internal)
  // the arena kill-switch bit: a real single bit, distinct from its neighbours (the mask math depends on it)
  assert!(aresrpg::config::domain_pvp() == 4);
  assert!(aresrpg::config::domain_pvp() != aresrpg::config::domain_market());
  clk.destroy_for_testing();
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  sc.end();
}
