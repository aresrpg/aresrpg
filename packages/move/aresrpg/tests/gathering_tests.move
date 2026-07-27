// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GATHERING tests: the §6 instant harvest end-to-end (travel-verify → node consume → job XP → checkpoint move →
/// mint+lock the yield through the cap door) plus the full abort matrix (no equipment map, wrong tool, depleted
/// node, tier-locked, travel-too-far, template mismatch) and the pure formula/protector-rate property tests. The
/// gather runs through the deterministic `gather_for_testing` door; the real `&Random` `entry` shares the body.
#[test_only]
module aresrpg::gathering_tests;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, gathering, item::{Item, ItemTemplate}, mob_template::{Self, MobTemplate}, test_world, version::Version, world::{Self, World}, zones, zones_view};
use aresrpg_fight::{
  admin::{Self as fight_admin, AdminCap as FightAdminCap},
  fight::Fight,
  fight_registry::{Self, FightRegistry},
  version::{Self as fight_version, Version as EngineVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, random::{Self, Random}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

// ── mirrored error values ──
const ETemplateMismatch: u64 = 103; // gathering
const ENoTool: u64 = 105; // gathering
const ETierLocked: u64 = 106; // gathering
const ERareTemplateMismatch: u64 = 107; // gathering
const EWrongProtector: u64 = 108; // gathering (P1-1)
const ETravelTooFar: u64 = 102; // checkpoint
const EBadNode: u64 = 106; // zones (kept: undiscovered-zone / out-of-derived-range gathers)
const ENodeEmpty: u64 = 107; // zones (double-harvest — the cell's consumed bit is already set)

const HUGE_ELAPSED: u64 = 10_000_000_000; // dwarfs any in-zone distance → travel always passes

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
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
}

fun do_gather(sc: &mut Scenario, who: address, cid: ID, zx: u32, zy: u32, node_index: u64, template_id: ID, now: u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(template_id);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut reg = sc.take_shared<FightRegistry>();
  let ptmpl = sc.take_shared<MobTemplate>();
  let eng_ver = sc.take_shared<EngineVersion>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  // default test worlds carry NO rare link → settle_rare returns early; the base template is a harmless rare dummy
  gathering::gather_for_testing(&mut w, &mut k, &pkcap, cid, zx, zy, node_index, &template, &template, &policy, &mut reg, &ptmpl, &eng_ver, &cfg, &ver, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(template); ts::return_shared(policy); ts::return_shared(reg); ts::return_shared(ptmpl); ts::return_shared(eng_ver); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Gather passing a DISTINCT rare template (linked-resource path — the real `settle_rare` draw runs).
fun do_gather_with_rare(sc: &mut Scenario, who: address, cid: ID, zx: u32, zy: u32, node_index: u64, base_tid: ID, rare_tid: ID, now: u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(base_tid);
  let rare = sc.take_shared_by_id<ItemTemplate>(rare_tid);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut reg = sc.take_shared<FightRegistry>();
  let ptmpl = sc.take_shared<MobTemplate>();
  let eng_ver = sc.take_shared<EngineVersion>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  gathering::gather_for_testing(&mut w, &mut k, &pkcap, cid, zx, zy, node_index, &template, &rare, &policy, &mut reg, &ptmpl, &eng_ver, &cfg, &ver, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(template); ts::return_shared(rare); ts::return_shared(policy); ts::return_shared(reg); ts::return_shared(ptmpl); ts::return_shared(eng_ver); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Count items locked in `who`'s personal kiosk (character + minted resource stacks).
fun kiosk_item_count(sc: &mut Scenario, who: address): u32 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let n = k.item_count();
  ts::return_shared(k);
  n
}

/// Force a golden-gather jackpot mint (deterministic — bypasses the RARE_BP draw): the exact hit-path writes
/// (mint + kiosk-lock + `RareGathered`). Template identity is settle_rare's PRE-roll gate in the live path.
fun force_rare(sc: &mut Scenario, who: address, rare_tid: ID, base_tid: ID, wid: ID) {
  sc.next_tx(who);
  let rare = sc.take_shared_by_id<ItemTemplate>(rare_tid);
  let ver = sc.take_shared<Version>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  gathering::test_mint_rare(&rare, base_tid, who, wid, &ver, &mut k, personal_kiosk::borrow(&pkcap), &policy, sc.ctx());
  ts::return_shared(rare); ts::return_shared(ver); ts::return_shared(policy); ts::return_shared(k); sc.return_to_sender(pkcap);
}

/// Overwrite the character's checkpoint to a known position (deterministic travel-too-far setup).
fun pin_checkpoint(sc: &mut Scenario, who: address, cid: ID, wid: ID, x: u32, z: u32, time: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::z2(chr, wid, world::z44(x, z, time, false), &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

fun occupied_zone(sc: &mut Scenario, who: address, cid: ID, wid: ID): (u32, u32) {
  sc.next_tx(who);
  let w = sc.take_shared<World>();
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  let (zx, zy) = world::zone_of(&w, world::x(&cp), world::z(&cp));
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  (zx, zy)
}

fun job_xp_of(sc: &mut Scenario, who: address, cid: ID, job: u8): u64 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let xp = character_link::job_xp(k.borrow(personal_kiosk::borrow(&pkcap), cid), job);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  xp
}

fun cp_of(sc: &mut Scenario, who: address, cid: ID, wid: ID): world::Checkpoint {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cp = character_link::checkpoint(k.borrow(personal_kiosk::borrow(&pkcap), cid), wid);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  cp
}

fun node_pos(sc: &mut Scenario, zx: u32, zy: u32, i: u64): (u32, u32) {
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  let (x, z) = zones_view::resource_pos(&w, zx, zy, i);
  ts::return_shared(w);
  (x, z)
}

/// Stand up the FIGHT ENGINE (registry + version, enabled) and mint ONE synthetic protector `MobTemplate` (shared)
/// — the protector-ambush spawn needs both. The real protector templates are a SEED follow-up; the MECHANISM only
/// needs a valid template. `do_gather` finds this template via `take_shared<MobTemplate>` (it is the only one).
fun boot_fight_engine(sc: &mut Scenario) {
  fight_version::test_init(sc.ctx());
  fight_admin::test_init(sc.ctx());
  fight_registry::test_init(sc.ctx());
  sc.next_tx(test_world::owner());
  let fcap = sc.take_from_sender<FightAdminCap>();
  let mut fver = sc.take_shared<EngineVersion>();
  fight_admin::admin_set_enabled(&fcap, &mut fver, true, sc.ctx()); // the engine ships dark — enable it
  ts::return_shared(fver); sc.return_to_sender(fcap);

  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  mob_template::mint(&cap, &ver, b"protector".to_string(), 1, 1, 50, 0, 0, spell::el_fire(), spell::stats_zero(), vector[], vector[], 10, sc.ctx());
  ts::return_shared(ver); sc.return_to_sender(cap);
}

/// Full setup: boot, fight engine + protector template, resource template, world (tier param), character, join,
/// search the occupied zone. Returns (cid, wid, tid, zx, zy).
fun discovered(sc: &mut Scenario, tier: u8): (ID, ID, ID, u32, u32) {
  test_world::boot(sc);
  boot_fight_engine(sc);
  let tid = test_world::make_resource_template(sc);
  let wid = test_world::make_world(sc, tid, 0, tier); // job 0 = FARMER
  let cid = test_world::mint_character(sc, test_world::owner());
  do_join(sc, test_world::owner(), cid, 1000);
  let (zx, zy) = occupied_zone(sc, test_world::owner(), cid, wid);
  let cp = cp_of(sc, test_world::owner(), cid, wid);
  do_search(sc, test_world::owner(), cid, world::x(&cp), world::z(&cp), 2000);
  (cid, wid, tid, zx, zy)
}

// ╔════════════════ [ Happy path ] ═══════════════════════════════════════════ ]

#[test]
fun gather_yields_xp_moves_checkpoint_consumes_node() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false); // FARMER tool, no pet
  let (nx, nz) = node_pos(&mut sc, zx, zy, 0);

  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED);

  // the harvested cell (remaining=1) is consumed and removed → 2 nodes drop to 1, job XP granted (tier-1 in-band
  // base = 10), checkpoint moved to the node
  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 1);
  ts::return_shared(w);
  assert_eq!(job_xp_of(&mut sc, test_world::owner(), cid, 0), 10);
  let cp = cp_of(&mut sc, test_world::owner(), cid, wid);
  assert_eq!(world::x(&cp), nx);
  assert_eq!(world::z(&cp), nz);
  sc.end();
}

#[test]
/// The REAL &Random `gather` entry (the deterministic `gather_for_testing` twin shares its exact body): harvest a
/// discovered node off a seeded framework Random. Proves the entry wrapper itself runs.
fun gather_random_entry() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false); // FARMER tool

  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0303030303030303030303030303030303030303030303030303030303030303", sc.ctx());
  ts::return_shared(r);

  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(tid);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut reg = sc.take_shared<FightRegistry>();
  let ptmpl = sc.take_shared<MobTemplate>();
  let eng_ver = sc.take_shared<EngineVersion>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let rr = sc.take_shared<Random>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(2000 + HUGE_ELAPSED);
  gathering::gather(&mut w, &mut k, &pkcap, cid, zx, zy, 0, &template, &template, &policy, &mut reg, &ptmpl, &eng_ver, &cfg, &ver, &clk, &rr, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(template); ts::return_shared(policy); ts::return_shared(reg); ts::return_shared(ptmpl); ts::return_shared(eng_ver); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  sc.end();
}

/// Pin `protector_id` as the ambush defender of resource `tid` on the shared world (P1-1 dial).
fun pin_protector(sc: &mut Scenario, tid: ID, protector_id: ID) {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let mut w = sc.take_shared<World>();
  let ver = sc.take_shared<Version>();
  world::set_resource_protector(&cap, &mut w, tid, option::some(protector_id), &ver, sc.ctx());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
}

/// The shared protector MobTemplate's id (`boot_fight_engine` mints exactly one).
fun protector_id(sc: &mut Scenario): ID {
  sc.next_tx(test_world::owner());
  let t = sc.take_shared<MobTemplate>();
  let id = object::id(&t);
  ts::return_shared(t);
  id
}

/// Gather passing an EXPLICIT protector MobTemplate (the P1-1 decoy path needs a second template).
fun do_gather_with_protector(sc: &mut Scenario, who: address, cid: ID, zx: u32, zy: u32, node_index: u64, template_id: ID, ptmpl_id: ID, now: u64) {
  sc.next_tx(who);
  let mut w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(template_id);
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut reg = sc.take_shared<FightRegistry>();
  let ptmpl = sc.take_shared_by_id<MobTemplate>(ptmpl_id);
  let eng_ver = sc.take_shared<EngineVersion>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  gathering::gather_for_testing(&mut w, &mut k, &pkcap, cid, zx, zy, node_index, &template, &template, &policy, &mut reg, &ptmpl, &eng_ver, &cfg, &ver, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(template); ts::return_shared(policy); ts::return_shared(reg); ts::return_shared(ptmpl); ts::return_shared(eng_ver); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Set the world's protector-ambush rate (admin + version gated) — 10_000 bp = always fires.
fun set_protector_bp(sc: &mut Scenario, bp: u64) {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let mut w = sc.take_shared<World>();
  let ver = sc.take_shared<Version>();
  world::set_protector_bp(&cap, &mut w, bp, &ver, sc.ctx());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
}

#[test]
/// PROTECTOR AMBUSH (§17.22, wired): at a 100% rate the gather roll SPAWNS a real solo PvM fight — INTRA-call, atomic
/// with the harvest (undodgeable). Then a SECOND gather with the now-MARKED gatherer SKIPS the spawn (can't be in two
/// fights) yet still completes — proving the yield never reverts. No `Fight` exists before; one exists after.
fun protector_trigger_spawns_fight_then_skips_when_marked() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false); // FARMER tool
  set_protector_bp(&mut sc, 10_000); // the ambush ALWAYS fires
  let pid = protector_id(&mut sc);
  pin_protector(&mut sc, tid, pid); // P1-1: only a PINNED node ambushes — this is also the right-witness PASS proof

  sc.next_tx(test_world::owner());
  assert!(!ts::has_most_recent_shared<Fight>()); // no fight yet

  // gather #1 — protector fires, gatherer UNMARKED → a real ambush fight spawns (node 0's cell harvested + removed)
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED);
  sc.next_tx(test_world::owner());
  assert!(ts::has_most_recent_shared<Fight>()); // the protector fight now exists

  // gather #2 — protector fires again, but the gatherer is now MARKED → the spawn is SKIPPED, harvest still lands.
  // (if the skip were broken, `mark_seated` would abort ECharacterMarked and revert this gather — reaching `end` proves it.)
  // gather #1 consumed cell 0's BIT and moved the checkpoint there; derivation indices are STABLE, so #2 targets
  // the OTHER cell at index 1; a fresh HUGE_ELAPSED past the #1 checkpoint keeps that in-zone hop travel-legal.
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 1, tid, 2000 + HUGE_ELAPSED + HUGE_ELAPSED);
  sc.end();
}

#[test]
/// P1-1 LEGACY/None path: an UNPINNED node NEVER ambushes — even at a 100% roll rate the harvest lands and no
/// fight exists (the old client-chosen-defender hole is closed by default).
fun protector_unpinned_node_never_ambushes() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false); // FARMER tool
  set_protector_bp(&mut sc, 10_000); // the roll ALWAYS fires — and must still not ambush
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED);
  sc.next_tx(test_world::owner());
  assert!(!ts::has_most_recent_shared<Fight>()); // no pin → no fight, ever
  let w = sc.take_shared<World>();
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 1); // the harvest landed (1-charge cell removed) regardless
  ts::return_shared(w);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongProtector, location = gathering)]
/// P1-1 EXPLOIT CLOSED: a pinned node refuses any defender but its pin — the cherry-picked trivial protector
/// (the tier-lattice laundering move) aborts the gather.
fun protector_wrong_template_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false); // FARMER tool
  set_protector_bp(&mut sc, 10_000);
  let pid = protector_id(&mut sc);
  pin_protector(&mut sc, tid, pid);
  // mint the DECOY the attacker would cherry-pick
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let decoy = mob_template::mint(&cap, &ver, b"decoy".to_string(), 1, 1, 1, 0, 0, spell::el_fire(), spell::stats_zero(), vector[], vector[], 10, sc.ctx());
  ts::return_shared(ver); sc.return_to_sender(cap);
  do_gather_with_protector(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, decoy, 2000 + HUGE_ELAPSED); // EWrongProtector
  abort
}

// ╔════════════════ [ Abort matrix ] ═════════════════════════════════════════ ]

#[test, expected_failure(abort_code = ENoTool, location = gathering)]
fun gather_without_equipment_map_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  // no equip() → NO equipment map attached: a fresh char that walks to a node and presses gather must hit the
  // HONEST ENoTool ("you need a tool"), never the old EEquipmentUnavailable plumbing abort (RIDER-3, design ruling 2026-07-11).
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED); // ENoTool
  abort
}

#[test, expected_failure(abort_code = ENoTool, location = gathering)]
fun gather_with_wrong_tool_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[2], false); // MINER tool (2); resource needs FARMER (0)
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED); // ENoTool
  abort
}

#[test, expected_failure(abort_code = ENodeEmpty, location = zones)]
fun gather_depleted_node_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  // deplete EVERY derived cell (one bit each) — indices still DERIVE, but every bit is set
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  let total = zones_view::resource_node_total(&w, zx, zy);
  let mut i = 0;
  while (i < total) { zones::z52(&mut w, zx, zy, i); i = i + 1; }; // one bit per derived cell
  assert_eq!(zones_view::resource_node_count(&w, zx, zy), 0);
  ts::return_shared(w);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED); // ENodeEmpty (bit already set)
  abort
}

#[test, expected_failure(abort_code = ETierLocked, location = gathering)]
fun gather_tier_locked_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 2); // tier 2 → z502 level 10; a level-1 job can't
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED); // ETierLocked
  abort
}

#[test, expected_failure(abort_code = ETravelTooFar, location = world)]
fun gather_travel_too_far_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);
  // pin the proven position to a far corner, then gather a near node only 1s later → unreachable
  pin_checkpoint(&mut sc, test_world::owner(), cid, wid, 450_000, 450_000, 2000);
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 3000); // ETravelTooFar
  abort
}

#[test, expected_failure(abort_code = ETemplateMismatch, location = gathering)]
fun gather_wrong_template_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, _tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);
  let wrong_tid = test_world::make_resource_template(&mut sc); // a DIFFERENT template than the node spawns
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, wrong_tid, 2000 + HUGE_ELAPSED); // ETemplateMismatch
  abort
}

// ╔════════════════ [ Pure formula + protector-rate property tests ] ═════════ ]

#[test]
fun yield_scales_with_job_level() {
  assert_eq!(gathering::test_yield(1, 1), 1); // no bonus at the z502 level
  assert_eq!(gathering::test_yield(6, 1), 2); // (6−1)/5 = 1
  assert_eq!(gathering::test_yield(11, 1), 3); // (11−1)/5 = 2
  assert_eq!(gathering::test_yield(50, 10), 9); // (50−10)/5 = 8
}

#[test]
fun job_xp_full_in_band_then_decays() {
  assert_eq!(gathering::test_job_xp(1, 1), 10); // tier 1 base, in band
  assert_eq!(gathering::test_job_xp(1, 11), 10); // at the band top
  assert_eq!(gathering::test_job_xp(1, 50), 5); // out of band → decayed, never zero
  assert_eq!(gathering::test_job_xp(3, 30), 30); // tier 3 base 30, in band (z502 20 + width 10)
  assert_eq!(gathering::test_job_xp(3, 100), 15); // out of band → 30/2
}

#[test]
fun protector_rate_is_statistically_sane() {
  let mut gen = random::new_generator_for_testing();
  let mut hits = 0u64;
  let mut i = 0u64;
  while (i < 2000) {
    if (gathering::test_protector_fires(2500, &mut gen)) hits = hits + 1; // 25% rate
    i = i + 1;
  };
  assert!(hits > 400 && hits < 600); // ~500 expected; generous band for the deterministic PRNG
}

#[test]
fun protector_zero_rate_never_fires() {
  let mut gen = random::new_generator_for_testing();
  assert!(!gathering::test_protector_fires(0, &mut gen));
}

// ╔════════════════ [ Golden-gather (§6 rare jackpot) ] ═══════════════════════ ]

#[test]
/// RARE_BP is the fixed 0.1% jackpot rate (10 / 10_000); the shared bp-roll fires at the ceiling, never at 0.
fun rare_bp_is_ten_and_rolls() {
  assert_eq!(gathering::test_rare_bp(), 10);
  let mut gen = random::new_generator_for_testing();
  assert!(gathering::test_protector_fires(10_000, &mut gen)); // 0..9999 < 10000 → always fires
  assert!(!gathering::test_protector_fires(0, &mut gen)); // a 0 rate never fires
}

#[test]
/// No rare link on the resource ⇒ the gather mints ONLY the base yield (no jackpot branch, no extra item).
fun gather_without_rare_link_mints_only_base() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1); // default world: NO rare link
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);

  sc.next_tx(test_world::owner());
  let w = sc.take_shared<World>();
  assert!(world::rare_link(&w, tid).is_none());
  ts::return_shared(w);

  let before = kiosk_item_count(&mut sc, test_world::owner());
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED);
  let after = kiosk_item_count(&mut sc, test_world::owner());
  assert_eq!(after, before + 1); // exactly ONE new stack (base) — no rare
  sc.end();
}

#[test]
/// Jackpot hit mints the rare IN ADDITION to the normal yield (additive — the base stack is never reduced). The
/// base yield lands via a real (unlinked) gather; the rare is then forced deterministically → net +2 stacks.
fun rare_hit_mints_additively() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, wid, tid, zx, zy) = discovered(&mut sc, 1);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);

  let c0 = kiosk_item_count(&mut sc, test_world::owner()); // character only
  do_gather(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, 2000 + HUGE_ELAPSED); // + base stack
  let c1 = kiosk_item_count(&mut sc, test_world::owner());
  assert_eq!(c1, c0 + 1); // normal yield minted

  let rare_tid = test_world::make_template(&mut sc, b"Golden Wheat", b"golden_wheat", b"resource", 1);
  test_world::link_rare(&mut sc, tid, rare_tid);
  force_rare(&mut sc, test_world::owner(), rare_tid, tid, wid); // deterministic jackpot (the hit-path writes)
  let c2 = kiosk_item_count(&mut sc, test_world::owner());
  assert_eq!(c2, c1 + 1); // rare ADDED on top — additive, normal yield intact
  sc.end();
}

#[test]
/// A linked gather with the CORRECT rare template and a MISSED roll still succeeds: the pre-roll identity assert
/// passes silently and the base yield mints (+1 exactly — the deterministic test rng misses the 0.1% draw). Proves
/// the assert does NOT require a hit (lead ruling: identity gates BEFORE the draw, success must not depend on it).
fun gather_linked_correct_template_missed_roll_succeeds() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  let rare_tid = test_world::make_template(&mut sc, b"Golden Wheat", b"golden_wheat", b"resource", 1);
  test_world::link_rare(&mut sc, tid, rare_tid);
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);

  let before = kiosk_item_count(&mut sc, test_world::owner());
  do_gather_with_rare(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, rare_tid, 2000 + HUGE_ELAPSED);
  let after = kiosk_item_count(&mut sc, test_world::owner());
  assert_eq!(after, before + 1); // base minted, rare draw missed, NO abort — the gather succeeded
  sc.end();
}

#[test, expected_failure(abort_code = ERareTemplateMismatch, location = gathering)]
/// A LINKED resource gathered with the WRONG rare template aborts BEFORE the draw — 100% deterministic, NO jackpot
/// hit needed (lead ruling: a stale/wrong client must fail every gather, never lose a won 0.1% roll to the abort).
fun rare_wrong_template_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _wid, tid, zx, zy) = discovered(&mut sc, 1);
  let rare1 = test_world::make_template(&mut sc, b"Golden Wheat", b"golden_wheat", b"resource", 1);
  let rare2 = test_world::make_template(&mut sc, b"Shiny Barley", b"shiny_barley", b"resource", 1);
  test_world::link_rare(&mut sc, tid, rare1); // the world links rare1…
  test_world::equip(&mut sc, test_world::owner(), cid, vector[0], false);
  do_gather_with_rare(&mut sc, test_world::owner(), cid, zx, zy, 0, tid, rare2, 2000 + HUGE_ELAPSED); // …rare2 presented → ERareTemplateMismatch pre-roll
  abort
}
