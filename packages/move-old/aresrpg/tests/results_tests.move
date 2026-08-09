// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RESULTS tests — the core claims-v2 settlement landing. A branded `FightOutcome` (fabricated via the engine's
/// `settlement::outcome_for_testing`, stamped with core's OWN `fight::y45()` so the brand-assert accepts it)
/// is OPENED: HP/XP write-backs + the dirty-counter clear land on the kiosk-borrowed character, the loot checklist
/// rolls, and a soulbound `FightResult` is minted. Then the claim ticket's reads round-trip, the rolled loot is
/// minted per template, and the emptied ticket is burned. The two `&Random` entry doors (`open` / `open_taken`)
/// are driven with a seeded framework `Random`.
#[test_only]
module aresrpg::results_tests;

use aresrpg::{config::GameConfig, fight, item::{Item, ItemTemplate}, results::{Self, FightResult}, test_world, version::Version};
use aresrpg_fight::{fight_latch::{Self, FightLatch, FightLatchShards}, fight_registry, mob, settlement};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, random::{Self, Random}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

fun fid(): ID { object::id_from_address(@0xF16) }
fun wid(): ID { object::id_from_address(@0x301D) }

fun latch_for(sc: &Scenario, character: ID): FightLatch {
  let book = sc.take_shared<FightLatchShards>();
  let shard = fight_latch::shard_for(&book, character);
  ts::return_shared(book);
  ts::take_shared_by_id<FightLatch>(sc, shard)
}

fun latches_for(sc: &Scenario, first: ID, second: ID): (FightLatch, FightLatch) {
  let book = sc.take_shared<FightLatchShards>();
  let first_shard = fight_latch::shard_for(&book, first);
  let second_shard = fight_latch::shard_for(&book, second);
  ts::return_shared(book);
  (
    ts::take_shared_by_id<FightLatch>(sc, first_shard),
    ts::take_shared_by_id<FightLatch>(sc, second_shard),
  )
}

/// Boot the world, mint a character, and author a resource loot template. Returns (cid, loot_template_id).
fun stage(sc: &mut Scenario): (ID, ID) {
  fight_registry::test_init(sc.ctx());
  fight_latch::test_init(sc.ctx());
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, test_world::owner());
  let loot_tid = test_world::make_resource_template(sc);
  (cid, loot_tid)
}

/// Stamp the PvM seat mark on the character (open's non-pvp path clears it — an unmarked clear aborts).
fun mark_character(sc: &mut Scenario, cid: ID) {
  sc.next_tx(test_world::owner());
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    fight::mark(chr, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

// ╔════════════════ [ Full open → claim → burn (deterministic door) ] ═════════ ]

#[test]
/// A branded WIN outcome opens: the character is HP/XP-written and un-marked, the 100%-chance loot entry rolls to
/// one unit, and the `FightResult` round-trips every read. Then `mint_rolled` claims the unit (checklist → 0) and
/// `burn_result` deletes the emptied ticket.
fun open_settles_reads_mints_and_burns() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, loot_tid) = stage(&mut sc);
  mark_character(&mut sc, cid);

  // OPEN via the deterministic door (covers open_internal + roll_loot_entry hit + push_or_merge + total_units)
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let mut latch = latch_for(&sc, cid);
    // one loot line at 100% (chance_bp 10000), exactly 1 unit; mob_count 1 → rolled once
    let loot = vector[mob::new_loot_entry(loot_tid, 10_000, 1, 1)];
    let outcome = settlement::outcome_for_testing(
      fight::y45(), fid(), wid(), cid,
      1 /*outcome*/, 100 /*final_hp*/, 50 /*xp_share*/, 0 /*aged_bp*/, 0 /*chance*/, 1 /*mob_count*/,
      loot, false /*pvp*/, 0 /*team*/, option::none() /*winner_team*/, 100 /*loot_mult*/, sc.ctx(),
    );
    results::open_for_testing(outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 2000, sc.ctx());
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // CLAIM: read every getter, mint the rolled loot, then burn the emptied ticket
  sc.next_tx(test_world::owner());
  let mut result = sc.take_from_sender<FightResult>();
  assert_eq!(results::character(&result), cid);
  assert_eq!(results::fight_id(&result), fid());
  assert_eq!(results::final_hp(&result), 100);
  assert_eq!(results::xp_share(&result), 50);
  assert_eq!(results::outcome(&result), 1);
  assert!(!results::is_pvp(&result));
  assert_eq!(results::team(&result), 0);
  assert!(results::winner_team(&result).is_none());
  assert_eq!(results::rolled_qty(&result, loot_tid), 1); // one unit owed

  let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, loot_tid);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let ver = sc.take_shared<Version>();
  results::mint_rolled(&mut result, &tmpl, &ver, &mut k, &pkcap, &policy, sc.ctx()); // covers take_rolled
  assert_eq!(results::rolled_qty(&result, loot_tid), 0); // checklist consumed
  results::burn_result(result); // emptied → deletes the ticket

  ts::return_shared(tmpl); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(policy); ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ #758 — loot-minted GEAR is born rolled ] ═══════════════ ]

#[test]
/// #758 REGRESSION: gear claimed off a fight result carries its rolled `StatsKey`. Before the fix `mint_rolled`
/// minted through a door that never rolled, so every looted item's owned-stat block was blank forever — only
/// `shop::buy` attached one. Two units are claimed in one call: each lands a block inside the authored [min,max],
/// each from its OWN derived seed (the ticket's open-time entropy folded with the template id and the unit index).
fun loot_minted_gear_carries_rolled_stats() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _res_tid) = stage(&mut sc);
  mark_character(&mut sc, cid);
  test_world::whitelist(&mut sc, b"hat");
  let gear_tid = test_world::make_ranged_gear_template(&mut sc, b"hat", b"hat", 100, 200);

  // OPEN owing 2 units of the gear template (one 100%-chance line, 2 mobs killed → 1 + 1)
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let mut latch = latch_for(&sc, cid);
    let loot = vector[mob::new_loot_entry(gear_tid, 10_000, 1, 1)];
    let outcome = settlement::outcome_for_testing(
      fight::y45(), fid(), wid(), cid, 1, 100, 50, 0, 0, 2 /*mob_count*/, loot, false, 0, option::none(), 100, sc.ctx(),
    );
    results::open_for_testing(outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 2000, sc.ctx());
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // CLAIM both units
  sc.next_tx(test_world::owner());
  let mut result = sc.take_from_sender<FightResult>();
  assert_eq!(results::rolled_qty(&result, gear_tid), 2);
  let (kid, minted) = {
    let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, gear_tid);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let policy = sc.take_shared<TransferPolicy<Item>>();
    let ver = sc.take_shared<Version>();
    let kid = object::id(&k);
    let minted = results::mint_rolled_for_testing(&mut result, &tmpl, &ver, &mut k, &pkcap, &policy, sc.ctx());
    assert_eq!(minted.length(), 2);
    ts::return_shared(tmpl); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(policy); ts::return_shared(ver);
    (kid, minted)
  };
  results::burn_result(result); // the ticket's stat seed dies with it — a live DF would block the delete

  // each looted unit carries a rolled block INSIDE the authored band (this is the assert that was red pre-#758:
  // `rolled_stats` aborts on an item with no StatsKey)
  let v0 = test_world::rolled_vitality(&mut sc, test_world::owner(), kid, minted[0]);
  let v1 = test_world::rolled_vitality(&mut sc, test_world::owner(), kid, minted[1]);
  assert!(v0 >= 100 && v0 <= 200);
  assert!(v1 >= 100 && v1 <= 200);
  sc.end();
}

// ╔════════════════ [ The &Random entry doors ] ══════════════════════════════ ]

#[test]
/// The two terminal `&Random` open doors (`open` entry + `open_taken` public) driven with a seeded framework
/// `Random`. Ephemeral PvP outcomes (empty loot, no mob) — they never touch the real character, so no seat mark
/// is needed; each mints an empty `FightResult`.
fun random_open_doors() {
  let mut sc = ts::begin(test_world::owner());
  let (cid, _loot_tid) = stage(&mut sc);

  // seed a framework Random (create + first-round update as @0x0)
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0202020202020202020202020202020202020202020202020202020202020202", sc.ctx());
  ts::return_shared(r);

  // open (entry) — pvp outcome, empty loot
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let mut latch = latch_for(&sc, cid);
    let rr = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(3000);
    let o = settlement::outcome_for_testing(
      fight::y45(), fid(), wid(), cid, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(1), 100, sc.ctx(),
    );
    results::open(o, &mut latch, &mut k, &pkcap, &cfg, &ver, &clk, &rr, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  };

  // open_taken (public PTB-composition twin) — a second pvp outcome
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let mut latch = latch_for(&sc, cid);
    let rr = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(4000);
    let o = settlement::outcome_for_testing(
      fight::y45(), fid(), wid(), cid, 2, 0, 0, 0, 0, 0, vector[], true, 1, option::some(1), 100, sc.ctx(),
    );
    results::open_taken(o, &mut latch, &mut k, &pkcap, &cfg, &ver, &clk, &rr, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  };
  sc.end();
}

#[test]
/// Mandatory multi-character seating proof: two members whose latch indexes differ are both present before
/// opening, and each member's own `results::open` call releases only that member's character-keyed shard.
fun different_latch_shards_both_release_at_results_open() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, _loot_tid) = stage(&mut sc);
  let first = object::id_from_address(@0xC0);
  let second = object::id_from_address(@0xC2);
  assert!(fight_registry::shard_index(first) != fight_registry::shard_index(second));
  let brand = fight::y45();

  sc.next_tx(test_world::owner());
  {
    let (mut first_latch, mut second_latch) = latches_for(&sc, first, second);
    fight_latch::latch_for_testing(&mut first_latch, brand, first, fid());
    fight_latch::latch_for_testing(&mut second_latch, brand, second, fid());
    assert!(fight_latch::character_fight(&first_latch, brand, first).is_some());
    assert!(fight_latch::character_fight(&second_latch, brand, second).is_some());
    ts::return_shared(first_latch);
    ts::return_shared(second_latch);
  };

  sc.next_tx(test_world::owner());
  {
    let mut latch = latch_for(&sc, first);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let outcome = settlement::outcome_for_testing(
      brand, fid(), wid(), first, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(0), 100, sc.ctx(),
    );
    results::open_for_testing(outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 1, sc.ctx());
    assert!(fight_latch::character_fight(&latch, brand, first).is_none());
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver);
  };

  sc.next_tx(test_world::owner());
  {
    let mut latch = latch_for(&sc, second);
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let outcome = settlement::outcome_for_testing(
      brand, fid(), wid(), second, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(0), 100, sc.ctx(),
    );
    results::open_for_testing(outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 1, sc.ctx());
    assert!(fight_latch::character_fight(&latch, brand, second).is_none());
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver);
  };

  sc.next_tx(test_world::owner());
  results::burn_result(sc.take_from_sender<FightResult>());
  results::burn_result(sc.take_from_sender<FightResult>());
  sc.end();
}

#[test]
/// Same-index companion: two character rows coexist in one `FightLatch` object and two result opens clear both.
fun same_latch_shard_pair_both_release_at_results_open() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, _loot_tid) = stage(&mut sc);
  let first = object::id_from_address(@0xC0);
  let second = object::id_from_address(@0xD0);
  assert!(fight_registry::shard_index(first) == fight_registry::shard_index(second));
  let brand = fight::y45();

  sc.next_tx(test_world::owner());
  {
    let mut latch = latch_for(&sc, first);
    fight_latch::latch_for_testing(&mut latch, brand, first, fid());
    fight_latch::latch_for_testing(&mut latch, brand, second, fid());
    assert!(fight_latch::character_fight(&latch, brand, first).is_some());
    assert!(fight_latch::character_fight(&latch, brand, second).is_some());

    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let first_outcome = settlement::outcome_for_testing(
      brand, fid(), wid(), first, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(0), 100, sc.ctx(),
    );
    let second_outcome = settlement::outcome_for_testing(
      brand, fid(), wid(), second, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(0), 100, sc.ctx(),
    );
    results::open_for_testing(first_outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 1, sc.ctx());
    results::open_for_testing(second_outcome, &mut latch, &mut k, &pkcap, &cfg, &ver, 1, sc.ctx());
    assert!(fight_latch::character_fight(&latch, brand, first).is_none());
    assert!(fight_latch::character_fight(&latch, brand, second).is_none());
    ts::return_shared(latch); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver);
  };

  sc.next_tx(test_world::owner());
  results::burn_result(sc.take_from_sender<FightResult>());
  results::burn_result(sc.take_from_sender<FightResult>());
  sc.end();
}
