// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// §17.27 wave-2a — the equipped-weapon damage LINES resolution (killing the WL_DAMAGE-as-combat-truth shim). A
/// seat's authored item lines (attached at seat time) drive `act_weapon`: each line is amplified by the caster's
/// element-primary stat then resisted by the TARGET's per-element resist and SUMMED (the multi-element-spell rule).
/// With NO lines the strike falls back to the seated `Weapon` single line — the EXACT pre-upgrade path, so a fight
/// created before this upgrade (no `WeaponLinesKey` DF) resolves byte-identically. All stats plain (all-zero) so
/// `final_damage(base, el, 0, 0) == base` and crit_rate 0 kills crit — the asserts are exact, not ranges.
#[test_only]
module aresrpg_fight::weapon_lines_tests;

use aresrpg_fight::{fight::{Self, Fight}, participant::{Self, Weapon, WeaponLine}, mob, turns, actions, version::Version, fight_scaffold::{stand_up, mk_clock, tsreg}};
use aresrpg_foundation::{spell, spell_formula};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0; // must match fight_scaffold (place/act auth is against these)
const WORLD: address = @0x704D;
const LOOT: address = @0x100;
const BASE_HP: u64 = 500; // >> any test damage so the remaining HP never floors at 0 (exact asserts)

/// Seat a solo fight (creator CHAR with `caster` stats + weapon `w`), attach `lines` to seat 0, place, stand the
/// fighter adjacent to the mob (cells 100/101, the scaffold's proven-valid pair), STRIKE, and return the mob's
/// remaining HP. Empty `lines` ⇒ no DF ⇒ the seated-`Weapon` fallback (the pre-upgrade path).
fun strike_remaining(sc: &mut Scenario, caster: spell::Stats, mob_st: spell::Stats, w: Weapon, lines: vector<WeaponLine>): u64 {
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let ver = sc.take_shared<Version>();
  let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
  let spec = mob::new_mob_spec(1, 1, BASE_HP, 0, 0, mob_st, vector[], 100, loot);
  let clock0 = mk_clock(sc, 1000);
  let creator = participant::new_combatant(object::id_from_address(CHAR), b"senshi".to_string(), 1, caster, 100, 100, 6, 3, w, sui::vec_map::empty());
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), 700, 12345, 100, 200, 0, true, option::none(), &spec, 1, creator, &ver, &clock0, sc.ctx());
  clock::destroy_for_testing(clock0);
  ts::return_shared(registry);
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock1 = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock1, OWNER);
  fight::attach_weapon_lines(&mut fight, 0, lines); // wave-2a: empty ⇒ single-line fallback
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101); // Manhattan 1, clear LOS
  actions::act_weapon(&mut fight, object::id_from_address(CHAR), 101, &ver, &clock1, sc.ctx());
  let remaining = mob::hp(fight::mobs(&fight).borrow(0));
  clock::destroy_for_testing(clock1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  remaining
}

fun fire_weapon(): Weapon { participant::new_weapon(spell::el_fire(), 999, 999, 0, 3, 40) } // huge base: if the fallback ever leaks, the assert screams

// ── armed strike uses the ITEM lines, per element, summed — the fallback base 999 is NEVER read ──
#[test]
fun armed_strike_sums_lines_per_element() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  // fire 30 + water 20, both vs a zero-resist bag ⇒ 30 + 20 = 50 (the 999 family base proves lines override it).
  let lines = vector[participant::new_weapon_line(spell::el_fire(), 30, 45), participant::new_weapon_line(spell::el_water(), 20, 30)];
  let remaining = strike_remaining(&mut sc, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), fire_weapon(), lines);
  assert!(remaining == BASE_HP - 50, 0);
  sc.end();
}

// ── each line is resisted by the TARGET's OWN element resist (fire halved, water untouched) ──
#[test]
fun armed_strike_resists_each_line_by_its_element() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mob_st = spell::new_stats(0,0,0,0,0,0,0, 50, 0, 0, 0); // 50% FIRE resist only
  let lines = vector[participant::new_weapon_line(spell::el_fire(), 30, 45), participant::new_weapon_line(spell::el_water(), 20, 30)];
  let remaining = strike_remaining(&mut sc, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), mob_st, fire_weapon(), lines);
  // fire 30 → 50% resist → 15 ; water 20 → 0% resist → 20 ; total 35.
  assert!(remaining == BASE_HP - 35, 0);
  sc.end();
}

// ── each line is amplified by the CASTER's element-primary stat (int→fire, chance→water) ──
#[test]
fun armed_strike_amplifies_each_line_by_element_primary() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let caster = spell::new_stats(0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0); // intelligence 100 (fire primary)
  let lines = vector[participant::new_weapon_line(spell::el_fire(), 30, 45), participant::new_weapon_line(spell::el_water(), 20, 30)];
  let remaining = strike_remaining(&mut sc, caster, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), fire_weapon(), lines);
  // fire 30 × (100+100)/100 = 60 ; water 20 (chance 0) = 20 ; total 80.
  assert!(remaining == BASE_HP - 80, 0);
  sc.end();
}

// ── a SINGLE authored line replaces the family base AND its element (earth-12 item on a fire-999 weapon) ──
#[test]
fun single_line_replaces_family_base_and_element() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mob_st = spell::new_stats(0,0,0,0,0,0,0, 0, 0, 50, 0); // 50% EARTH resist only (the SPEC resist cap); fire 0%
  let lines = vector[participant::new_weapon_line(spell::el_earth(), 40, 60)];
  let remaining = strike_remaining(&mut sc, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), mob_st, fire_weapon(), lines);
  // earth 40 → 50% EARTH resist → 20. NOT 999 (family base overridden), NOT unresisted (would be fire → 40).
  assert!(remaining == BASE_HP - 20, 0);
  sc.end();
}

// ── NO lines ⇒ the seated Weapon single line (the EXACT pre-upgrade path — upgrade-compat) ──
#[test]
fun no_lines_falls_back_to_seated_weapon() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let w = participant::new_weapon(spell::el_earth(), 42, 63, 0, 3, 40); // crit_rate 0 ⇒ base 42
  let remaining = strike_remaining(&mut sc, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), w, vector[]);
  assert!(remaining == BASE_HP - 42, 0); // exactly the seated single line — the WL_DAMAGE fallback still works
  sc.end();
}

// ── ONE crit boolean swaps EVERY line to its crit base (crit swaps the whole strike, like a spell's effect list) ──
#[test]
fun crit_swaps_all_lines() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let w = participant::new_weapon(spell::el_fire(), 0, 0, 2, 3, 40); // crit_rate 2 (50%); base 0 detects any fallback leak
  let lines = vector[participant::new_weapon_line(spell::el_fire(), 30, 45), participant::new_weapon_line(spell::el_water(), 20, 60)];

  sc.next_tx(OWNER);
  let mut registry = tsreg(&mut sc);
  let ver = sc.take_shared<Version>();
  let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
  let spec = mob::new_mob_spec(1, 1, BASE_HP, 0, 0, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), vector[], 100, loot);
  let clock0 = mk_clock(&mut sc, 1000);
  let creator = participant::new_combatant(object::id_from_address(CHAR), b"senshi".to_string(), 1, spell::new_stats(0,0,0,0,0,0,0,0,0,0,0), 100, 100, 6, 3, w, sui::vec_map::empty());
  fight::create_for_testing(&mut registry, object::id_from_address(WORLD), 701, 12345, 100, 200, 0, true, option::none(), &spec, 1, creator, &ver, &clock0, sc.ctx());
  clock::destroy_for_testing(clock0);
  ts::return_shared(registry);
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock1 = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock1, OWNER);
  fight::attach_weapon_lines(&mut fight, 0, lines);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  // the slot-0 crit is deterministic from the fight's public turn seed — read it the SAME way the resolver does.
  let is_crit = spell_formula::crit_at(spell_formula::slot_crit_roll(fight::turn_seed_for_testing(&fight, 0), 0), 2, 0);
  let expected = if (is_crit) 45 + 60 else 30 + 20; // BOTH lines swap together
  actions::act_weapon(&mut fight, object::id_from_address(CHAR), 101, &ver, &clock1, sc.ctx());
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == BASE_HP - expected, 0);
  clock::destroy_for_testing(clock1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
