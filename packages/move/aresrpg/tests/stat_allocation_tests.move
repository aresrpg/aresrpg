// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// STAT-ALLOCATION spend-door tests (§3 rider): `character_link::raise_stat` turns earned STAT points (the half
/// of `points_for_level_range` that was DISCARDED before this rider) into per-stat allocations, and the allocated
/// VITALITY flows into the HP formula while the full block flows into `equipment::folded_stats` (the combat
/// consumer). Drives the REAL door off a kiosk-locked character leveled through `y12`, plus the
/// adversary matrix (spend > available, non-owner, dark, bad index, zero). Level 3 = (3−1)×5 = 10 unspent points.
#[test_only]
module aresrpg::stat_allocation_tests;

use aresrpg::{admin::{Self, AdminCap}, character_link, config::GameConfig, equipment, test_world, version::Version};
use aresrpg_foundation::{character_xp, spell};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{kiosk::{Self, Kiosk}, test_scenario::{Self as ts, Scenario}};

const OTHER: address = @0xB; // a non-owner attacker

// ── mirrored error codes (location disambiguates the aborting module) ──
const K_ENotOwner: u64 = 0; // sui::kiosk (ownership check)
const V_ENotEnabled: u64 = 102; // aresrpg::version
const EBadStat: u64 = 101; // aresrpg::character_link
const EZeroPoints: u64 = 102; // aresrpg::character_link
const ENoStatPoints: u64 = 103; // aresrpg::character_link

// ╔════════════════ [ Drivers ] ══════════════════════════════════════════════ ]

/// Grant fight xp to raise the kiosk-locked character to the stored level for `target_xp` (the REAL progression
/// door — births the block from base experience 0, exactly like the spell-level suite).
fun level_up(sc: &mut Scenario, cid: ID, target_xp: u64) {
  sc.next_tx(test_world::owner());
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  { let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid); character_link::y12(&cfg, chr, target_xp, &ver); };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

/// Call the REAL spend door as `test_world::owner()`: allocate `points` to `stat`.
fun raise(sc: &mut Scenario, cid: ID, stat: u8, points: u64) {
  sc.next_tx(test_world::owner());
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  character_link::raise_stat(&mut k, &pkcap, cid, stat, points, &ver);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

/// Boot + mint a character + level it to 3 (→ 10 unspent stat points). Returns the character id.
fun leveled_char(sc: &mut Scenario): ID {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, test_world::owner());
  level_up(sc, cid, character_xp::xp_for_level(3));
  cid
}

// ╔════════════════ [ Happy path ] ═══════════════════════════════════════════ ]

#[test]
/// Allocate 5 points to vitality: the stat total rises to 5, spent rises to 5, and the derived unspent drops from
/// 10 to 5. Proves the earned stat half (previously discarded) is now spendable + conserved.
fun raise_allocates_and_debits_unspent() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  sc.next_tx(test_world::owner());
  { let k = sc.take_shared<Kiosk>(); let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::unspent_stat_points(chr), 10); // (3−1)×5
    ts::return_shared(k); sc.return_to_sender(pkcap); };

  raise(&mut sc, cid, character_link::stat_vitality(), 5);

  sc.next_tx(test_world::owner());
  { let k = sc.take_shared<Kiosk>(); let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::stat_allocated(chr, character_link::stat_vitality()), 5);
    assert_eq!(character_link::stat_points_spent(chr), 5);
    assert_eq!(character_link::unspent_stat_points(chr), 5); // 10 − 5
    ts::return_shared(k); sc.return_to_sender(pkcap); };
  sc.end();
}

#[test]
/// Spread points across MULTIPLE stats in separate calls (PTB-first): 3 to strength, 4 to agility. Each stat holds
/// its own total, spent sums to 7, unspent drops to 3 — no cross-stat leakage.
fun raise_multiple_stats_across_calls() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  raise(&mut sc, cid, character_link::stat_strength(), 3);
  raise(&mut sc, cid, character_link::stat_agility(), 4);

  sc.next_tx(test_world::owner());
  { let k = sc.take_shared<Kiosk>(); let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::stat_allocated(chr, character_link::stat_strength()), 3);
    assert_eq!(character_link::stat_allocated(chr, character_link::stat_agility()), 4);
    assert_eq!(character_link::stat_allocated(chr, character_link::stat_vitality()), 0); // untouched
    assert_eq!(character_link::stat_points_spent(chr), 7);
    assert_eq!(character_link::unspent_stat_points(chr), 3); // 10 − 7
    ts::return_shared(k); sc.return_to_sender(pkcap); };
  sc.end();
}

// ╔════════════════ [ Wiring — vitality → HP, full block → combat ] ══════════ ]

#[test]
/// Allocated VITALITY raises the character's max HP by exactly the allocated amount (max_hp = base + growth +
/// vitality, ANNEX §4c). Reads the REAL `combat_stats` max-HP before and after — proves the hardcoded-0 sites are
/// now vitality-aware.
fun vitality_raises_max_hp() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  let max_hp0 = read_max_hp(&mut sc, cid);
  raise(&mut sc, cid, character_link::stat_vitality(), 10);
  let max_hp1 = read_max_hp(&mut sc, cid);
  assert_eq!(max_hp1, max_hp0 + 10);
  sc.end();
}

fun read_max_hp(sc: &mut Scenario, cid: ID): u64 {
  sc.next_tx(test_world::owner());
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
  let (_c, _l, _hp, max_hp, _ap, _mp) = character_link::combat_stats(chr, &cfg);
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg);
  max_hp
}

#[test]
/// The allocated block flows into `equipment::folded_stats` (the combat consumer feeding §17.27 damage): 6 to
/// strength + 2 to wisdom show up in the folded combat block, un-geared. Un-allocated fields stay 0.
fun allocated_stats_flow_into_combat_block() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  raise(&mut sc, cid, character_link::stat_strength(), 6);
  raise(&mut sc, cid, character_link::stat_wisdom(), 2);

  sc.next_tx(test_world::owner());
  { let k = sc.take_shared<Kiosk>(); let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    let stats = equipment::folded_stats(chr);
    assert_eq!(spell::stat_strength(&stats), 6);
    assert_eq!(spell::stat_wisdom(&stats), 2);
    assert_eq!(spell::stat_intelligence(&stats), 0); // untouched
    ts::return_shared(k); sc.return_to_sender(pkcap); };
  sc.end();
}

// ╔════════════════ [ Adversary matrix ] ═════════════════════════════════════ ]

#[test, expected_failure(abort_code = ENoStatPoints, location = aresrpg::character_link)]
/// Spend MORE than the derived unspent (11 > 10) → ENoStatPoints, no partial write (the tx reverts).
fun spend_more_than_available_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  raise(&mut sc, cid, character_link::stat_vitality(), 11); // only 10 available
  abort
}

#[test, expected_failure(abort_code = K_ENotOwner, location = sui::kiosk)]
/// A NON-OWNER cannot allocate another player's points: the personal-kiosk cap gate (`kiosk::borrow_mut`) aborts
/// ENotOwner when the attacker's cap does not match the character's kiosk.
fun non_owner_cannot_raise() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  sc.next_tx(OTHER);
  let (mut kb, kcapb) = kiosk::new(sc.ctx());
  let pkcap_b = personal_kiosk::new(&mut kb, kcapb, sc.ctx()); // the attacker's OWN cap (for kb, a fresh kiosk — not the shared one below)
  let mut k_owner = sc.take_shared<Kiosk>(); // the only shared kiosk — owned by OWNER
  let ver = sc.take_shared<Version>();
  character_link::raise_stat(&mut k_owner, &pkcap_b, cid, character_link::stat_vitality(), 1, &ver); // ENotOwner
  ts::return_shared(k_owner); ts::return_shared(ver);
  personal_kiosk::transfer_to_sender(pkcap_b, sc.ctx());
  transfer::public_share_object(kb);
  sc.end();
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = aresrpg::version)]
/// Emergency stop freezes the value path: with the package dark, `raise_stat` aborts on `assert_enabled`.
fun raise_while_dark_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  sc.next_tx(test_world::owner());
  { let cap = sc.take_from_sender<AdminCap>(); let mut ver = sc.take_shared<Version>();
    admin::admin_set_enabled(&cap, &mut ver, false, sc.ctx()); // dark
    ts::return_shared(ver); sc.return_to_sender(cap); };
  raise(&mut sc, cid, character_link::stat_vitality(), 1); // V_ENotEnabled
  abort
}

#[test, expected_failure(abort_code = EBadStat, location = aresrpg::character_link)]
/// A stat index at/above the §3 stat count is refused (no phantom stat slot).
fun bad_stat_index_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  raise(&mut sc, cid, character_link::stat_count(), 1); // stat == COUNT is out of range
  abort
}

#[test, expected_failure(abort_code = EZeroPoints, location = aresrpg::character_link)]
/// A zero-point allocation is refused (a raise must move at least 1 point).
fun zero_points_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let cid = leveled_char(&mut sc);
  raise(&mut sc, cid, character_link::stat_vitality(), 0); // EZeroPoints
  abort
}
