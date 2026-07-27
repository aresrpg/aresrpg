// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUME tests — the fight-side `consume::use_consumable` / `use_many` flow over the FULL cross-package scaffold
/// (items + game + fight booted & enabled, the four game→items caps in CharacterLink, the NS_PROGRESSION cap in
/// the FightRegistry, a real kiosk-locked Character + a locked consumable stack). Proves: HEAL applies × quantity
/// with lazy regen SETTLED FIRST; full-HP is blocked when pointless; quantity 0 / > stack, non-consumable,
/// unsupported-effect, under-level, and in-fight (S-12f latch) all abort. Runs the REAL value paths.
#[test_only]
module aresrpg_gifting::consume_tests;

use aresrpg::{admin::{Self, AdminCap}, catalog::{Self as catalog, Catalog}, character::{Self as character}, character_link, config::{Self as gconfig, GameConfig}, consumable_effect, extension, extract::{Self, ItemExtractPolicy}, item::{Self as item, Item, ItemTemplate}, version::{Self, Version}};
use aresrpg_gifting::{consume, gifting::Gifting};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  clock,
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

// ── mirrored abort codes (location disambiguates the aborting module) ──
const CONSUME_ECharacterInFight: u64 = 101; // consume
const CONSUME_ENotConsumable: u64 = 102; // consume
const CONSUME_EUnsupportedEffect: u64 = 103; // consume
const CONSUME_EZeroQuantity: u64 = 104; // consume
const CONSUME_ELevelTooLow: u64 = 105; // consume
const CL_EAlreadyFullHp: u64 = 105; // character_link (heal_hp)
const CL_EConsumeExceedsStack: u64 = 107; // character_link (consume_units)

// ╔════════════════ [ Scaffold — boot items+game+fight, enable, deposit caps, make policies ] ═ ]

fun stand_up(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  gconfig::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  // enable the package + global config, whitelist the consumable category
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  gconfig::set_enabled(&cap, &mut cfg, true, sc.ctx());
  gconfig::set_gifting_brand<Gifting>(&cap, &mut cfg, &ver, sc.ctx()); // the split's pin
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"consumable".to_string(), &ver, sc.ctx());

  // policies: item marketplace + character + the wrapped extraction policy (both Displays claimed a Publisher)
  let pub_a = sc.take_from_sender<Publisher>();
  let pub_b = sc.take_from_sender<Publisher>();
  let (item_pub, char_pub) = if (package::from_module<Item>(&pub_a)) (pub_a, pub_b) else (pub_b, pub_a);
  let (ipolicy, ipolicy_cap) = item::create_item_policy(&item_pub, &ver, sc.ctx());
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&char_pub, &ver, sc.ctx());
  extract::create_extract_policy(&item_pub, &ver, sc.ctx());
  transfer::public_share_object(ipolicy);
  transfer::public_share_object(cpolicy);

  transfer::public_transfer(ipolicy_cap, OWNER);
  transfer::public_transfer(cpolicy_cap, OWNER);
  transfer::public_transfer(item_pub, OWNER);
  transfer::public_transfer(char_pub, OWNER);
  ts::return_shared(ver); ts::return_shared(cfg); ts::return_shared(cat);
  sc.return_to_sender(cap);
}

// ╔════════════════ [ Factories ] ════════════════════════════════════════════ ]

/// Mint a fresh senshi (level 1, full HP) locked into a new personal kiosk owned by `who`. Returns the char id.
fun mk_character(sc: &mut Scenario, who: address): ID {
  sc.next_tx(who);
  let cpolicy = sc.take_shared<TransferPolicy<character::Character>>();
  let cust = character::new_customization(1, 2, 3);
  let (chr, pledge) = character::new_for_testing(b"hero".to_string(), b"senshi".to_string(), true, cust, 1000, sc.ctx());
  let cid = character::id(&chr);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  character::lock_in_kiosk(pledge, chr, &mut k, personal_kiosk::borrow(&pkcap), &cpolicy);
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(k);
  ts::return_shared(cpolicy);
  cid
}

/// Author + share a consumable template carrying a HEAL effect of `heal_amount`, at `level`. Returns its id.
fun mk_heal(sc: &mut Scenario, item_type: vector<u8>, level: u16, heal_amount: u64): ID {
  mk_template(sc, item_type, level, option::some(consumable_effect::new(consumable_effect::heal(), heal_amount)))
}

/// Author + share a consumable template carrying an unsupported (stat-reset) effect. Returns its id.
fun mk_stat_reset(sc: &mut Scenario, item_type: vector<u8>): ID {
  mk_template(sc, item_type, 1, option::some(consumable_effect::new(consumable_effect::stat_reset(), 1)))
}

/// Author + share a consumable-CATEGORY template with NO effect DF (the "not a consumable" case). Returns its id.
fun mk_effectless(sc: &mut Scenario, item_type: vector<u8>): ID {
  mk_template(sc, item_type, 1, option::none())
}

fun mk_template(sc: &mut Scenario, item_type: vector<u8>, level: u16, effect: Option<consumable_effect::ConsumableEffect>): ID {
  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let tid = admin::create_template(
    &cap, &cat, b"Potion".to_string(), b"".to_string(), item_type.to_string(), b"consumable".to_string(), level,
    option::none(), option::none(), vector[], effect, &ver, sc.ctx(),
  );
  ts::return_shared(cat); ts::return_shared(ver); sc.return_to_sender(cap);
  tid
}

/// Mint a locked consumable stack of `qty` units from `tid` into `who`'s kiosk (game NS_MINT door). Returns item id.
fun mk_stack(sc: &mut Scenario, who: address, tid: ID, qty: u64): ID {
  sc.next_tx(who);
  let ver = sc.take_shared<Version>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::mint_item_stack_for_testing(&tmpl, qty, &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Wound `who`'s character to `hp` (stamped at `now`) via write_back_hp — so a heal has room. Fresh test cap.
fun wound(sc: &mut Scenario, who: address, cid: ID, hp: u64, now: u64) {
  sc.next_tx(who);
  let ver = sc.take_shared<Version>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::write_back_hp_for_testing(chr, hp, now, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

/// Latch `who`'s character into a (fake) live fight — drives the S-12f in-fight gate.
fun latch(sc: &mut Scenario, who: address, cid: ID) {
  sc.next_tx(who);
  let ver = sc.take_shared<Version>();
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    aresrpg::fight::mark_for_testing(chr, &ver); // in a live PvM fight ⇒ MARKED (the S-46 gate)
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
  };
}

/// The STORED HP (no regen) via the combat snapshot.
fun hp_of(sc: &mut Scenario, who: address, cid: ID): u64 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let (_cl, _lvl, hp, _mhp, _ap, _mp) = character_link::combat_stats(k.borrow(personal_kiosk::borrow(&pkcap), cid), &cfg);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  hp
}

// ╔════════════════ [ Drivers ] ══════════════════════════════════════════════ ]

fun do_use_many(sc: &mut Scenario, who: address, cid: ID, iid: ID, tid: ID, qty: u64, now: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let xpol = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  consume::use_many(&mut k, &pkcap, cid, iid, &tmpl, &xpol, &mkt, &cfg, &ver, &ver, &clk, qty, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(tmpl); ts::return_shared(xpol); ts::return_shared(mkt); ts::return_shared(cfg);
  ts::return_shared(ver);
}

fun do_use_one(sc: &mut Scenario, who: address, cid: ID, iid: ID, tid: ID, now: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let xpol = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now);
  consume::use_consumable(&mut k, &pkcap, cid, iid, &tmpl, &xpol, &mkt, &cfg, &ver, &ver, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(tmpl); ts::return_shared(xpol); ts::return_shared(mkt); ts::return_shared(cfg);
  ts::return_shared(ver);
}

// ╔════════════════ [ Golden path — heal × quantity, regen-first ] ════════════ ]

#[test]
/// use_many heals × quantity: wounded to 25, drinking 3 × (heal 5) restores +15 → 40 (no regen at same instant).
fun use_many_heals_times_quantity() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 10);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_many(&mut sc, OWNER, cid, iid, tid, 3, 1000);
  assert_eq!(hp_of(&mut sc, OWNER, cid), 40); // 25 + 3×5
  sc.end();
}

#[test]
/// use_consumable (single) heals once: 25 + 5 → 30.
fun use_consumable_single_heals_once() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000);
  assert_eq!(hp_of(&mut sc, OWNER, cid), 30);
  sc.end();
}

#[test]
/// Lazy regen is SETTLED FIRST: wounded to 25 @5000, drinking 2×(heal 5) @10000 → regen +10 (35) THEN +10 → 45
/// (a naive add-without-regen would read 35).
fun use_many_settles_regen_first() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 10);
  wound(&mut sc, OWNER, cid, 25, 5000);
  do_use_many(&mut sc, OWNER, cid, iid, tid, 2, 10_000);
  assert_eq!(hp_of(&mut sc, OWNER, cid), 45); // 25 →(regen +10)→ 35 →(heal +10)→ 45
  sc.end();
}

// ╔════════════════ [ Adversarial matrix ] ════════════════════════════════════ ]

#[test, expected_failure(abort_code = CL_EAlreadyFullHp, location = character_link)]
/// A heal at FULL HP is blocked when pointless (SPEC §10) — a fresh (block-less) character is full → the tx reverts.
fun full_hp_use_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000); // full HP → EAlreadyFullHp
  abort
}

#[test, expected_failure(abort_code = CONSUME_EZeroQuantity, location = consume)]
fun quantity_zero_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_many(&mut sc, OWNER, cid, iid, tid, 0, 1000); // EZeroQuantity
  abort
}

#[test, expected_failure(abort_code = CL_EConsumeExceedsStack, location = aresrpg_gifting::gifting)]
/// Requesting more than the stack holds aborts in consume_units — and the atomic tx un-does the heal that ran first.
fun quantity_exceeds_stack_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 3);
  wound(&mut sc, OWNER, cid, 1, 1000); // low HP so the heal itself does not abort first
  do_use_many(&mut sc, OWNER, cid, iid, tid, 5, 1000); // 5 > 3 → EConsumeExceedsStack
  abort
}

#[test, expected_failure(abort_code = CONSUME_ENotConsumable, location = consume)]
/// A template with no effect DF is not a usable consumable → ENotConsumable (before any burn/heal).
fun non_consumable_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_effectless(&mut sc, b"junk");
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000); // no effect → ENotConsumable
  abort
}

#[test, expected_failure(abort_code = CONSUME_EUnsupportedEffect, location = consume)]
/// v1 dispatches HEAL only: a stat-reset consumable aborts EUnsupportedEffect (its target ledger is unbuilt).
fun unsupported_effect_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_stat_reset(&mut sc, b"scroll");
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000); // stat_reset → EUnsupportedEffect
  abort
}

#[test, expected_failure(abort_code = CONSUME_ELevelTooLow, location = consume)]
/// The consumable level gate: a level-1 character cannot use a level-50 potion.
fun under_level_use_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 50, 5); // requires level 50
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000); // level 1 < 50 → ELevelTooLow
  abort
}

#[test, expected_failure(abort_code = CONSUME_ECharacterInFight, location = consume)]
/// S-12f: a character seated in a LIVE fight cannot drink — HP is the fight's to write while it runs.
fun in_fight_use_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let cid = mk_character(&mut sc, OWNER);
  let tid = mk_heal(&mut sc, b"potion", 1, 5);
  let iid = mk_stack(&mut sc, OWNER, tid, 4);
  wound(&mut sc, OWNER, cid, 25, 1000);
  latch(&mut sc, OWNER, cid); // seat the character in a fight
  do_use_one(&mut sc, OWNER, cid, iid, tid, 1000); // ECharacterInFight
  abort
}
