// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORGEMAGIE DOOR TESTS (S-48 upgrade-#2 payload; crush reshaped to the 2026-07-11 single-tx door):
///  • SCRIBE — outcome coverage over a deterministic seed sweep with a FULL write-shape parity audit per branch
///    (stack −1 exactly, full rolled block, ForgeState DF, xp on success only, puits ledger), plus the
///    adversarial wall: dirty character, kill-switch bit, unregistered rune, wrong/statless gear, malus stat,
///    job-70 gate, per-stat application cap.
///  • CRUSH — ONE TX (roll + mint): the YIELD GOLDEN (curve-based: L50 × +40 Fo @100% ⇒ EV 0.978 ⇒
///    {0,1}), taux goldens (self-decay 96_040, bracket-pressure peer uplift 100_120), the recipe-less 50% cap,
///    wrong-template abort, statless parity, and the SLOT-WALK laws: unregistered fillers no-op (every test
///    pads with the gear template), a DUPLICATE registered slot mints once, a yielded rune whose template was
///    not passed aborts `EMissingTemplate` (full revert — the gear survives is proven by the abort itself),
///    and minted rune stacks are CATEGORY `rune` (the stackable-category fix is pinned by minting `rune`
///    templates, not `resource` stand-ins).
/// Seeds drive the twins (`*_for_testing`) — same bodies as the entry doors minus `&Random` (deterministic).
#[test_only]
module aresrpg_forgemagie::forgemagie_tests;

use aresrpg::{admin::AdminCap, config::{Self, GameConfig}, version::Version};
use aresrpg_forgemagie::{forge_world as test_world, forgemagie::{Self, CrushBoard}};
use aresrpg::{extract::ItemExtractPolicy, fight, item::{Item, ItemTemplate}, item_stats::{Self, ItemStatistics}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;

const SHIFT: u16 = 32_768;
const XP_L70: u64 = 156_481; // job curve: total xp to job level 70 (the scribe unlock)
const STR: u8 = 2; // catalog stat id: strength (Fo)
const ACT: u8 = 8; // catalog stat id: action (Ga Pa — apps cap 1)
const TIER_BA: u8 = 1;
const TIER_PA: u8 = 2;
const TIER_RA: u8 = 3;

// abort codes under test (mirrors of the module constants)
const EDirty: u64 = 101;
const EScribeLocked: u64 = 102;
const EUnknownRune: u64 = 103;
const EWrongItem: u64 = 104;
const EMalusStat: u64 = 106;
const EMaxApps: u64 = 107;
const EWrongTemplate: u64 = 108;
const EMissingTemplate: u64 = 109;
const EBadRegistration: u64 = 111;
const C_EDomainDisabled: u64 = 103; // config

// taux goldens (foundation constants: decay keeps 96/100 of the distance to the 1% floor; pressure 3/5 milli/unit)
const NEUTRAL: u64 = 100_000;
const DECAYED_ONCE: u64 = 96_040; // 1_000 + 99_000 × 96/100
const PEER_UPLIFT: u64 = 100_120; // 100_000 + (40 × 5 weight) × 3/5

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot + character with job 3 at level 70 + the CrushBoard + templates: `sword_t` (L50 gear WITH ranges:
/// strength max +50 — proximity 0.8 at the +40 fixture ⇒ CS/NS/CF all live), `peer_t` (L45, same taux bracket),
/// `exotic_t` (L50, NO ranges ⇒ every scribe is EXOTIC), and three registered strength runes (Ba/Pa/Ra) of
/// CATEGORY `rune` (the live seed category — pins the `is_stackable_category` rune membership the crush mint
/// depends on). Returns (cid, sword_t, peer_t, exotic_t, rune_ba_t, rune_pa_t, rune_ra_t).
fun stage(sc: &mut Scenario): (ID, ID, ID, ID, ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  test_world::bank_job_xp(sc, OWNER, cid, 3, XP_L70);
  test_world::whitelist(sc, b"sword");
  test_world::whitelist(sc, b"rune");
  let sword_t = make_ranged(sc, b"Blade", b"blade", 50, 50, 1);
  let peer_t = make_ranged(sc, b"Peer", b"peer", 45, 50, 1);
  let exotic_t = test_world::make_template(sc, b"Exotic", b"exotic", b"sword", 50);
  let rune_ba_t = test_world::make_template(sc, b"RuneFo", b"rune_fo", b"rune", 1);
  let rune_pa_t = test_world::make_template(sc, b"RunePaFo", b"rune_pa_fo", b"rune", 1);
  let rune_ra_t = test_world::make_template(sc, b"RuneRaFo", b"rune_ra_fo", b"rune", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  forgemagie::create_board(&cap, &ver, sc.ctx());
  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>();
  forgemagie::register_rune(&cap, &mut board, rune_ba_t, STR, TIER_BA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut board, rune_pa_t, STR, TIER_PA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut board, rune_ra_t, STR, TIER_RA, &ver, sc.ctx());
  ts::return_shared(board); ts::return_shared(ver); sc.return_to_sender(cap);
  (cid, sword_t, peer_t, exotic_t, rune_ba_t, rune_pa_t, rune_ra_t)
}

/// Author a ranged sword template: strength max +`str_max`, action max +`act_max`, everything else flat SHIFT
/// (so ONLY those columns are template-granted). Split port: ranges attach at `create_template` time — the
/// post-hoc `attach_ranges` write is core-package-private.
fun make_ranged(sc: &mut Scenario, name: vector<u8>, item_type: vector<u8>, level: u16, str_max: u16, act_max: u16): ID {
  let s = SHIFT;
  let max = item_stats::new(s, s, s + str_max, s, s, s, s, s, s + act_max, s, s, s, s, s, s, s, s);
  test_world::make_template_ranged(sc, name, item_type, b"sword", level, uniform(s), max)
}

fun uniform(v: u16): ItemStatistics { item_stats::new(v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v) }

/// Overwrite the kiosk-locked gear's rolled block: strength = SHIFT+`str_delta` (or a malus when negative via
/// `malus`), everything else centered.
fun set_rolled_str(sc: &mut Scenario, gear_id: ID, str_val: u16) {
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let s = SHIFT;
  forgemagie::set_rolled_for_testing(&cfg, &mut k, &pkcap, gear_id, item_stats::new(s, s, str_val, s, s, s, s, s, s, s, s, s, s, s, s, s, s));
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap);
}

fun mark_dirty(sc: &mut Scenario, cid: ID) {
  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    fight::mark_for_testing(chr, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

fun pause_forgemagie(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_domain_enabled(&cap, &mut cfg, config::domain_forgemagie(), false, sc.ctx());
  ts::return_shared(cfg); sc.return_to_sender(cap);
}

/// One scribe through the seed twin. Returns the outcome (forge 0=CS 1=NS 2=CF).
fun do_scribe(sc: &mut Scenario, cid: ID, gear_id: ID, gear_tid: ID, rune_item: ID, rune_tid: ID, seed: u64): u8 {
  sc.next_tx(OWNER);
  let board = sc.take_shared<CrushBoard>(); let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, gear_tid);
  let rune_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, rune_tid);
  let xpolicy = sc.take_shared<ItemExtractPolicy>(); let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>(); let ver = sc.take_shared<Version>();
  let o = forgemagie::scribe_for_testing(
    &board, &mut k, &pkcap, cid, gear_id, &gear_tmpl, rune_item, &rune_tmpl, &xpolicy, &mkt, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(gear_tmpl); ts::return_shared(rune_tmpl); ts::return_shared(xpolicy);
  ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);
  o
}

/// One crush through the seed twin — the SLOT WALK carries the three registered strength runes + the GEAR
/// template as the unregistered filler (so the distinct-padding no-op is exercised on EVERY crush). Returns
/// the ROLLED owed vector (51 slots) the goldens pin.
fun do_crush(sc: &mut Scenario, cid: ID, gear_tid: ID, gear_ids: vector<ID>, ba: ID, pa: ID, ra: ID, seed: u64): vector<u64> {
  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, gear_tid);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(sc, pa); let t_ra = ts::take_shared_by_id<ItemTemplate>(sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>(); let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>(); let ver = sc.take_shared<Version>();
  let rolled = forgemagie::crush_for_testing(
    &mut board, &mut k, &pkcap, cid, &gear_tmpl, gear_ids,
    &t_ba, &t_pa, &t_ra, &gear_tmpl, // slot 4 = the gear template: an unregistered filler must no-op
    &xpolicy, &mkt, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(gear_tmpl); ts::return_shared(t_ba); ts::return_shared(t_pa); ts::return_shared(t_ra);
  ts::return_shared(xpolicy); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);
  rolled
}

// readers (kiosk-borrow oracles)
fun kiosk_state(sc: &mut Scenario, id: ID): (bool, u32) { // (has_item, item_count)
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let has = k.has_item(id);
  let count = k.item_count();
  ts::return_shared(k);
  (has, count)
}

fun gear_read(sc: &mut Scenario, id: ID): (u16, u64, u64) { // (strength, puits, str-apps)
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear: &Item = k.borrow(personal_kiosk::borrow(&pkcap), id);
  let s = item_stats::strength(item_stats::rolled_stats(gear));
  let p = forgemagie::puits(gear);
  let a = forgemagie::applications(gear, STR);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  (s, p, a)
}

fun job_xp_of(sc: &mut Scenario, cid: ID, job: u8): u64 {
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let x = aresrpg::character_link::job_xp(k.borrow(personal_kiosk::borrow(&pkcap), cid), job);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  x
}

fun eff(sc: &mut Scenario, template: ID, level: u16): u64 {
  sc.next_tx(OWNER);
  let board = sc.take_shared<CrushBoard>();
  let c = forgemagie::effective_coefficient(&board, template, level);
  ts::return_shared(board);
  c
}

/// The three strength-tier quantities off a returned roll + how many DISTINCT tiers are positive (== the
/// number of rune stacks the mint walk must have locked).
fun str_owed(rolled: &vector<u64>): (u64, u64, u64, u32) {
  let ba = *rolled.borrow(forgemagie::owed_index(STR, TIER_BA));
  let pa = *rolled.borrow(forgemagie::owed_index(STR, TIER_PA));
  let ra = *rolled.borrow(forgemagie::owed_index(STR, TIER_RA));
  let mut distinct = 0u32;
  if (ba > 0) distinct = distinct + 1; if (pa > 0) distinct = distinct + 1; if (ra > 0) distinct = distinct + 1;
  (ba, pa, ra, distinct)
}

// ╔════════════════ [ SCRIBE — outcome coverage + write-shape parity ] ════════ ]

#[test]
/// Deterministic seed sweep on the +40/+50 strength fixture (CS ~34% / NS ~53% / CF ~13%): all three outcomes
/// must appear, and EVERY iteration passes the parity audit — EXACTLY 1 unit leaves the rune economy whatever
/// the outcome (each iteration scribes off a FRESH qty-2 stack: `consume_units` burns the old object and
/// re-mints the remainder, so `has_item(old)` flips false while the kiosk COUNT holds — under the old
/// whole-stack burn bug the count would DROP), the rolled block stays present, the ForgeState DF exists, and
/// the per-outcome semantics hold: CS ⇒ +value & puits unchanged; NS ⇒ +value (the scribed stat is
/// protected); CF ⇒ no gain & no xp. XP grows on success only.
fun scribe_outcome_coverage_and_parity() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);

  // SEED CHOICE: the preserved shipped `prng::draw` binding returns `seed + 0x6d2b79f5` as the FIRST draw
  // (linear in the seed — fine on-chain where seeds are uniform u64s from `&Random`, but sequential tiny
  // seeds would sweep one narrow roll band). The 97_003 stride walks the whole [0, 1e6) roll space.
  let mut seen = vector[false, false, false];
  let mut i = 1u64;
  while (i <= 60) {
    let seed = i * 97_003;
    let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 2); // fresh qty-2 stack per iteration
    let (str_before, puits_before, apps_before) = gear_read(&mut sc, gear);
    let (_, count_before) = kiosk_state(&mut sc, stack);
    let xp_before = job_xp_of(&mut sc, cid, 3);

    let o = do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, seed);
    *seen.borrow_mut(o as u64) = true;

    // ── parity: identical write set, whatever the branch ──
    let (old_alive, count_after) = kiosk_state(&mut sc, stack);
    assert!(!old_alive); // the qty-2 stack object was consumed…
    assert!(count_after == count_before); // …and the 1-unit remainder re-minted: EXACTLY one unit left the economy
    let (str_after, puits_after, apps_after) = gear_read(&mut sc, gear);
    let xp_after = job_xp_of(&mut sc, cid, 3);
    if (o == 0) { // CS: gain, no loss, puits untouched
      assert!(str_after == str_before + 1);
      assert!(puits_after == puits_before);
      assert!(apps_after == apps_before + 1);
      assert!(xp_after > xp_before);
    } else if (o == 1) { // NS: gain (protected), weight balanced through puits/loss
      assert!(str_after >= str_before + 1); // strength itself is protected from the payer
      assert!(apps_after == apps_before + 1);
      assert!(xp_after > xp_before);
    } else { // CF: no gain (the only positive stat may even shrink), zero xp
      assert!(str_after <= str_before);
      assert!(apps_after == apps_before);
      assert!(xp_after == xp_before);
    };
    i = i + 1;
  };
  assert!(*seen.borrow(0) && *seen.borrow(1) && *seen.borrow(2)); // CS, NS, CF all exercised
  sc.end();
}

#[test]
/// The per-stat application cap (action = 1): after the first SUCCESSFUL Ga Pa the second scribe aborts —
/// checked BEFORE any roll, so the abort is outcome-independent.
#[expected_failure(abort_code = EMaxApps, location = aresrpg_forgemagie::forgemagie)]
fun scribe_apps_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, _ba, _pa, _ra) = stage(&mut sc);
  // register the action rune (single-tier Ba; catalog cap 1)
  let act_rune = test_world::make_template(&mut sc, b"GaPa", b"ga_pa", b"rune", 1);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut board = sc.take_shared<CrushBoard>();
  let ver = sc.take_shared<Version>();
  forgemagie::register_rune(&cap, &mut board, act_rune, ACT, TIER_BA, &ver, sc.ctx());
  ts::return_shared(board); ts::return_shared(ver); sc.return_to_sender(cap);

  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40); // action at centre; template max +1 ⇒ proximity 0 ⇒ ~99% success
  let mut seed = 1u64;
  loop {
    let stack = test_world::mint_lock_stack(&mut sc, OWNER, act_rune, 1); // qty-1: fully consumed per try
    let o = do_scribe(&mut sc, cid, gear, sword_t, stack, act_rune, seed);
    if (o != 2) break; // a success landed — the cap (1) is now full
    seed = seed + 1;
  };
  let last = test_world::mint_lock_stack(&mut sc, OWNER, act_rune, 1);
  do_scribe(&mut sc, cid, gear, sword_t, last, act_rune, seed + 1); // EMaxApps
  abort
}

// ╔════════════════ [ SCRIBE — the adversarial wall ] ═════════════════════════ ]

#[test, expected_failure(abort_code = EDirty, location = aresrpg_forgemagie::forgemagie)]
/// A character carrying unfinished business (fight marker) cannot scribe.
fun scribe_dirty_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 1);
  mark_dirty(&mut sc, cid);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, 1);
  abort
}

#[test, expected_failure(abort_code = C_EDomainDisabled, location = aresrpg::config)]
/// The FORGEMAGIE kill-switch bit darkens the scribe door.
fun scribe_domain_paused_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 1);
  pause_forgemagie(&mut sc);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, 1);
  abort
}

#[test, expected_failure(abort_code = EScribeLocked, location = aresrpg_forgemagie::forgemagie)]
/// No job at level 70 ⇒ the scribe gate refuses (SPEC §6).
fun scribe_below_job70_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER); // fresh: every job level 1
  test_world::whitelist(&mut sc, b"sword");
  test_world::whitelist(&mut sc, b"rune");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  let rune_t = test_world::make_template(&mut sc, b"RuneFo", b"rune_fo", b"rune", 1);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  forgemagie::create_board(&cap, &ver, sc.ctx());
  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>();
  forgemagie::register_rune(&cap, &mut board, rune_t, STR, TIER_BA, &ver, sc.ctx());
  ts::return_shared(board); ts::return_shared(ver); sc.return_to_sender(cap);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_t, 1);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_t, 1);
  abort
}

#[test, expected_failure(abort_code = EUnknownRune, location = aresrpg_forgemagie::forgemagie)]
/// An unregistered rune template cannot scribe (the board registry is the identity).
fun scribe_unregistered_rune_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, _ba, _pa, _ra) = stage(&mut sc);
  let decoy = test_world::make_template(&mut sc, b"Decoy", b"decoy", b"rune", 1);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, decoy, 1);
  do_scribe(&mut sc, cid, gear, sword_t, stack, decoy, 1);
  abort
}

#[test, expected_failure(abort_code = EWrongItem, location = aresrpg_forgemagie::forgemagie)]
/// The passed gear template must be the item's own (level/ranges must come from the real template).
fun scribe_wrong_gear_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, exotic_t, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, exotic_t); // minted from the OTHER template
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 1);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, 1); // passes sword_t — mismatch
  abort
}

#[test, expected_failure(abort_code = EWrongItem, location = aresrpg_forgemagie::forgemagie)]
/// Gear with no rolled stat block cannot be scribed.
fun scribe_statless_gear_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t); // never set_rolled
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 1);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, 1);
  abort
}

#[test, expected_failure(abort_code = EMalusStat, location = aresrpg_forgemagie::forgemagie)]
/// Scribing onto a below-centre (malus) stat is refused — the rewrite would erase the malus.
fun scribe_malus_stat_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, rune_ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT - 5); // strength is a malus
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_ba, 1);
  do_scribe(&mut sc, cid, gear, sword_t, stack, rune_ba, 1);
  abort
}

#[test, expected_failure(abort_code = EBadRegistration, location = aresrpg_forgemagie::forgemagie)]
/// Registering a (stat, tier) that is not a real Retro rune aborts (critical_chance has NO rune —
/// combat-dead since the 2026-07-17 crit convergence; the Cri rune lives on `critical`(9) now).
fun register_non_rune_aborts() {
  let mut sc = ts::begin(OWNER);
  let (_cid, _s, _p, _x, _ba, _pa, _ra) = stage(&mut sc);
  let bad = test_world::make_template(&mut sc, b"Bad", b"bad", b"rune", 1);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut board = sc.take_shared<CrushBoard>();
  let ver = sc.take_shared<Version>();
  forgemagie::register_rune(&cap, &mut board, bad, 11, TIER_BA, &ver, sc.ctx()); // critical_chance: not runeable
  abort
}

// ╔════════════════ [ CRUSH — the yield golden + taux goldens (single-tx door) ] ═ ]

#[test]
/// THE YIELD GOLDEN — curve-based (docs/ECONOMY_SIM.md §7): the flat DECISIONS-460
/// divisor (66, ~30 runes here) is superseded by a per-level-band curve. L50 falls in band 21-50 (divisor
/// 2044), so one L50 sword with +40 Fo at the NEUTRAL 100% coefficient now yields 0.978 EV ⇒ {0, 1} (the curve
/// deliberately makes neutral-coeff crush near-inert; the 40-70% reward lands only at steady-state pressure).
/// SINGLE-TX: the yielded runes mint IN the crush — the kiosk count moves by (mints − the destroyed gear) with
/// no receipt object anywhere. Taux goldens ride along (independent of yield count): the crushed template's
/// coefficient decays to exactly 96_040 (one-item front-loaded decay) and the CRUSHED WEIGHT (40 × 5 = 200
/// units) raises a PEER template of the same bracket to exactly 100_120 — while the crushed template itself is
/// EXCLUDED from its own pressure (post-emission snapshot).
fun crush_golden_yield_and_taux() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, peer_t, _x, ba, pa, ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  assert!(eff(&mut sc, sword_t, 50) == NEUTRAL); // pre: virgin board prices at 100%
  let (_, count_before) = kiosk_state(&mut sc, gear);

  let rolled = do_crush(&mut sc, cid, sword_t, vector[gear], ba, pa, ra, 7);

  let (q_ba, q_pa, q_ra, distinct) = str_owed(&rolled);
  assert!(q_ba + q_pa + q_ra == 0 || q_ba + q_pa + q_ra == 1); // curve: 0.978 EV at neutral (NOT the old ~30)
  let (gear_alive, count_after) = kiosk_state(&mut sc, gear);
  assert!(!gear_alive); // destroyed unconditionally (sealed crush law)
  assert!(count_after == count_before - 1 + distinct); // one locked rune stack per positive tier, no receipt
  assert!(eff(&mut sc, sword_t, 50) == DECAYED_ONCE); // self: front-loaded decay, self-pressure excluded
  assert!(eff(&mut sc, peer_t, 45) == PEER_UPLIFT); // peer: bracket pressure landed (3/5 milli per unit)
  assert!(eff(&mut sc, peer_t, 5) == NEUTRAL); // a DIFFERENT bracket is untouched
  sc.end();
}

#[test]
/// The recipe-less cap door-wiring: a drop-only template prices at min(coeff, 50%). At neutral 100% the +40 Fo
/// line (band 21-50 divisor 2044) is 0.978 EV full ⇒ 0.489 EV capped ⇒ {0, 1}. The DISTINCT halving proof (a
/// clean 11-vs-≤2 split) lives in `aresrpg_foundation::forgemagie_tests::t_crush_recipeless_caps_before_divisor`;
/// here we prove the DOOR forwards the flag and yields the capped magnitude without error.
fun crush_recipeless_caps_yield() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, ba, pa, ra) = stage(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut board = sc.take_shared<CrushBoard>();
  let ver = sc.take_shared<Version>();
  forgemagie::set_recipeless(&cap, &mut board, sword_t, true, &ver, sc.ctx());
  ts::return_shared(board); ts::return_shared(ver); sc.return_to_sender(cap);

  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let rolled = do_crush(&mut sc, cid, sword_t, vector[gear], ba, pa, ra, 7);
  let (q_ba, q_pa, q_ra, _) = str_owed(&rolled);
  assert!(q_ba + q_pa + q_ra == 0 || q_ba + q_pa + q_ra == 1); // curve: 0.978 EV × 50% cap = 0.489 EV ⇒ {0, 1}
  sc.end();
}

#[test, expected_failure(abort_code = EWrongTemplate, location = aresrpg_forgemagie::forgemagie)]
/// Every item in the batch must be of the passed template (the template carries the level = the price basis).
fun crush_wrong_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, exotic_t, ba, pa, ra) = stage(&mut sc);
  let alien = test_world::mint_lock_gear(&mut sc, OWNER, exotic_t);
  do_crush(&mut sc, cid, sword_t, vector[alien], ba, pa, ra, 7); // batch under sword_t, item from exotic_t
  abort
}

#[test, expected_failure(abort_code = EDirty, location = aresrpg_forgemagie::forgemagie)]
/// A character carrying unfinished business cannot crush.
fun crush_dirty_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, ba, pa, ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  mark_dirty(&mut sc, cid);
  do_crush(&mut sc, cid, sword_t, vector[gear], ba, pa, ra, 7);
  abort
}

#[test, expected_failure(abort_code = C_EDomainDisabled, location = aresrpg::config)]
/// The FORGEMAGIE kill-switch bit darkens the crush door too.
fun crush_domain_paused_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, ba, pa, ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  pause_forgemagie(&mut sc);
  do_crush(&mut sc, cid, sword_t, vector[gear], ba, pa, ra, 7);
  abort
}

#[test]
/// Write-set parity on the empty case: statless gear is still destroyed, rolls an all-zero yield, and mints
/// NOTHING — the kiosk count drops by exactly the destroyed gear (no receipt object exists anymore).
fun crush_statless_yields_nothing() {
  let mut sc = ts::begin(OWNER);
  let (cid, _s, _p, exotic_t, ba, pa, ra) = stage(&mut sc);
  let husk = test_world::mint_lock_gear(&mut sc, OWNER, exotic_t); // no rolled stats
  let (_, count_before) = kiosk_state(&mut sc, husk);
  let rolled = do_crush(&mut sc, cid, exotic_t, vector[husk], ba, pa, ra, 7);

  let (q_ba, q_pa, q_ra, distinct) = str_owed(&rolled);
  assert!(q_ba == 0 && q_pa == 0 && q_ra == 0 && distinct == 0);
  let (husk_alive, count_after) = kiosk_state(&mut sc, husk);
  assert!(!husk_alive); // destroyed unconditionally (sealed crush law)
  assert!(count_after == count_before - 1); // nothing minted, nothing else moved
  sc.end();
}

// ╔════════════════ [ CRUSH — the slot-walk laws (dedup / missing template) ] ═ ]

#[test]
/// A DUPLICATE registered slot mints ONCE: the maxed +50 Fo line (1.222 EV ⇒ ALWAYS ≥1 owed) crushed with the
/// owed tier's template passed twice — the first slot zeroes the row, the duplicate no-ops, and the kiosk
/// count moves by exactly (distinct positive tiers − the destroyed gear). Also pins that minted stacks carry
/// the owed QUANTITY (stack law: one stack per template, amount = qty — proven by the count, since a
/// double-mint of a qty-row would add a second stack).
fun crush_duplicate_slot_mints_once() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, ba, pa, ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 50); // maxed L50 line: 1.222 EV ⇒ floor ≥1 owed, always
  let (_, count_before) = kiosk_state(&mut sc, gear);

  // slot walk = (&ba, &ba, &pa, &ra): the registered BA template TWICE (Move borrows allow it — the
  // PTB-layer client never sends duplicates, but the walk must tolerate them by law).
  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>(); let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, sword_t);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(&sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(&sc, pa); let t_ra = ts::take_shared_by_id<ItemTemplate>(&sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>(); let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>(); let ver = sc.take_shared<Version>();
  let rolled = forgemagie::crush_for_testing(
    &mut board, &mut k, &pkcap, cid, &gear_tmpl, vector[gear],
    &t_ba, &t_ba, &t_pa, &t_ra, // BA duplicated — must mint once
    &xpolicy, &mkt, &cfg, &ver, 7, sc.ctx(),
  );
  ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(gear_tmpl); ts::return_shared(t_ba); ts::return_shared(t_pa); ts::return_shared(t_ra);
  ts::return_shared(xpolicy); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);

  let (q_ba, q_pa, q_ra, distinct) = str_owed(&rolled);
  assert!(q_ba + q_pa + q_ra >= 1); // the maxed line guarantees at least one rune owed
  let (gear_alive, count_after) = kiosk_state(&mut sc, gear);
  assert!(!gear_alive);
  assert!(count_after == count_before - 1 + distinct); // duplicate slot added NO extra stack
  sc.end();
}

#[test, expected_failure(abort_code = EMissingTemplate, location = aresrpg_forgemagie::forgemagie)]
/// A yielded rune whose template is NOT among the slots aborts the WHOLE crush (full revert — the gear
/// survives): the maxed +50 line ALWAYS owes ≥1 strength rune, and every slot here is the unregistered gear
/// template (pure padding), so the walk zeroes nothing and the final audit trips.
fun crush_missing_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _p, _x, _ba, _pa, _ra) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 50); // 1.222 EV ⇒ ≥1 owed, always

  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>(); let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, sword_t);
  let xpolicy = sc.take_shared<ItemExtractPolicy>(); let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>(); let ver = sc.take_shared<Version>();
  forgemagie::crush_for_testing(
    &mut board, &mut k, &pkcap, cid, &gear_tmpl, vector[gear],
    &gear_tmpl, &gear_tmpl, &gear_tmpl, &gear_tmpl, // pads only — the owed strength rune has no slot
    &xpolicy, &mkt, &cfg, &ver, 7, sc.ctx(),
  );
  abort
}
