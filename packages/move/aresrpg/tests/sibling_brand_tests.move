// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SIBLING-BRAND DOOR TESTS (2026-07-13 gifting/dungeon split): the brand-gated core value twins — the ONLY
/// cross-package write surface the extracted gift/airdrop/loot_box/consume/pool/creation cluster and the
/// dungeon-run cluster get. Mirrors forge_brand_tests.move verbatim in shape: per twin, closed-by-default abort
/// (no pin → EWrongBrand), wrong-witness abort (a decoy type), right-witness pass with the delegated write PROVEN
/// by state read-back. The REAL sibling witnesses (`aresrpg_gifting::gifting::Gifting`,
/// `aresrpg_dungeon::dungeon::Dungeon`) drive these same doors end-to-end in the sibling packages' own suites —
/// here core proves the GATE, with local stand-in witnesses. Also pins the world dungeon-room read pair + the
/// pools domain bit (their callers moved out with the split; core keeps their surface honest).
#[test_only]
module aresrpg::sibling_brand_tests;

use aresrpg::{admin::AdminCap, character::Self as character, character_link, config::{Self, GameConfig}, fight as fight_doors, mob_template::{Self, MobTemplate}, test_world, version::Version, world::{Self, World}};
use aresrpg_fight::{
  admin as eadmin,
  fight::Fight,
  fight_registry::{Self, FightRegistry, FightShards},
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

/// The registry SHARD a scope maps to — `init` shares one per shard, so a suite resolves through the directory
/// exactly as a client does.
fun shard_of(sc: &Scenario, scope: ID): FightRegistry {
  let book = sc.take_shared<FightShards>();
  let shard = fight_registry::shard_for(&book, scope);
  ts::return_shared(book);
  ts::take_shared_by_id<FightRegistry>(sc, shard)
}

const OWNER: address = @0xA;
const EWrongBrand: u64 = 104; // config's brand-gate abort (mirror)

/// Local stand-in witnesses (the gate keys on the PINNED TypeName — any drop type works for core's gate tests).
public struct BrandA has drop {}
public struct BrandB has drop {}

fun pin_gifting_a(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_gifting_brand<BrandA>(&cap, &mut cfg, &ver, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); sc.return_to_sender(cap);
}

fun pin_dungeon_a(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_dungeon_brand<BrandA>(&cap, &mut cfg, &ver, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); sc.return_to_sender(cap);
}

// ╔════════════════ [ The pins themselves ] ═══════════════════════════════════ ]

#[test]
/// Both sibling pins ship unpinned (`none`), the setters pin, the pinned witnesses pass their asserts. The pools
/// domain bit rides along (its module moved out with the split — the constant read stays core surface).
fun pin_lifecycles() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  sc.next_tx(OWNER);
  {
    let cfg = sc.take_shared<GameConfig>();
    assert!(config::gifting_brand(&cfg).is_none()); // doors ship CLOSED
    assert!(config::dungeon_brand(&cfg).is_none());
    ts::return_shared(cfg);
  };
  pin_gifting_a(&mut sc);
  pin_dungeon_a(&mut sc);
  sc.next_tx(OWNER);
  {
    let cfg = sc.take_shared<GameConfig>();
    assert!(config::gifting_brand(&cfg).is_some());
    assert!(config::dungeon_brand(&cfg).is_some());
    config::assert_gifting_brand<BrandA>(&cfg); // the pinned witnesses pass
    config::assert_dungeon_brand<BrandA>(&cfg);
    config::assert_domain(&cfg, config::domain_pools()); // ships all-on (the pools kill-switch bit)
    ts::return_shared(cfg);
  };
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// No pin → the gifting doors are CLOSED (the ship default).
fun gifting_closed_by_default_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc); // boots WITHOUT a pin
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_gifting_brand<BrandA>(&cfg);
  abort 0
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// A witness that is not the pinned gifting one is refused.
fun gifting_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_gifting_brand<BrandB>(&cfg);
  abort 0
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// No pin → the dungeon doors are CLOSED (the ship default).
fun dungeon_closed_by_default_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_dungeon_brand<BrandA>(&cfg);
  abort 0
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// A witness that is not the pinned dungeon one is refused.
fun dungeon_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_dungeon_a(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_dungeon_brand<BrandB>(&cfg);
  abort 0
}

// ╔════════════════ [ Twin: character::new_brand (creation's mint door) ] ══════ ]

#[test]
/// Right witness mints a real Character + LockPledge over a scratch parent UID (the creation gate's UID in prod).
fun new_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut parent = object::new(sc.ctx());
  let cust = character::new_customization(1, 2, 3);
  let (chr, pledge) = character::new_brand(BrandA {}, &cfg, &mut parent, b"hero".to_string(), b"Hero".to_string(), b"senshi".to_string(), true, cust, 1000);
  assert_eq!(character::name(&chr), b"Hero".to_string());
  destroy(chr); destroy(pledge);
  object::delete(parent);
  ts::return_shared(cfg);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot mint a character — the free-character hole the brand gate exists to close.
fun new_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut parent = object::new(sc.ctx());
  let cust = character::new_customization(1, 2, 3);
  let (_chr, _pledge) = character::new_brand(BrandB {}, &cfg, &mut parent, b"hero".to_string(), b"Hero".to_string(), b"senshi".to_string(), true, cust, 1000);
  abort 0
}

// ╔════════════════ [ Twin: character_link::heal_hp_brand (consume's heal door) ] ═ ]

#[test]
/// Right witness heals a wounded character (read back through the progression getter).
fun heal_hp_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::y13(chr, 5, 1000, &ver); // wound to 5 so the heal has room
    character_link::heal_hp_brand(BrandA {}, &cfg, chr, 10, 1000, &ver);
    assert_eq!(character_link::progression_hp(chr), 15); // 5 + 10, zero regen (same stamp)
  };
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot heal.
fun heal_hp_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
  character_link::y13(chr, 5, 1000, &ver);
  character_link::heal_hp_brand(BrandB {}, &cfg, chr, 10, 1000, &ver);
  abort 0
}

// ╔════════════════ [ Twin: character_link::mint_and_lock_output_brand ] ═══════ ]

#[test]
/// Right witness mints + kiosk-locks a stack in one call and returns its id (airdrop/loot/pool output door).
fun mint_and_lock_output_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER); // creates the personal kiosk
  let tid = test_world::make_resource_template(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<aresrpg::item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<aresrpg::item::Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let iid = character_link::mint_and_lock_output_brand(BrandA {}, &cfg, &tmpl, 3, &ver, &mut k, personal_kiosk::borrow(&pkcap), &mkt, sc.ctx());
  assert!(k.has_item(iid)); // minted AND locked (the kiosk-lock constitution held)
  ts::return_shared(tmpl); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(mkt);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot mint — the free-mint hole stays closed.
fun mint_and_lock_output_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_gifting_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  let tid = test_world::make_resource_template(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<aresrpg::item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<aresrpg::item::Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let _iid = character_link::mint_and_lock_output_brand(BrandB {}, &cfg, &tmpl, 3, &ver, &mut k, personal_kiosk::borrow(&pkcap), &mkt, sc.ctx());
  abort 0
}

// ╔════════════════ [ Twins: fight::create_dungeon_fight_brand + join_vouched_brand ] ═ ]

/// Boot the ENGINE half: registry + version + admin, engine Version flipped live (fight_door_tests pattern).
fun boot_engine(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  fight_registry::test_init(sc.ctx());
  eversion::test_init(sc.ctx());
  eadmin::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let ecap = sc.take_from_sender<eadmin::AdminCap>();
  let mut ever = sc.take_shared<EVersion>();
  eadmin::admin_set_enabled(&ecap, &mut ever, true, sc.ctx());
  ts::return_shared(ever);
  sc.return_to_sender(ecap);
}

/// Mint + share a REAL MobTemplate (min==max level 1, empty kit/loot); returns its id.
fun make_mob_template(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
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

/// One room-fight create through the brand door as `who` (own kiosk `kid`), with witness type `W` packed by the
/// caller. Fabricated scope/nonce/seed — the door needs no world (the dungeon module verifies the pass upstream).
fun do_create_dungeon_fight<W: drop>(sc: &mut Scenario, w: W, kid: ID, cid: ID, mob_tid: ID) {
  sc.next_tx(OWNER);
  let mut reg = shard_of(sc, object::id_from_address(@0x5C09E));
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(sc, mob_tid);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  fight_doors::create_dungeon_fight_brand(w, &mut reg, object::id_from_address(@0x5C09E), 0, 7, 0, 0, &mut k, &pkcap, cid, vector[], &tmpl, 1, &cfg, &ver, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever); ts::return_shared(tmpl);
}

#[test]
/// Right witness drives BOTH dungeon fight doors end to end: `create_dungeon_fight_brand` mints the shared room
/// fight, then a SECOND character `join_vouched_brand`s into it (vouched = no membership assert — the dungeon
/// module verified its RunPass upstream).
fun dungeon_fight_brand_doors_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  boot_engine(&mut sc);
  pin_dungeon_a(&mut sc);
  let mob_tid = make_mob_template(&mut sc);

  let creator_cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER); // commit the share so the kiosk id resolves
  let creator_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  let joiner_cid = test_world::mint_character(&mut sc, @0xB1);
  sc.next_tx(@0xB1);
  let joiner_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();

  sc.next_tx(OWNER);
  do_create_dungeon_fight(&mut sc, BrandA {}, creator_kid, creator_cid, mob_tid);

  // the joiner vouches into the shared room fight through the second brand door
  sc.next_tx(@0xB1);
  {
    let mut f = sc.take_shared<Fight>();
    let mut reg = shard_of(&sc, object::id_from_address(@0x5C09E));
    let mut k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    fight_doors::join_vouched_brand(BrandA {}, &mut f, &mut reg, &mut k, &pkcap, joiner_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(f); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot mint a dungeon room fight.
fun create_dungeon_fight_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  boot_engine(&mut sc);
  pin_dungeon_a(&mut sc);
  let mob_tid = make_mob_template(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  do_create_dungeon_fight(&mut sc, BrandB {}, kid, cid, mob_tid);
  abort 0
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot vouch a join into a room fight.
fun join_vouched_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  boot_engine(&mut sc);
  pin_dungeon_a(&mut sc);
  let mob_tid = make_mob_template(&mut sc);
  let creator_cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let creator_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  let joiner_cid = test_world::mint_character(&mut sc, @0xB1);
  sc.next_tx(@0xB1);
  let joiner_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  sc.next_tx(OWNER);
  do_create_dungeon_fight(&mut sc, BrandA {}, creator_kid, creator_cid, mob_tid);
  sc.next_tx(@0xB1);
  let mut f = sc.take_shared<Fight>();
  let mut reg = shard_of(&sc, object::id_from_address(@0x5C09E));
  let mut k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  fight_doors::join_vouched_brand(BrandB {}, &mut f, &mut reg, &mut k, &pkcap, joiner_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
  abort 0
}

// ╔════════════════ [ World dungeon-room reads (their driver moved out with the split) ] ═ ]

#[test]
/// `add_dungeon_room` + the `dungeon_room`/`room_mobs` read pair round-trip (the dungeon sibling's roster source).
fun world_dungeon_room_reads() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let mob_id = object::id_from_address(@0xB0B);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let _wid = world::create_world(&cap, &ver, 7, b"cave".to_string(), sc.ctx());
  sc.next_tx(OWNER);
  let mut w = sc.take_shared<World>();
  world::add_dungeon_room(&cap, &mut w, vector[mob_id], &ver, sc.ctx());
  let room = world::dungeon_room(&w, 0);
  assert_eq!(world::room_mobs(room), vector[mob_id]);
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}
