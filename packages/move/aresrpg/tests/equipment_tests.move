// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Equipment tests: the slot ORCHESTRATION over the real extract seam (extract_for_equip → equip → confirm; unequip
/// → LockPledge re-lock) plus the adversarial floor — class-lock violation, dual same-type relic, weapon-slot
/// occupancy, non-equippable category, and the level gate. The gear-stat FOLD math (cosmetic zero-fold + exact
/// round-trip + de-center) is unit-tested directly: a statful item needs `shop::buy` (cross-package money path), so
/// the orchestration runs on statless items (fold zero) and the fold algorithm is proven on hand-built stats.
#[test_only]
module aresrpg::equipment_tests;

use aresrpg_foundation::spell;
use aresrpg_fight::participant;
use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self as catalog, Catalog},
  character::{Self, Character},
  equipment,
  extension,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  item_stats,
  item_damages::{Self, ItemDamages},
  version::{Self, Version}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{kiosk::{Self, Kiosk}, package::{Self, Publisher}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;

const ERelicDuplicate: u64 = 106;
const ESlotOccupied: u64 = 104;
const ENotEquippable: u64 = 103;
const ELevelTooLow: u64 = 109;

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot items + game ENABLED, whitelist every category the tests use, create the marketplace + character + extract
/// policies, and deposit the NS_EQUIPMENT cap into the shared registry. No GameConfig needed (equip reads only the
/// character level + the const class map).
fun setup(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  // enable the ONE package Version, whitelist every category the tests use
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"longsword".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"daggers".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"club".to_string(), &ver, sc.ctx()); // cross-class weapon for the senshi (tomoda's family)
  admin::add_category(&cap, &mut cat, b"relic".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"pet".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"tool_farmer".to_string(), &ver, sc.ctx());
  admin::add_category(&cap, &mut cat, b"resource".to_string(), &ver, sc.ctx());

  // both Displays claim a Publisher (same package) — disambiguate by module, then make the three policies
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

  ts::return_shared(ver);
  ts::return_shared(cat);
  sc.return_to_sender(cap);
}

/// Mint a SENSHI character (weapon family = longsword) locked into a fresh personal kiosk. Returns the owned kiosk
/// + cap + character id (held across txs, destroyed at the end).
fun mint_char(sc: &mut Scenario): (Kiosk, PersonalKioskCap, ID) {
  sc.next_tx(OWNER);
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

/// Author + share an ItemTemplate of `category` at `level` (category doubles as the art slug). Returns its id.
fun author(sc: &mut Scenario, category: vector<u8>, level: u16): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, category.to_string(), b"".to_string(), category.to_string(), b"icon".to_string(), category.to_string(), level,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Author + share an ItemTemplate of `category` at `level` carrying `damages` (the §17.27 wave-2a authored lines).
fun author_with_damages(sc: &mut Scenario, category: vector<u8>, level: u16, damages: vector<ItemDamages>): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, category.to_string(), b"".to_string(), category.to_string(), b"icon".to_string(), category.to_string(), level,
    option::none(), option::none(), damages, option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Mint ONE statless item from template `tid` (cap-gated mint door) and lock it into `k`. Returns the item id.
fun mint_lock(sc: &mut Scenario, k: &mut Kiosk, pkcap: &PersonalKioskCap, tid: ID): ID {
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (it, pledge) = extension::mint_item(&tmpl, &ver, sc.ctx());
  let item_id = object::id(&it);
  item::lock_in_kiosk(pledge, it, k, personal_kiosk::borrow(pkcap), &mkt);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(mkt);
  item_id
}

/// The full happy equip: extract the locked item out and place it into its slot (aborts inside on a rule violation).
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

// ╔════════════════ [ Geared combat snapshot (the fight-seat read) ] ══════════ ]

#[test]
/// `geared_combat_stats` returns the base combat scalars with the gear folded in — a statless character folds to
/// zero, so it reads the raw senshi base (class resolves, fresh level 1, full HP, 6 AP / 3 MP). A free read.
fun geared_combat_stats_reads_base_scalars() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  aresrpg::config::test_init(sc.ctx()); // geared_combat_stats needs a GameConfig (a free read — no enable required)

  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"longsword", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  sc.next_tx(OWNER);
  let cfg = sc.take_shared<aresrpg::config::GameConfig>();
  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  let (class, level, hp, max_hp, base_ap, base_mp, stats) = equipment::geared_combat_stats(chr, &cfg);
  assert_eq!(class, b"senshi".to_string());
  assert_eq!(level, 1); // fresh character (no progression block)
  assert!(hp == max_hp && max_hp > 0); // block-less ⇒ full HP
  assert_eq!(base_ap, 6); // senshi default
  assert_eq!(base_mp, 3);
  assert_eq!(spell::stat_strength(&stats), 0); // statless gear folds to zero

  ts::return_shared(cfg);
  destroy(k);
  destroy(pkcap);
  sc.end();
}

// ╔════════════════ [ §17.27 wave-2a — equipped-weapon authored damage lines reach combat ] ═ ]

#[test]
/// The unforgeable path: equipping a class weapon SNAPSHOTS the template's authored damage lines onto the item
/// instance, and the fight-seat read (`equipped_weapon_item_lines`) returns them straight off the character — no
/// template object, no client input. Two lines (fire + water) round-trip exactly.
fun equip_weapon_snapshots_authored_lines_for_combat() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let fire = item_damages::new(10, 30, b"melee".to_string(), b"fire".to_string());
  let water = item_damages::new(5, 15, b"melee".to_string(), b"water".to_string());
  let tid = author_with_damages(&mut sc, b"longsword", 1, vector[fire, water]);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  sc.next_tx(OWNER);
  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  let lines = equipment::equipped_weapon_item_lines(chr);
  assert_eq!(lines.length(), 2);
  assert_eq!(item_damages::element_id(lines.borrow(0)), spell::el_fire());
  assert_eq!(item_damages::midpoint(lines.borrow(0)), 20); // (10+30)/2
  assert_eq!(item_damages::element_id(lines.borrow(1)), spell::el_water());
  assert_eq!(item_damages::midpoint(lines.borrow(1)), 10); // (5+15)/2

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// Non-weapon slot ignored: a TOOL in the weapon slot yields NO combat lines even when its template authors damage
/// lines — the reader gates on a real weapon family (a tool has none), so a gathering tool never feeds fight damage.
fun tool_in_weapon_slot_yields_no_lines() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let dmg = item_damages::new(50, 90, b"melee".to_string(), b"fire".to_string());
  let tid = author_with_damages(&mut sc, b"tool_farmer", 1, vector[dmg]); // authored, but a tool is no weapon
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  sc.next_tx(OWNER);
  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipped_weapon_item_lines(chr).is_empty()); // the tool's damages never reach combat

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// Bare hands / un-authored weapon: no weapon (or a weapon whose template authored no lines) yields NO combat
/// lines, so the engine falls back to the family/unarmed single line — the WL_DAMAGE fallback stays alive.
fun bare_and_unauthored_weapon_yield_no_lines() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);

  // bare hands: nothing equipped
  sc.next_tx(OWNER);
  {
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(equipment::equipped_weapon_item_lines(chr).is_empty());
  };

  // a real weapon whose template authored NO damage lines ⇒ still empty (family fallback)
  let tid = author_with_damages(&mut sc, b"daggers", 1, vector[]);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);
  sc.next_tx(OWNER);
  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipped_weapon_item_lines(chr).is_empty());

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// The one-home line→combat conversion: `element_id` maps every element slug (neutral/unknown → el_none 255) and
/// `midpoint` averages the [from,to] band (the deterministic wave-2a base; wave-2b seed-rolls the band).
fun item_damage_line_converters() {
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"fire".to_string())), spell::el_fire());
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"water".to_string())), spell::el_water());
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"earth".to_string())), spell::el_earth());
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"air".to_string())), spell::el_air());
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"neutral".to_string())), spell::el_none());
  assert_eq!(item_damages::element_id(&item_damages::new(1, 3, b"".to_string(), b"bogus".to_string())), spell::el_none());
  assert_eq!(item_damages::midpoint(&item_damages::new(10, 24, b"".to_string(), b"fire".to_string())), 17); // (10+24)/2
  assert_eq!(item_damages::midpoint(&item_damages::new(7, 7, b"".to_string(), b"fire".to_string())), 7);
}

// ╔════════════════ [ Happy orchestration ] ══════════════════════════════════ ]

#[test]
/// Equipping a class weapon attaches it, records the family + item, and folds zero (statless item).
fun equip_weapon_attaches_and_reads() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"longsword", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipment_attached(chr));
  assert!(equipment::equipped_weapon(chr) == option::some(item_id));
  assert!(equipment::equipped_weapon_family(chr) == option::some(b"longsword".to_string()));
  let s = equipment::folded_stats(chr);
  assert_eq!(spell::stat_strength(&s), 0); // statless ⇒ zero fold

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// equip → unequip round-trip: the item comes back (re-locked), the weapon slot clears, the fold returns to zero.
fun equip_unequip_round_trip() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"longsword", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (item, lock) = equipment::unequip(&mut k, &pkcap, cid, item_id, &ver);
  item::lock_in_kiosk(lock, item, &mut k, personal_kiosk::borrow(&pkcap), &mkt); // FORCED personal re-lock
  assert!(k.has_item(item_id)); // back in the kiosk
  ts::return_shared(ver);
  ts::return_shared(mkt);

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipment_attached(chr)); // the map persists (empty)
  assert!(equipment::equipped_weapon(chr).is_none());
  assert_eq!(spell::stat_strength(&equipment::folded_stats(chr)), 0);

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// A pet flips the checkpoint pet flag; unequip clears it (the mount-budget input, §17.2).
fun pet_equip_flips_flag() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"pet", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  {
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
    assert!(equipment::pet_equipped(chr)); // flag ON
  };

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (item, lock) = equipment::unequip(&mut k, &pkcap, cid, item_id, &ver);
  item::lock_in_kiosk(lock, item, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(ver);
  ts::return_shared(mkt);

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(!equipment::pet_equipped(chr)); // flag OFF after unequip

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// A real gathering-tool equip enables the gather read (tool_equipped_for) and is NOT counted as a weapon.
fun tool_equip_enables_gather_read() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"tool_farmer", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid);

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::tool_equipped_for(chr, 0)); // FARMER (0) tool equipped
  assert!(!equipment::tool_equipped_for(chr, 2)); // not the MINER tool
  assert!(equipment::equipped_weapon(chr).is_none()); // a tool is not a weapon

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// Two relics of DIFFERENT type both equip (unique-per-type, not a blanket relic cap below 6).
fun two_distinct_relics_ok() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid_a = author(&mut sc, b"relic", 1);
  let tid_b = author(&mut sc, b"relic", 1);
  let a = mint_lock(&mut sc, &mut k, &pkcap, tid_a);
  let b = mint_lock(&mut sc, &mut k, &pkcap, tid_b);
  equip_item(&mut sc, &mut k, &pkcap, cid, a, tid_a);
  equip_item(&mut sc, &mut k, &pkcap, cid, b, tid_b);

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipment_attached(chr));

  destroy(k);
  destroy(pkcap);
  sc.end();
}

// ╔════════════════ [ Adversarial floor ] ════════════════════════════════════ ]

#[test]
/// UNIVERSAL WEAPONS (DECISIONS 07-12): a SENSHI equips a CLUB (tomoda's family) with NO abort — the 12-family
/// class lock is gone. The equipped family is recorded as-is (its own-class affinity is decided at fight entry).
fun cross_class_equip_succeeds() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc); // senshi (designed family longsword)
  let tid = author(&mut sc, b"club", 1); // tomoda's weapon — cross-class for the senshi
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid); // no abort — universal

  let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), cid);
  assert!(equipment::equipped_weapon(chr) == option::some(item_id));
  assert!(equipment::equipped_weapon_family(chr) == option::some(b"club".to_string())); // family recorded as-is

  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test]
/// AFFINITY DERIVATION (DECISIONS 07-12): the fight-entry check (`fight::combatant_of`) is `equipped_family ==
/// family_for_class(class)`. A senshi's designed family is longsword (MATCH ⇒ affinity); club MISMATCHES. The +10%
/// scales the SAME family line's damage & crit_damage by exactly ×110/100 and leaves crit_rate/ap_cost/reach alone.
fun affinity_derivation_and_scaling() {
  let senshi = b"senshi".to_string();
  // derivation: own family matches, a cross-class family does not
  assert!(equipment::family_for_class(senshi) == option::some(b"longsword".to_string())); // MATCH
  assert!(!(equipment::family_for_class(senshi) == option::some(b"club".to_string()))); // MISMATCH

  // a matched wielder's line is the SAME family line at +10% on the damage bases only (mismatched = the base line)
  let matched = participant::weapon_line_of(option::some(b"longsword".to_string()), true);
  let mismatched = participant::weapon_line_of(option::some(b"longsword".to_string()), false);
  assert_eq!(participant::weapon_line_damage(&matched), participant::weapon_line_damage(&mismatched) * 110 / 100);
  assert_eq!(participant::weapon_line_crit_damage(&matched), participant::weapon_line_crit_damage(&mismatched) * 110 / 100);
  assert_eq!(participant::weapon_line_crit_rate(&matched), participant::weapon_line_crit_rate(&mismatched)); // no-scale guard
  assert_eq!(participant::weapon_line_ap_cost(&matched), participant::weapon_line_ap_cost(&mismatched)); // no-scale guard
  assert_eq!(participant::weapon_line_reach(&matched), participant::weapon_line_reach(&mismatched)); // no-scale guard
}

#[test, expected_failure(abort_code = ERelicDuplicate, location = equipment)]
/// Equipping a SECOND relic of the same type (same template) aborts — unique-per-type.
fun dual_same_type_relic_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"relic", 1);
  let a = mint_lock(&mut sc, &mut k, &pkcap, tid);
  let b = mint_lock(&mut sc, &mut k, &pkcap, tid); // SAME template ⇒ same type
  equip_item(&mut sc, &mut k, &pkcap, cid, a, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, b, tid); // ERelicDuplicate
  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test, expected_failure(abort_code = ESlotOccupied, location = equipment)]
/// A second weapon into the already-full weapon slot aborts.
fun weapon_slot_occupied_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"longsword", 1);
  let a = mint_lock(&mut sc, &mut k, &pkcap, tid);
  let b = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, a, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, b, tid); // ESlotOccupied
  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test, expected_failure(abort_code = ENotEquippable, location = equipment)]
/// A non-equippable category (resource) aborts — it maps to no slot.
fun non_equippable_category_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"resource", 1);
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid); // ENotEquippable
  destroy(k);
  destroy(pkcap);
  sc.end();
}

#[test, expected_failure(abort_code = ELevelTooLow, location = equipment)]
/// An item above the character's level aborts (the equip level gate).
fun level_gate_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut k, pkcap, cid) = mint_char(&mut sc);
  let tid = author(&mut sc, b"longsword", 200); // far above the fresh character's level
  let item_id = mint_lock(&mut sc, &mut k, &pkcap, tid);
  equip_item(&mut sc, &mut k, &pkcap, cid, item_id, tid); // ELevelTooLow
  destroy(k);
  destroy(pkcap);
  sc.end();
}

// ╔════════════════ [ Gear-stat fold math (statful items need shop::buy; the algorithm is proven here) ] ═ ]

#[test]
/// A neutral (all-centered) stat block folds to zero — cosmetics/zero-stat items add nothing.
fun cosmetic_neutral_folds_zero() {
  let is = item_stats::uniform(item_stats::shift());
  let d = equipment::test_gear_delta(&is);
  assert_eq!(spell::stat_strength(&d), 0);
  assert_eq!(spell::stat_vitality(&d), 0);
  assert_eq!(spell::stat_fire_resistance(&d), 0);
  assert_eq!(spell::stat_wisdom(&d), 0);
}

#[test]
/// A +5 (above-centre) stat block de-centers to a +5 fold across the folded fields.
fun decenter_maps_positive_bonus() {
  let is = item_stats::uniform(item_stats::shift() + 5);
  let d = equipment::test_gear_delta(&is);
  assert_eq!(spell::stat_strength(&d), 5);
  assert_eq!(spell::stat_vitality(&d), 5); // ext gear field
  assert_eq!(spell::stat_air_resistance(&d), 5);
}

#[test]
/// Fold round-trip: adding then subtracting the same delta restores exactly (equip→unequip fold invariant).
fun fold_round_trip_exact() {
  let is = item_stats::uniform(item_stats::shift() + 7);
  let d = equipment::test_gear_delta(&is);
  let added = equipment::test_stats_add(&equipment::test_zero_stats(), &d);
  assert_eq!(spell::stat_strength(&added), 7);
  let back = equipment::test_stats_sub(&added, &d);
  assert_eq!(spell::stat_strength(&back), 0);
  assert_eq!(spell::stat_vitality(&back), 0);
  assert_eq!(spell::stat_wisdom(&back), 0);
}
