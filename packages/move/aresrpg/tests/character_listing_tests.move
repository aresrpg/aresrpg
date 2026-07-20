// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHARACTER-LISTING-RULE tests: the anti-name-squat level gate on character resale (`character_listing_rule`).
/// Drives the REAL transfer-policy rule against the `test_world` harness + a genuinely xp-leveled character:
/// below-gate purchase can't be proven (no sale), at/above-gate proves and `confirm_request` completes, the live
/// GameConfig dial is respected (same level, different dial → opposite outcome), and the evasion guard rejects a
/// buyer who proves a DIFFERENT character than the one being purchased.
#[test_only]
module aresrpg::character_listing_tests;

use aresrpg::{
  admin::AdminCap,
  character::Character,
  character_link,
  character_listing_rule,
  config::{Self, GameConfig},
  extension,
  test_world,
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  kiosk::Kiosk,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap}
};

const OWNER: address = @0xA; // == test_world::owner()

// ── mirrored error consts (location in the #[expected_failure] disambiguates the aborting module) ──
const ELevelTooLow: u64 = 101; // character_listing_rule
const EWrongCharacter: u64 = 102; // character_listing_rule

// ╔════════════════ [ Local drivers ] ════════════════════════════════════════ ]

/// Grant `xp` to `who`'s character `cid` through the real progression seam (a throwaway NS_PROGRESSION test cap),
/// so `character_link::level` reflects a genuinely-played level. Mirrors the fight-seam test driver.
fun grant_xp(sc: &mut Scenario, who: address, cid: ID, xp: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::grant_fight_xp(&cfg, chr, xp, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Set the live listing-level dial on GameConfig (admin + version gated, clamped).
fun set_gate(sc: &mut Scenario, value: u64) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_listing_level_gate(&cap, &mut cfg, value, &ver, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); sc.return_to_sender(cap);
}

/// Attach the level-gate rule to the shared Character policy (the ceremony call), using the policy cap.
fun add_rule(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let mut policy = sc.take_shared<TransferPolicy<Character>>();
  let cap = sc.take_from_sender<TransferPolicyCap<Character>>();
  character_listing_rule::add(&mut policy, &cap);
  ts::return_shared(policy); sc.return_to_sender(cap);
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

/// A fresh (level-1) character can never be sold under the DEFAULT gate (30): `prove_level` aborts, so the buyer
/// can never satisfy the receipt → the sale can never complete. The name-squat exit is closed.
#[test, expected_failure(abort_code = ELevelTooLow, location = aresrpg::character_listing_rule)]
fun below_default_gate_prove_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER); // level 1; default listing gate = 30
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let mut req = transfer_policy::new_request<Character>(cid, 0, object::id(&k));
  {
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    character_listing_rule::prove_level(chr, &cfg, &mut req); // ABORTS: level 1 < 30
  };
  let (_i, _p, _f) = transfer_policy::confirm_request(&policy, req); // unreachable — type-check only
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(policy);
  sc.end();
}

/// At the gate (level 5, dial 5): `prove_level` adds the receipt and the framework `confirm_request` completes —
/// a full secondary sale succeeds once the character is played to the threshold.
#[test]
fun at_gate_proves_and_confirms() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  grant_xp(&mut sc, OWNER, cid, 2800); // level-5 threshold → stored level 5
  set_gate(&mut sc, 5); // dial exactly at the character's level
  add_rule(&mut sc); // attach the gate to the Character policy (ceremony)
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let policy = sc.take_shared<TransferPolicy<Character>>();
  assert_eq!(character_link::level(k.borrow(personal_kiosk::borrow(&pkcap), cid)), 5); // precondition
  let mut req = transfer_policy::new_request<Character>(cid, 0, object::id(&k));
  {
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    character_listing_rule::prove_level(chr, &cfg, &mut req); // 5 >= 5 → receipt added
  };
  let (i, _p, _f) = transfer_policy::confirm_request(&policy, req); // 1 receipt == 1 rule → OK
  assert_eq!(i, cid);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(policy);
  sc.end();
}

/// The LIVE dial is respected: the SAME level-5 character that passes at dial 5 (above) is REFUSED when the admin
/// raises the dial to 6 — proving `prove_level` reads the current GameConfig value, not a baked-in one.
#[test, expected_failure(abort_code = ELevelTooLow, location = aresrpg::character_listing_rule)]
fun dial_change_respected_just_above_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  grant_xp(&mut sc, OWNER, cid, 2800); // level 5
  set_gate(&mut sc, 6); // dial one above the character's level
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let mut req = transfer_policy::new_request<Character>(cid, 0, object::id(&k));
  {
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    character_listing_rule::prove_level(chr, &cfg, &mut req); // ABORTS: level 5 < 6
  };
  let (_i, _p, _f) = transfer_policy::confirm_request(&policy, req); // unreachable — type-check only
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(policy);
  sc.end();
}

/// Evasion guard: a buyer purchasing a low-level (squatted) character cannot satisfy the receipt by proving a
/// DIFFERENT high-level character they own. The request's item id differs from the proven character → aborts
/// EWrongCharacter, even though that character is well above the gate (level 5, dial 3).
#[test, expected_failure(abort_code = EWrongCharacter, location = aresrpg::character_listing_rule)]
fun wrong_character_rejected() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  grant_xp(&mut sc, OWNER, cid, 2800); // level 5 — above the gate, so ONLY the wrong-char guard can fire
  set_gate(&mut sc, 3);
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let bogus = object::id_from_address(@0xDEAD); // the item being purchased is a DIFFERENT (squatted) character
  let mut req = transfer_policy::new_request<Character>(bogus, 0, object::id(&k));
  {
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    character_listing_rule::prove_level(chr, &cfg, &mut req); // ABORTS: id(chr)=cid != bogus
  };
  let (_i, _p, _f) = transfer_policy::confirm_request(&policy, req); // unreachable — type-check only
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(policy);
  sc.end();
}

// ╔════════════════ [ Unfinished business — the marker blocks the SALE ] ══════ ]

const EUnfinishedBusiness: u64 = 103; // character_listing_rule

#[test, expected_failure(abort_code = EUnfinishedBusiness, location = aresrpg::character_listing_rule)]
/// A MARKED character (unopened PvM result / live seat) cannot complete a sale even ABOVE the level gate —
/// only its owner can open the result, so a completed sale would brick the buyer.
fun marked_character_sale_refused() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  grant_xp(&mut sc, OWNER, cid, 2800); // level 5
  set_gate(&mut sc, 5); // gate passes — the MARKER is what refuses
  add_rule(&mut sc);

  // mark the character (the fight seat paths do this via the registry-custodied cap; test cap here)
  sc.next_tx(OWNER);
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let ver = sc.take_shared<Version>();
    {
      let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
      aresrpg::fight_marker::mark(chr, &ver);
    };
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
  };

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let mut req = transfer_policy::new_request<Character>(cid, 0, object::id(&k));
  {
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    character_listing_rule::prove_level(chr, &cfg, &mut req); // EUnfinishedBusiness
  };
  abort 0
}

#[test]
/// The marker lifecycle: mark → readable + blocking, clear → free again (the open() path's game half).
fun fight_marker_roundtrip() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let fid = object::id_from_address(@0xF16);
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    assert!(aresrpg::fight_marker::is_unmarked(chr));
    aresrpg::fight_marker::mark(chr, &ver);
    assert!(!aresrpg::fight_marker::is_unmarked(chr));
    aresrpg::fight_marker::clear(chr, &ver);
    assert!(aresrpg::fight_marker::is_unmarked(chr));
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
  sc.end();
}
