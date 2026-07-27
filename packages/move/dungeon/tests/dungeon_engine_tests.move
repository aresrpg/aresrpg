// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEON engine-bridge tests — the fight-composition surfaces the run unit suite punts to the e2e layer.
/// Stands up BOTH package halves (game + the branded fight engine) and drives the real bridge doors:
///   • dungeon `next_fight` (mint a room fight from the roster + latch the pass) and `join_fight` (a party member
///     re-derives the same-room fight and vouches in);
///   • dungeon `settle_run` (settle a latched pass off a branded `FightOutcome` — engine-free, fabricated outcome).
/// These exercise fight's `create_dungeon_fight` / `join_vouched` and the derivation helpers (`assert_homogeneous`,
/// `assert_same_room`, `fold_id`).
#[test_only]
module aresrpg_dungeon::dungeon_engine_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  character::Character,
  character_link,
  config::{Self, GameConfig},
  dungeon_lock,
  extract::{Self, ItemExtractPolicy},
  fight as fight_doors,
  item::{Self, Item},
  mob_template::{Self, MobTemplate},
  version::{Self, Version},
  world::{Self, World},
  zones
};
use aresrpg_dungeon::{dungeon, run::{Self, RunPass}, dungeon_world as test_world};
use aresrpg_fight::{
  admin as eadmin,
  fight::{Self as engine, Fight},
  fight_registry::{Self, FightRegistry, FightShards},
  settlement,
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{clock, coin, kiosk::Kiosk, sui::SUI, test_scenario::{Self as ts, Scenario}};

/// The registry SHARD a scope maps to — `init` shares one per shard, so a suite resolves through the directory
/// exactly as a client does. The dungeon's derivation scope is the RUN PASS id.
fun shard_of(sc: &Scenario, scope: ID): FightRegistry {
  let book = sc.take_shared<FightShards>();
  let shard = fight_registry::shard_for(&book, scope);
  ts::return_shared(book);
  ts::take_shared_by_id<FightRegistry>(sc, shard)
}


fun fid(): ID { object::id_from_address(@0xF16) }

/// Boot the ENGINE half: registry + version + admin, engine Version flipped live.
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

/// Author + share a real MobTemplate (min==max level 1, empty kit/loot).
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

/// The most-recently-shared personal kiosk id (mint_character shares it immediately before this).
fun last_kiosk_id(): ID { ts::most_recent_id_shared<Kiosk>().destroy_some() }

// ╔════════════════ [ settle_run — engine-free (fabricated branded outcome) ] ══ ]

#[test]
/// `settle_run`: a latched pass settles off a branded VICTORY `FightOutcome`. Room count 0 → the room is the last →
/// completion CONSUMES the run. Covers the FightResult-oracle read path in the dungeon settle bridge.
fun settle_run_victory_consumes() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let key_tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world(&mut sc, key_tid, 0, 1);

  sc.next_tx(test_world::owner());
  {
    let cap = sc.take_from_sender<AdminCap>();
    let ver = sc.take_shared<Version>();
    let mut w = sc.take_shared<World>();
    world::set_dungeon_key(&cap, &mut w, key_tid, &ver, sc.ctx());
    ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  };
  let cid = test_world::mint_character(&mut sc, test_world::owner());

  sc.next_tx(test_world::owner());
  {
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
  };
  let key_id = test_world::mint_lock_stack(&mut sc, test_world::owner(), key_tid, 1);

  sc.next_tx(test_world::owner());
  {
    let w = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let xpolicy = sc.take_shared<ItemExtractPolicy>();
    let (key, pledge) = extract::extract_one_for_burn(&mut k, &pkcap, key_id, &xpolicy, &ver, sc.ctx());
    dungeon::activate(&cfg, &w, &mut k, &pkcap, cid, key, pledge, &ver, &ver, sc.ctx());
    ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(xpolicy);
  };

  sc.next_tx(test_world::owner());
  let mut pass = sc.take_from_sender<RunPass>();
  run::latch(&mut pass, fid(), cid);
  let outcome = settlement::outcome_for_testing(
    fight_doors::brand_type_for_testing(), fid(), wid, cid,
    engine::status_victory(), 100, 0, 0, 0, 0, vector[], false, 0, option::none(), 100, sc.ctx(),
  );
  let w = sc.take_shared<World>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  dungeon::settle_run(pass, &outcome, &w, &mut k, &pkcap, &cfg, &ver, sc.ctx());
  ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver);
  destroy(outcome);
  sc.end();
}

// ╔════════════════ [ activate — burn a dungeon key, mint the bound run ] ═════ ]

#[test]
/// `activate`: split/burn exactly one unit from a locked stack, relock the original remainder, bind the run to
/// the character, enforce the pass-id world lock, then prove abandon releases it to the stored source world.
fun activate_splits_key_locks_character_and_abandon_releases() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let key_tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world(&mut sc, key_tid, 0, 1);

  // wire the world's dungeon-key template
  sc.next_tx(test_world::owner());
  {
    let cap = sc.take_from_sender<AdminCap>();
    let ver = sc.take_shared<Version>();
    let mut w = sc.take_shared<World>();
    world::set_dungeon_key(&cap, &mut w, key_tid, &ver, sc.ctx());
    ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  };

  let cid = test_world::mint_character(&mut sc, test_world::owner());

  // zone-join so the character is IN the world with a proven checkpoint (§17.25)
  sc.next_tx(test_world::owner());
  {
    let w = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    zones::join_for_testing(&w, &mut k, &pkcap, cid, &cfg, &ver, &clk);
    clk.destroy_for_testing();
    ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // mint a 3-unit key stack: activation must burn one and preserve this exact id at amount 2, locked.
  let key_id = test_world::mint_lock_stack(&mut sc, test_world::owner(), key_tid, 3);

  // ACTIVATE — split one, burn it, mint the character-bound run, and lock world state to the pass id.
  sc.next_tx(test_world::owner());
  {
    let world = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let xpolicy = sc.take_shared<ItemExtractPolicy>();
    let (key, pledge) = extract::extract_one_for_burn(&mut k, &pkcap, key_id, &xpolicy, &ver, sc.ctx());
    assert_eq!(item::amount(&key), 1);
    dungeon::activate(&cfg, &world, &mut k, &pkcap, cid, key, pledge, &ver, &ver, sc.ctx());
    ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(xpolicy);
  };

  // The pass landed with its character; the original key stack is still locked at amount 2.
  sc.next_tx(test_world::owner());
  {
    let pass = sc.take_from_sender<RunPass>();
    let pass_id = run::id(&pass);
    assert_eq!(run::room(&pass), 1);
    assert_eq!(run::character(&pass), cid);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    assert!(k.has_item(key_id));
    assert!(k.is_locked(key_id));
    let remainder = k.borrow<Item>(personal_kiosk::borrow(&pkcap), key_id);
    assert_eq!(item::amount(remainder), 2);
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(character_link::in_world(chr, pass_id));
    assert_eq!(dungeon_lock::pass(chr), option::some(pass_id));
    assert_eq!(dungeon_lock::world(chr), option::some(wid));
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    dungeon::abandon(pass, &mut k, &pkcap, &cfg, &ver, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  sc.next_tx(test_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(character_link::in_world(chr, wid));
    assert!(!dungeon_lock::is_locked(chr));
    ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  sc.end();
}

#[test]
/// A non-terminal win advances while retaining the pass-id lock; the following terminal defeat releases the
/// character to the original world before deleting the pass.
fun settle_keeps_lock_between_rooms_then_releases_on_end() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let key_tid = test_world::make_resource_template(&mut sc);
  let wid = test_world::make_world(&mut sc, key_tid, 0, 1);

  sc.next_tx(test_world::owner());
  {
    let cap = sc.take_from_sender<AdminCap>();
    let ver = sc.take_shared<Version>();
    let mut w = sc.take_shared<World>();
    world::set_dungeon_key(&cap, &mut w, key_tid, &ver, sc.ctx());
    ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  };
  let cid = test_world::mint_character(&mut sc, test_world::owner());

  sc.next_tx(test_world::owner());
  {
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
  };
  let key_id = test_world::mint_lock_stack(&mut sc, test_world::owner(), key_tid, 1);

  sc.next_tx(test_world::owner());
  {
    let w = sc.take_shared<World>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let xpolicy = sc.take_shared<ItemExtractPolicy>();
    let (key, pledge) = extract::extract_one_for_burn(&mut k, &pkcap, key_id, &xpolicy, &ver, sc.ctx());
    dungeon::activate(&cfg, &w, &mut k, &pkcap, cid, key, pledge, &ver, &ver, sc.ctx());
    ts::return_shared(w); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(xpolicy);
  };

  // Room 1 victory is non-terminal when room_count=3: lock remains and pass returns advanced.
  sc.next_tx(test_world::owner());
  {
    let mut pass = sc.take_from_sender<RunPass>();
    let pass_id = run::id(&pass);
    run::latch(&mut pass, fid(), cid);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    dungeon::settle_apply(pass, true, 3, &mut k, &pkcap, &cfg, &ver);
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(character_link::in_world(chr, pass_id));
    assert!(dungeon_lock::is_locked(chr));
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // The next fight loses: terminal settlement releases the same character and consumes the pass.
  sc.next_tx(test_world::owner());
  {
    let mut pass = sc.take_from_sender<RunPass>();
    assert_eq!(run::room(&pass), 2);
    run::latch(&mut pass, fid(), cid);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    dungeon::settle_apply(pass, false, 3, &mut k, &pkcap, &cfg, &ver);
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(character_link::in_world(chr, wid));
    assert!(!dungeon_lock::is_locked(chr));
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };
  sc.end();
}

// ╔════════════════ [ next_fight + join_fight — the real engine bridge ] ══════ ]

#[test]
/// `next_fight` mints a room fight from the pass's roster and latches the pass; a second player's `join_fight`
/// re-derives the same-room fight and vouches in. Drives fight's `create_dungeon_fight` + `join_vouched` + the
/// derivation helpers.
fun next_fight_then_join_fight() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  boot_engine(&mut sc);
  let mob_tid = make_mob_template(&mut sc);

  // wire a 1-mob dungeon room onto a fresh world; capture its id for the passes
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"cave".to_string(), sc.ctx());
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  world::add_dungeon_room(&cap, &mut w, vector[mob_tid], &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  // creator + joiner characters (capture each kiosk id right after minting)
  let creator_cid = test_world::mint_character(&mut sc, test_world::owner());
  sc.next_tx(test_world::owner()); // commit the share so the kiosk id resolves
  let creator_kid = last_kiosk_id();
  let joiner_cid = test_world::mint_character(&mut sc, @0xB1);
  sc.next_tx(@0xB1);
  let joiner_kid = last_kiosk_id();

  // creator's run pass at room 1
  sc.next_tx(test_world::owner());
  let mut creator_pass = run::new(wid, test_world::owner(), 0, 0, creator_cid, sc.ctx());
  let creator_pass_id = run::id(&creator_pass);

  // NEXT FIGHT — mint the room fight + latch the creator's pass
  sc.next_tx(test_world::owner());
  {
    let mut reg = shard_of(&sc, creator_pass_id);
    let world = ts::take_shared_by_id<World>(&sc, wid);
    let mut k = ts::take_shared_by_id<Kiosk>(&sc, creator_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, mob_tid);
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    dungeon::next_fight(&mut reg, &world, &mut creator_pass, &tmpl, &mut k, &pkcap, creator_cid, vector[], &cfg, &ever, &ver, &ver, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(reg); ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever); ts::return_shared(tmpl);
  };

  // JOIN FIGHT — the joiner re-derives the same-room fight and vouches in
  sc.next_tx(@0xB1);
  let mut joiner_pass = run::new(wid, @0xB1, 0, 0, joiner_cid, sc.ctx());
  sc.next_tx(@0xB1);
  {
    let mut reg = shard_of(&sc, creator_pass_id);
    let mut f = sc.take_shared<Fight>();
    let mut k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    dungeon::join_fight(&mut reg, &mut f, &mut joiner_pass, creator_pass_id, &mut k, &pkcap, joiner_cid, vector[], &cfg, &ever, &ver, &ver, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(reg); ts::return_shared(f); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };

  assert!(run::is_latched(&creator_pass)); // both passes latched to their room fight
  assert!(run::is_latched(&joiner_pass));
  let (_, _, _, _, _) = run::consume(creator_pass);
  let (_, _, _, _, _) = run::consume(joiner_pass);
  sc.end();
}
