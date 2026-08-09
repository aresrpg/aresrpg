// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Character-extract (DELETE door) tests — characters are deletable from the characters tab, provided
/// everything was unequipped first (even the free one). Covers the whole guard matrix:
/// unequipped fresh character burns (the free-starter shape), the REAL derived-name-claimed shape burns, a
/// PLAYED character (plain-data DFs) burns, an equipped item refuses, equip→unequip→delete succeeds (map
/// exists but empty), wrong kiosk / foreign cap refuse at the framework wall, an unopened-fight marker and a
/// dungeon lock refuse, and the dark-package gate holds. Deletion is IN-KIOSK by construction (the zero-price
/// extract + destroy composes inside ONE door call — no Character value ever reaches a test/address surface).
#[test_only]
module aresrpg::character_extract_tests;

use aresrpg::{admin::{Self, AdminCap, Self as catalog, Catalog}, character::{Self, Character}, character_extract::{Self, CharacterExtractPolicy}, character_link, equipment, extension, extract::{Self, ItemExtractPolicy}, item::{Self, Item, ItemTemplate}, version::{Self, Version}, fight};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{
  event,
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;
const ATTACKER: address = @0xC;

// ── mirrored error values (module-local; `location` disambiguates which module aborted) ──
const EItemsEquipped: u64 = 101; // character_extract — an equipped item would be orphaned by the burn
const EUnfinishedBusiness: u64 = 102; // character_extract — unopened fight result / live PvM seat
const EInDungeon: u64 = 103; // character_extract — mid-dungeon-run (exit/abandon first)
const K_ENotOwner: u64 = 0; // sui::kiosk — the cap does not authorize this kiosk
const K_EItemNotFound: u64 = 11; // sui::kiosk — this kiosk does not hold the item
const V_ENotEnabled: u64 = 102; // version — package is dark

// ╔════════════════ [ Harness (the equipment_tests stand-up + the extract policies) ] ═ ]

/// Boot version/admin/item/character/catalog ENABLED, whitelist the categories the equip tests use, create
/// the marketplace + character + item-extract policies AND the character-extract (delete) policy.
fun setup(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"longsword".to_string(), &ver, sc.ctx());

  let pub_a = sc.take_from_sender<Publisher>();
  let pub_b = sc.take_from_sender<Publisher>();
  let (item_pub, char_pub) = if (package::from_module<Item>(&pub_a)) (pub_a, pub_b) else (pub_b, pub_a);
  let (ipolicy, ipolicy_cap) = item::create_item_policy(&item_pub, &ver, sc.ctx());
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&char_pub, &ver, sc.ctx());
  extract::create_extract_policy(&item_pub, &ver, sc.ctx());
  character_extract::create_character_extract_policy(&char_pub, &ver, sc.ctx());
  transfer::public_share_object(ipolicy);
  transfer::public_share_object(cpolicy);
  transfer::public_transfer(ipolicy_cap, OWNER);
  transfer::public_transfer(cpolicy_cap, OWNER);
  transfer::public_transfer(item_pub, OWNER);
  transfer::public_transfer(char_pub, OWNER);

  ts::return_shared(ver);
  ts::return_shared(cat);
  sc.return_to_sender(cap);
}

/// Mint a SENSHI locked into a fresh personal kiosk owned by the current sender. Returns kiosk + cap + id.
fun mint_char(sc: &mut Scenario, who: address): (Kiosk, PersonalKioskCap, ID) {
  sc.next_tx(who);
  let cpolicy = sc.take_shared<TransferPolicy<Character>>();
  let cust = character::new_customization(1, 2, 3);
  let (chr, pledge) = character::new_for_testing(b"hero".to_string(), b"senshi".to_string(), true, cust, 1000, sc.ctx());
  let cid = character::id(&chr);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  character::lock_in_kiosk(pledge, chr, &mut k, personal_kiosk::borrow(&pkcap), &cpolicy);
  ts::return_shared(cpolicy);
  (k, pkcap, cid)
}

/// Author + share a statless level-1 longsword template; returns its id.
fun author_longsword(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, b"longsword".to_string(), b"".to_string(), b"longsword".to_string(), b"longsword".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Mint ONE item from `tid` and lock it into `k`; returns the item id.
fun mint_lock(sc: &mut Scenario, k: &mut Kiosk, pkcap: &PersonalKioskCap, tid: ID): ID {
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (it, pledge) = extension::y29(&tmpl, option::none(), &ver, sc.ctx());
  let item_id = object::id(&it);
  item::lock_in_kiosk(pledge, it, k, personal_kiosk::borrow(pkcap), &mkt);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(mkt);
  item_id
}

/// Extract + place `item_id` into its slot on `cid` (the real equip ceremony).
fun equip_item(sc: &mut Scenario, k: &mut Kiosk, pkcap: &PersonalKioskCap, cid: ID, item_id: ID, tid: ID) {
  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let (item, pledge) = extract::extract_for_equip(k, pkcap, item_id, &xpolicy, &ver, sc.ctx());
  equipment::equip(k, pkcap, cid, item, pledge, &tmpl, &ver);
  ts::return_shared(ver);
  ts::return_shared(xpolicy);
  ts::return_shared(tmpl);
}

/// Drive the DELETE door for `cid` out of `k` (kiosk-owner-signed via `pkcap`).
fun delete(sc: &mut Scenario, k: &mut Kiosk, pkcap: &PersonalKioskCap, cid: ID, who: address) {
  sc.next_tx(who);
  let ver = sc.take_shared<Version>();
  let dpolicy = sc.take_shared<CharacterExtractPolicy>();
  character_extract::delete_character(k, pkcap, cid, &dpolicy, &ver, sc.ctx());
  ts::return_shared(ver);
  ts::return_shared(dpolicy);
}

/// Sink the harness-owned kiosk + soulbound cap at the end of a test (force-drop — the scenario is over).
fun sink(k: Kiosk, pkcap: PersonalKioskCap) {
  destroy(k);
  destroy(pkcap);
}

// ╔════════════════ [ Green paths — the burn ] ═══════════════════════════════ ]

#[test]
fun delete_unequipped_character_burns() {
  // The FREE-STARTER shape — even a free character is deletable: a fresh character — no equipment map, no
  // progression, level 1 — burns. On-chain a free and a paid character are the SAME struct with zero
  // marker DFs (the free-claim marker lives on the creation gate keyed by ADDRESS, never on the character).
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);
  assert!(k.has_item(cid));

  delete(&mut sc, &mut k, &pkcap, cid, OWNER);

  assert!(!k.has_item(cid)); // gone from the kiosk — and destroyed, not delivered (no address path exists)
  let deleted = event::events_by_type<character_extract::CharacterDeleted>();
  assert_eq!(deleted.length(), 1);
  assert_eq!(character_extract::deleted_character(&deleted[0]), cid);
  assert_eq!(character_extract::deleted_name(&deleted[0]), b"hero".to_string());
  sink(k, pkcap);
  sc.end();
}

#[test]
fun delete_derived_name_claimed_character_burns() {
  // The REAL on-chain shape: every live character's UID is a `derived_object::claim` off the creation
  // gate (name-derived). The framework supports deleting a derived UID (`derived_object::exists` then
  // reads true forever — the name stays reserved, documented in character.move). Prove the burn works
  // on THIS shape, not just the fresh `object::new` test shape.
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);

  sc.next_tx(OWNER);
  let cpolicy = sc.take_shared<TransferPolicy<Character>>();
  let mut parent = object::new(sc.ctx()); // stands in for the creation gate's own UID
  let (chr, pledge) = character::new(
    &mut parent, b"named_hero".to_string(), b"Named Hero".to_string(), b"senshi".to_string(), true,
    character::new_customization(1, 2, 3), 1000,
  );
  let cid = character::id(&chr);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  character::lock_in_kiosk(pledge, chr, &mut k, personal_kiosk::borrow(&pkcap), &cpolicy);
  ts::return_shared(cpolicy);

  delete(&mut sc, &mut k, &pkcap, cid, OWNER);

  assert!(!k.has_item(cid));
  parent.delete();
  sink(k, pkcap);
  sc.end();
}

#[test]
fun delete_played_character_with_data_fields_burns() {
  // A PLAYED character carries plain-DATA dynamic fields (progression block here). Deletion ORPHANS
  // them by design (they are un-enumerable on-chain and carry no player value — only equipped Items
  // do, and those are guard-refused). The burn must succeed with the DFs still attached.
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);

  sc.next_tx(OWNER);
  {
    let ver = sc.take_shared<Version>();
    let character: &mut Character = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::write_back_hp_for_testing(character, 5, 1_000, &ver); // births the progression DF
    ts::return_shared(ver);
  };

  delete(&mut sc, &mut k, &pkcap, cid, OWNER);
  assert!(!k.has_item(cid));
  sink(k, pkcap);
  sc.end();
}

#[test]
fun delete_after_unequip_succeeds() {
  // The required flow: unequip everything FIRST, then delete. The equipment map still EXISTS
  // (emptied, not removed) — the guard must read occupancy, never mere map presence.
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);
  let tid = author_longsword(&mut sc);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  sc.next_tx(OWNER);
  {
    let ver = sc.take_shared<Version>();
    let mkt = sc.take_shared<TransferPolicy<Item>>();
    let (it, lock) = equipment::unequip(&mut k, &pkcap, cid, item_id, &ver);
    item::lock_in_kiosk(lock, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
    ts::return_shared(ver);
    ts::return_shared(mkt);
  };

  delete(&mut sc, &mut k, &pkcap, cid, OWNER);
  assert!(!k.has_item(cid));
  assert!(k.has_item(item_id)); // the unequipped item SURVIVES, still kiosk-locked
  sink(k, pkcap);
  sc.end();
}

// ╔════════════════ [ Refusals — the guard matrix ] ══════════════════════════ ]

#[test, expected_failure(abort_code = EItemsEquipped, location = character_extract)]
fun delete_with_equipped_item_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);
  let tid = author_longsword(&mut sc);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  delete(&mut sc, &mut k, &pkcap, cid, OWNER); // EItemsEquipped — the weapon would be orphaned
  abort
}

#[test, expected_failure(abort_code = K_EItemNotFound, location = sui::kiosk)]
fun delete_from_wrong_kiosk_aborts() {
  // The attacker's own (valid) kiosk+cap cannot name the character owned by OWNER — the framework list wall.
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (k_owner, pkcap_owner, cid) = mint_char(&mut sc, OWNER);
  let (mut k_attacker, pkcap_attacker, _own_cid) = mint_char(&mut sc, ATTACKER);

  delete(&mut sc, &mut k_attacker, &pkcap_attacker, cid, ATTACKER); // EItemNotFound
  abort
}

#[test, expected_failure(abort_code = K_ENotOwner, location = sui::kiosk)]
fun delete_with_foreign_cap_aborts() {
  // A kiosk owned by OWNER, opened with the ATTACKER's cap — the framework cap-match wall.
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k_owner, pkcap_owner, cid) = mint_char(&mut sc, OWNER);
  let (k_attacker, pkcap_attacker, _own_cid) = mint_char(&mut sc, ATTACKER);

  delete(&mut sc, &mut k_owner, &pkcap_attacker, cid, ATTACKER); // ENotOwner
  abort
}

#[test, expected_failure(abort_code = EUnfinishedBusiness, location = character_extract)]
fun delete_marked_character_aborts() {
  // An unopened PvM result (the fight_marker dirty counter) blocks deletion — the same unfinished-
  // business wall the sale rule enforces (character_listing_rule).
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);

  sc.next_tx(OWNER);
  {
    let ver = sc.take_shared<Version>();
    let character: &mut Character = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    fight::mark_for_testing(character, &ver);
    ts::return_shared(ver);
  };

  delete(&mut sc, &mut k, &pkcap, cid, OWNER); // EUnfinishedBusiness
  abort
}

#[test, expected_failure(abort_code = EInDungeon, location = character_extract)]
fun delete_dungeon_locked_character_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);

  sc.next_tx(OWNER);
  {
    let character: &mut Character = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::lock(character, object::id_from_address(@0xBEEF), object::id_from_address(@0xCAFE));
  };

  delete(&mut sc, &mut k, &pkcap, cid, OWNER); // EInDungeon — exit/abandon the run first
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun delete_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc, OWNER);

  sc.next_tx(OWNER);
  {
    let cap = sc.take_from_sender<AdminCap>();
    let mut ver = sc.take_shared<Version>();
    admin::admin_set_enabled(&cap, &mut ver, false, sc.ctx()); // the master kill-switch
    ts::return_shared(ver);
    sc.return_to_sender(cap);
  };

  delete(&mut sc, &mut k, &pkcap, cid, OWNER); // ENotEnabled
  abort
}
