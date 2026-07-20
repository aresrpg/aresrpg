/// RESULTS tests — the core claims-v2 settlement landing. A branded `FightOutcome` (fabricated via the engine's
/// `settlement::outcome_for_testing`, stamped with core's OWN `fight::brand_type()` so the brand-assert accepts it)
/// is OPENED: HP/XP write-backs + the dirty-counter clear land on the kiosk-borrowed character, the loot checklist
/// rolls, and a soulbound `FightResult` is minted. Then the claim ticket's reads round-trip, the rolled loot is
/// minted per template, and the emptied ticket is burned. The two `&Random` entry doors (`open` / `open_taken`)
/// are driven with a seeded framework `Random`.
#[test_only]
module aresrpg::results_tests;

use aresrpg::{
  config::GameConfig,
  fight,
  fight_marker,
  item::{Item, ItemTemplate},
  results::{Self, FightResult},
  test_world,
  version::Version
};
use aresrpg_fight::{mob, settlement};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, random::{Self, Random}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

fun fid(): ID { object::id_from_address(@0xF16) }
fun wid(): ID { object::id_from_address(@0x301D) }

/// Boot the world, mint a character, and author a resource loot template. Returns (cid, loot_template_id).
fun stage(sc: &mut Scenario): (ID, ID) {
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
    fight_marker::mark(chr, &ver);
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
    // one loot line at 100% (chance_bp 10000), exactly 1 unit; mob_count 1 → rolled once
    let loot = vector[mob::new_loot_entry(loot_tid, 10_000, 1, 1)];
    let outcome = settlement::outcome_for_testing(
      fight::brand_type(), fid(), wid(), cid,
      1 /*outcome*/, 100 /*final_hp*/, 50 /*xp_share*/, 0 /*aged_bp*/, 0 /*chance*/, 1 /*mob_count*/,
      loot, false /*pvp*/, 0 /*team*/, option::none() /*winner_team*/, 100 /*loot_mult*/, sc.ctx(),
    );
    results::open_for_testing(outcome, &mut k, &pkcap, &cfg, &ver, 2000, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
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
    let rr = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(3000);
    let o = settlement::outcome_for_testing(
      fight::brand_type(), fid(), wid(), cid, 2, 0, 0, 0, 0, 0, vector[], true, 0, option::some(1), 100, sc.ctx(),
    );
    results::open(o, &mut k, &pkcap, &cfg, &ver, &clk, &rr, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  };

  // open_taken (public PTB-composition twin) — a second pvp outcome
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let rr = sc.take_shared<Random>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(4000);
    let o = settlement::outcome_for_testing(
      fight::brand_type(), fid(), wid(), cid, 2, 0, 0, 0, 0, 0, vector[], true, 1, option::some(1), 100, sc.ctx(),
    );
    results::open_taken(o, &mut k, &pkcap, &cfg, &ver, &clk, &rr, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  };
  sc.end();
}
