// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOOT BOX tests — the §11 gacha PET box over the real cross-package scaffold (items + game booted & enabled, the
/// item marketplace + extraction policies, a real personal kiosk holding a locked box stack, the shared
/// `LootRegistry`). Proves the two-phase door end-to-end: `admin_set_loot_table` upserts + validates; `open_box`
/// (BOTH the live `&Random` entry off a seeded framework Random AND the deterministic generator) burns exactly one
/// box unit and mints a SOULBOUND `PetBoxClaim` for the rolled pet; `claim_pet` mints the kiosk-LOCKED pet and burns
/// the claim; the weighted walk is boundary-exact; and every abort (not-a-box, no-table, empty/mismatch/zero-weight
/// set, claim mismatch) reverts. Runs the REAL value paths.
#[test_only]
module aresrpg_gifting::loot_box_tests;

use aresrpg::{admin::{Self, AdminCap, Self as catalog, Catalog}, config::{Self as gconfig, GameConfig}, consumable_effect, extension, extract::{Self, ItemExtractPolicy}, item::{Self as item, Item, ItemTemplate}, version::{Self, Version}};
use aresrpg_gifting::{loot_box::{Self, LootRegistry, PetBoxClaim}, gifting::Gifting};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  random::{Self, Random},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

// ── mirrored abort codes (location = loot_box disambiguates) ──
const ENoTable: u64 = 101;
const EZeroWeight: u64 = 102;
const ENotBox: u64 = 103;
const EEmptyTable: u64 = 104;
const ELengthMismatch: u64 = 105;
const EClaimMismatch: u64 = 106;

// ╔════════════════ [ Scaffold ] ═════════════════════════════════════════════ ]

fun stand_up(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  gconfig::test_init(sc.ctx());
  item::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());
  loot_box::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  gconfig::set_enabled(&cap, &mut cfg, true, sc.ctx());
  gconfig::set_gifting_brand<Gifting>(&cap, &mut cfg, &ver, sc.ctx()); // the split's pin
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"consumable".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"pet".to_string(), &ver, sc.ctx());

  // the item marketplace policy + the wrapped extraction policy (both off the item Publisher)
  let item_pub = sc.take_from_sender<Publisher>();
  assert!(package::from_module<Item>(&item_pub));
  let (ipolicy, ipolicy_cap) = item::create_item_policy(&item_pub, &ver, sc.ctx());
  extract::create_extract_policy(&item_pub, &ver, sc.ctx());
  transfer::public_share_object(ipolicy);
  transfer::public_transfer(ipolicy_cap, OWNER);
  transfer::public_transfer(item_pub, OWNER);
  ts::return_shared(ver); ts::return_shared(cfg); ts::return_shared(cat);
  sc.return_to_sender(cap);

  // seed a framework Random so the LIVE open_box entry can draw
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0404040404040404040404040404040404040404040404040404040404040404", sc.ctx());
  ts::return_shared(r);
}

// ╔════════════════ [ Factories ] ════════════════════════════════════════════ ]

/// Author + share a gacha BOX template (consumable category + KIND_GACHA_ROLL effect). Returns its id.
fun mk_box(sc: &mut Scenario): ID {
  mk_template(sc, b"mystery_box".to_string(), b"consumable".to_string(), option::some(consumable_effect::new(consumable_effect::gacha_roll(), 0)))
}

/// Author + share a consumable HEAL template (a consumable that is NOT a box — the not-a-box case). Returns its id.
fun mk_heal_consumable(sc: &mut Scenario): ID {
  mk_template(sc, b"potion".to_string(), b"consumable".to_string(), option::some(consumable_effect::new(consumable_effect::heal(), 5)))
}

/// Author + share a PET template (non-stackable, no effect). Returns its id.
fun mk_pet(sc: &mut Scenario, item_type: vector<u8>): ID {
  mk_template(sc, item_type.to_string(), b"pet".to_string(), option::none())
}

fun mk_template(sc: &mut Scenario, item_type: std::string::String, category: std::string::String, effect: Option<consumable_effect::ConsumableEffect>): ID {
  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let tid = admin::create_template(
    &cap, &cat, b"Item".to_string(), b"".to_string(), item_type, category, 1,
    option::none(), option::none(), vector[], effect, &ver, sc.ctx(),
  );
  ts::return_shared(cat); ts::return_shared(ver); sc.return_to_sender(cap);
  tid
}

/// A fresh personal kiosk owned by `who` (holds the box stack; the pet lands here on claim).
fun mk_kiosk(sc: &mut Scenario, who: address) {
  sc.next_tx(who);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(k);
}

/// Mint a locked box stack of `qty` units from `tid` into `who`'s kiosk. Returns the item id.
fun mk_box_stack(sc: &mut Scenario, who: address, tid: ID, qty: u64): ID {
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

fun set_table(sc: &mut Scenario, box_tid: ID, templates: vector<ID>, weights: vector<u64>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut reg = sc.take_shared<LootRegistry>();
  loot_box::admin_set_loot_table(&cap, &mut reg, box_tid, templates, weights, &ver, sc.ctx());
  ts::return_shared(reg); ts::return_shared(ver); sc.return_to_sender(cap);
}

// ── open drivers: the LIVE `&Random` entry, and the deterministic generator ──

fun open_real(sc: &mut Scenario, who: address, box_id: ID, box_tid: ID) {
  sc.next_tx(who);
  let reg = sc.take_shared<LootRegistry>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, box_tid);
  let xpol = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let r = sc.take_shared<Random>();
  loot_box::open_box(&reg, &mut k, &pkcap, box_id, &tmpl, &xpol, &mkt, &cfg, &ver, &r, sc.ctx());
  ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(tmpl);
  ts::return_shared(xpol); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(r);
}

fun open_det(sc: &mut Scenario, who: address, box_id: ID, box_tid: ID) {
  sc.next_tx(who);
  let reg = sc.take_shared<LootRegistry>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, box_tid);
  let xpol = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  loot_box::open_for_testing(&reg, &mut k, &pkcap, box_id, &tmpl, &xpol, &mkt, &cfg, &ver, sc.ctx());
  ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(tmpl);
  ts::return_shared(xpol); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Read + assert the claim's fields, then redeem it (mint the pet). Returns nothing — asserts inline.
fun claim(sc: &mut Scenario, who: address, pet_tid: ID) {
  sc.next_tx(who);
  let claim = sc.take_from_sender<PetBoxClaim>();
  let ver = sc.take_shared<Version>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, pet_tid);
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  loot_box::claim_pet(claim, &tmpl, &cfg, &ver, &mut k, &pkcap, &mkt, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(tmpl); ts::return_shared(mkt);
}

fun kiosk_count(sc: &mut Scenario, who: address): u32 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let n = k.item_count();
  ts::return_shared(k);
  n
}

fun has_box(sc: &mut Scenario, who: address, box_id: ID): bool {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let has = k.has_item(box_id);
  ts::return_shared(k);
  has
}

// ╔════════════════ [ Golden path — live entry rolls, claim mints a kiosk-locked pet ] ═ ]

#[test]
/// A single-row table makes the roll DETERMINISTIC (any draw picks the one pet). The LIVE &Random `open_box`
/// burns the box + mints a soulbound claim for that pet; the claim's reads round-trip; `claim_pet` mints the pet
/// LOCKED into the kiosk and burns the claim.
fun open_and_claim_golden() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"bouloute");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[pet_tid], vector[100]);

  open_real(&mut sc, OWNER, box_id, box_tid);

  // the claim landed on the opener, soulbound, recording the (only possible) rolled pet
  sc.next_tx(OWNER);
  {
    let claim = sc.take_from_sender<PetBoxClaim>();
    assert_eq!(loot_box::claim_opener(&claim), OWNER);
    assert_eq!(loot_box::claim_box(&claim), box_tid);
    assert_eq!(loot_box::claim_rolled(&claim), pet_tid);
    ts::return_to_sender(&sc, claim);
  };
  assert!(!has_box(&mut sc, OWNER, box_id)); // the box unit was consumed (stack of 1 → nothing left)
  let before = kiosk_count(&mut sc, OWNER); // 0 items now (box burned, claim is owned not kiosk'd)

  claim(&mut sc, OWNER, pet_tid);
  assert_eq!(kiosk_count(&mut sc, OWNER), before + 1); // the pet NFT is now LOCKED in the kiosk

  // the claim was burned — none left for the opener
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_for_sender<PetBoxClaim>(&sc));
  sc.end();
}

#[test]
/// Deterministic-generator open over the SAME single-row table also yields the pet, and `claim_pet` mints it.
/// (Covers the `open_for_testing` path; a broader burn assertion follows.)
fun open_det_and_claim() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"tokeko");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[pet_tid], vector[7]);
  open_det(&mut sc, OWNER, box_id, box_tid);
  claim(&mut sc, OWNER, pet_tid);
  assert_eq!(kiosk_count(&mut sc, OWNER), 1);
  sc.end();
}

// ╔════════════════ [ Burn semantics — exactly one unit per open ] ════════════ ]

#[test]
/// Opening from a stack of 2 burns EXACTLY ONE: the original stack object is gone but a remainder is re-locked,
/// so the kiosk item COUNT is unchanged (1 box object → 1 remainder object). Not the whole stack.
fun burn_exactly_one_leaves_remainder() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"modni_lyk");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 2);
  set_table(&mut sc, box_tid, vector[pet_tid], vector[1]);
  let before = kiosk_count(&mut sc, OWNER); // 1 (the box stack object)
  open_det(&mut sc, OWNER, box_id, box_tid);
  assert!(!has_box(&mut sc, OWNER, box_id)); // original stack consumed…
  assert_eq!(kiosk_count(&mut sc, OWNER), before); // …but a remainder (1 unit) was re-locked → count unchanged
  sc.end();
}

#[test]
/// A stack of exactly 1 is fully consumed by one open — no remainder, so the kiosk count DROPS by one.
fun single_unit_no_remainder() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"aetherwing");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[pet_tid], vector[1]);
  let before = kiosk_count(&mut sc, OWNER); // 1
  open_det(&mut sc, OWNER, box_id, box_tid);
  assert_eq!(kiosk_count(&mut sc, OWNER), before - 1); // 0 — the single unit was burned, nothing re-locked
  sc.end();
}

// ╔════════════════ [ Weighted walk — boundary-exact (the distribution proof) ] ═ ]

#[test]
/// A ZERO-WEIGHT row mid-table is inert (money-hat rider 1): over [10,0,5] (sum 15) the 0-row NEVER wins and the
/// windows stay exact — A[0,10), B empty, C[10,15). Every draw maps to A or C only.
fun pick_zero_weight_row_never_wins() {
  let a = id(0); let b = id(1); let c = id(2);
  let _ = b; // row B exists in the table but must never be picked
  let t = vector[a, b, c];
  let w = vector[10, 0, 5];
  assert_eq!(loot_box::test_pick(t, w, 0), a);
  assert_eq!(loot_box::test_pick(t, w, 9), a); // A's last draw
  assert_eq!(loot_box::test_pick(t, w, 10), c); // B is skipped — the boundary lands on C
  assert_eq!(loot_box::test_pick(t, w, 14), c); // sum-1, the last valid draw
}

#[test]
/// Multi-row OPEN wiring (money-hat rider 2): a REAL 3-row table through the open door — the sum>1 draw→pick
/// path — yields a claim whose rolled template is a MEMBER of the authored pool, box/opener bound correctly.
fun open_multi_row_rolls_within_pool() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let p0 = mk_pet(&mut sc, b"bouloute");
  let p1 = mk_pet(&mut sc, b"modni_lyk");
  let p2 = mk_pet(&mut sc, b"tokeko");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[p0, p1, p2], vector[70, 50, 25]);
  open_det(&mut sc, OWNER, box_id, box_tid);
  sc.next_tx(OWNER);
  let claim = sc.take_from_sender<PetBoxClaim>();
  let rolled = loot_box::claim_rolled(&claim);
  assert!(rolled == p0 || rolled == p1 || rolled == p2); // the roll never escapes the authored pool
  assert_eq!(loot_box::claim_box(&claim), box_tid);
  assert_eq!(loot_box::claim_opener(&claim), OWNER);
  ts::return_to_sender(&sc, claim);
  sc.end();
}

#[test]
/// The cumulative-window walk over the NORMAL pool [70,50,25,8,8] (sum 161): every boundary maps to the right pet.
/// An exact proof (stronger than statistical sampling): draw d ∈ [Σ<i, Σ≤i) ⇒ row i.
fun pick_walk_is_boundary_exact() {
  let a = id(0); let b = id(1); let c = id(2); let d = id(3); let e = id(4);
  let t = vector[a, b, c, d, e];
  let w = vector[70, 50, 25, 8, 8]; // windows: A[0,70) B[70,120) C[120,145) D[145,153) E[153,161)
  assert_eq!(loot_box::test_pick(t, w, 0), a);
  assert_eq!(loot_box::test_pick(t, w, 69), a);
  assert_eq!(loot_box::test_pick(t, w, 70), b);
  assert_eq!(loot_box::test_pick(t, w, 119), b);
  assert_eq!(loot_box::test_pick(t, w, 120), c);
  assert_eq!(loot_box::test_pick(t, w, 144), c);
  assert_eq!(loot_box::test_pick(t, w, 145), d);
  assert_eq!(loot_box::test_pick(t, w, 152), d);
  assert_eq!(loot_box::test_pick(t, w, 153), e);
  assert_eq!(loot_box::test_pick(t, w, 160), e); // sum-1, the last valid draw
}

// ╔════════════════ [ Registry — set validation + reads round-trip ] ══════════ ]

#[test]
/// A set persists: has_table, row count, weight sum, and the full entries (template+weight per row) round-trip.
fun set_and_reads_roundtrip() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let box_tid = mk_box(&mut sc);
  let p0 = mk_pet(&mut sc, b"doris");
  let p1 = mk_pet(&mut sc, b"moray");
  set_table(&mut sc, box_tid, vector[p0, p1], vector[70, 40]);

  sc.next_tx(OWNER);
  let reg = sc.take_shared<LootRegistry>();
  assert!(loot_box::has_table(&reg, box_tid));
  assert!(!loot_box::has_table(&reg, p0)); // an id with no table reads false
  assert_eq!(loot_box::table_rows(&reg, box_tid), 2);
  assert_eq!(loot_box::table_weight_sum(&reg, box_tid), 110);
  let entries = loot_box::table_entries(&reg, box_tid);
  assert_eq!(loot_box::entry_template(entries.borrow(0)), p0);
  assert_eq!(loot_box::entry_weight(entries.borrow(0)), 70);
  assert_eq!(loot_box::entry_template(entries.borrow(1)), p1);
  assert_eq!(loot_box::entry_weight(entries.borrow(1)), 40);
  ts::return_shared(reg);
  sc.end();
}

#[test]
/// The setter UPSERTS: a second set for the same box REPLACES the pool (rows + sum reflect the new table).
fun set_upsert_replaces() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let box_tid = mk_box(&mut sc);
  let p0 = mk_pet(&mut sc, b"chromafin");
  let p1 = mk_pet(&mut sc, b"chomperion");
  let p2 = mk_pet(&mut sc, b"cryofin");
  set_table(&mut sc, box_tid, vector[p0], vector[10]);
  set_table(&mut sc, box_tid, vector[p0, p1, p2], vector[70, 10, 10]);
  sc.next_tx(OWNER);
  let reg = sc.take_shared<LootRegistry>();
  assert_eq!(loot_box::table_rows(&reg, box_tid), 3);
  assert_eq!(loot_box::table_weight_sum(&reg, box_tid), 90);
  ts::return_shared(reg);
  sc.end();
}

// ╔════════════════ [ Adversarial matrix ] ════════════════════════════════════ ]

#[test, expected_failure(abort_code = ENotBox, location = loot_box)]
/// A consumable that is NOT a gacha box (a HEAL potion) cannot be opened → ENotBox, before any burn.
fun open_non_box_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let heal_tid = mk_heal_consumable(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"bouloute");
  let iid = mk_box_stack(&mut sc, OWNER, heal_tid, 1);
  set_table(&mut sc, heal_tid, vector[pet_tid], vector[1]); // even WITH a table, a non-box aborts on the kind check
  open_det(&mut sc, OWNER, iid, heal_tid);
  abort
}

#[test, expected_failure(abort_code = ENoTable, location = loot_box)]
/// A real box whose loot table was never set aborts ENoTable (before any burn).
fun open_unset_table_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  open_det(&mut sc, OWNER, box_id, box_tid); // no set_table
  abort
}

#[test, expected_failure(abort_code = EClaimMismatch, location = loot_box)]
/// Claiming with a pet template that is NOT the one the roll recorded aborts EClaimMismatch (no free pet swap).
fun claim_wrong_template_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let rolled = mk_pet(&mut sc, b"tokeko");
  let other = mk_pet(&mut sc, b"aetherwing");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[rolled], vector[1]); // deterministic → rolled
  open_det(&mut sc, OWNER, box_id, box_tid);
  claim(&mut sc, OWNER, other); // claiming the wrong pet → EClaimMismatch
  abort
}

#[test, expected_failure(abort_code = EEmptyTable, location = loot_box)]
fun set_empty_table_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let box_tid = mk_box(&mut sc);
  set_table(&mut sc, box_tid, vector[], vector[]);
  abort
}

#[test, expected_failure(abort_code = ELengthMismatch, location = loot_box)]
fun set_length_mismatch_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let box_tid = mk_box(&mut sc);
  let p0 = mk_pet(&mut sc, b"doris");
  let p1 = mk_pet(&mut sc, b"moray");
  set_table(&mut sc, box_tid, vector[p0, p1], vector[70]); // 2 templates, 1 weight
  abort
}

#[test, expected_failure(abort_code = EZeroWeight, location = loot_box)]
fun set_zero_weight_sum_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let box_tid = mk_box(&mut sc);
  let p0 = mk_pet(&mut sc, b"doris");
  set_table(&mut sc, box_tid, vector[p0], vector[0]); // sum 0 → never rollable
  abort
}

#[test, expected_failure(abort_code = ENotBox, location = loot_box)]
/// A template with NO consumable effect at all (a pet) is not a box → ENotBox on the `has_effect` short-circuit,
/// before the box id is ever touched.
fun open_non_consumable_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let pet_tid = mk_pet(&mut sc, b"tokeko");
  open_det(&mut sc, OWNER, id(999), pet_tid); // pet template is not a gacha box → ENotBox (dummy box id, never reached)
  abort
}

const V_ENotEnabled: u64 = 102; // version::ENotEnabled — the package dark-ship gate

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
/// The money door refuses while the package is DARK: an emergency `admin_set_enabled(false)` blocks `open_box`
/// (version.assert_enabled) — no box burns, no pet mints, during a freeze.
fun open_while_frozen_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_kiosk(&mut sc, OWNER);
  let box_tid = mk_box(&mut sc);
  let pet_tid = mk_pet(&mut sc, b"bouloute");
  let box_id = mk_box_stack(&mut sc, OWNER, box_tid, 1);
  set_table(&mut sc, box_tid, vector[pet_tid], vector[1]);
  sc.next_tx(OWNER);
  {
    let cap = sc.take_from_sender<AdminCap>();
    let mut ver = sc.take_shared<Version>();
    admin::admin_set_enabled(&cap, &mut ver, false, sc.ctx()); // dark the package
    ts::return_shared(ver); sc.return_to_sender(cap);
  };
  open_det(&mut sc, OWNER, box_id, box_tid); // package disabled → ENotEnabled
  abort
}

// small deterministic id factory for the pure pick test
fun id(n: u64): ID { object::id_from_address(sui::address::from_u256(n as u256)) }
