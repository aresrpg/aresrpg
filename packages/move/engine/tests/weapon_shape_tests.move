// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// §387 THE WEAPON SHAPE SYSTEM (Move half of the twin). A weapon strike resolves a CATEGORY-SHAPED CELL SET, not a
/// single cell: every living enemy on a shape cell takes the hit, oriented by the attacker→target axis. This suite
/// pins (a) the pure category→shape table + the authorable-AP builder, and (b) the multi-target resolution over the
/// real fight — the on-chain mirror of `@aresrpg/sim`'s `get_aoe_cells` derivation and the parity fixtures.
/// RED-FIRST: before §387 a strike hit exactly one cell (the aimed mob) for every category; the arc/podium
/// assertions below fail against that resolver.
#[test_only]
module aresrpg_fight::weapon_shape_tests;

use aresrpg_fight::{actions, fight::{Self, Fight}, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{create_fight_group, mk_clock, stand_up};
use aresrpg_foundation::{spell_effect, spell, combat_grid};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;

// Board is row-major cell = y*20 + x. The attacker sits at 100 = (0,5) and strikes EAST at the aimed cell
// 101 = (1,5). The east-strike geometry: the "beyond" stem is 102 = (2,5); the perpendicular arc is 81 = (1,4)
// and 121 = (1,6).
const A_CELL: u64 = 100; // attacker (0,5)
const AIM: u64 = 101; // aimed cell (1,5)
const BEYOND: u64 = 102; // one cell past the aim, along the axis (2,5)
const PERP_N: u64 = 81; // perpendicular (1,4)
const PERP_S: u64 = 121; // perpendicular (1,6)
const OFF: u64 = 60; // (0,3) — nowhere near any shape cell

// ── pure table + authorable AP (no fight) ────────────────────────────────────────────────────────────────────

#[test]
fun shape_table_maps_every_ruled_category() {
  // POINT 0 · LINE 3 · TBAR 4 · PODIUM 8
  assert_shape(&opt(b"sword"), spell_effect::shape_point(), 0, false, false); // 1-cell (in-table? no → default)
  assert_shape(&opt(b"club"), spell_effect::shape_line(), 1, false, false); // 2-inline
  assert_shape(&opt(b"longsword"), spell_effect::shape_line(), 1, false, false);
  assert_shape(&opt(b"scythe"), spell_effect::shape_tbar(), 1, false, false); // 3-front-arc
  assert_shape(&opt(b"staff"), spell_effect::shape_tbar(), 1, false, false);
  assert_shape(&opt(b"spear"), spell_effect::shape_tbar(), 1, false, false);
  assert_shape(&opt(b"battleaxe"), spell_effect::shape_podium(), 1, false, false); // podium-4
  assert_shape(&opt(b"mace"), spell_effect::shape_podium(), 1, false, false);
  assert_shape(&opt(b"hammer"), spell_effect::shape_podium(), 1, false, false);
  assert_shape(&opt(b"bow"), spell_effect::shape_point(), 0, true, false); // ranged, MODIFIABLE
  assert_shape(&opt(b"wand"), spell_effect::shape_point(), 0, false, false); // ranged, fixed
  assert_shape(&opt(b"spellbook"), spell_effect::shape_point(), 0, false, true); // line-only aim
  // tool / bare hands / unknown ⇒ the 1-cell default
  assert_shape(&option::none(), spell_effect::shape_point(), 0, false, false);
  assert_shape(&opt(b"tool_miner"), spell_effect::shape_point(), 0, false, false);
}

#[test]
/// Wave-D — the RESOLVED strike shape (`weapon_shape_resolved`): an authored per-line shape OVERRIDE wins over the
/// category table; the sentinel (255) falls through BYTE-IDENTICALLY. RED-FIRST where behavior changes: the
/// fall-through cases must equal today's `weapon_shape_of` output exactly. The override's resolved (shape,size)
/// drives the SAME 9-cell CROSS/2 set the sim resolves (the shared parity vector — twin of weapon_shapes.test.js).
fun line_shape_override_wins_and_sentinel_falls_through() {
  // OVERRIDE — a line authoring SHAPE_CROSS size 2 (via new_weapon_line_shaped) resolves to that shape, NOT the
  // category; range_modifiable / line_only still come from the category (bare hands here → both false).
  let override_lines = vector[
    participant::new_weapon_line_shaped(spell::el_fire(), 30, 30, 45, 45, spell_effect::shape_cross(), 2),
  ];
  let (s, sz, m, l) = participant::weapon_shape_resolved(&override_lines, &option::none());
  assert!(s == spell_effect::shape_cross() && sz == 2 && !m && !l, 0);
  // SENTINEL — a plain line (area_shape = 255) falls through to the category table BYTE-IDENTICALLY (battleaxe → podium).
  let plain_lines = vector[participant::new_weapon_line(spell::el_fire(), 30, 45)];
  let (rs, rsz, rm, rl) = participant::weapon_shape_resolved(&plain_lines, &opt(b"battleaxe"));
  let (cs, csz, cm, cl) = participant::weapon_shape_of(&opt(b"battleaxe"));
  assert!(rs == cs && rsz == csz && rm == cm && rl == cl, 1); // exactly today's output
  assert!(rs == spell_effect::shape_podium() && rsz == 1, 2);
  // Empty lines (bare hands / family fallback) carry no override → the category table, unchanged.
  let (es, esz, _, _) = participant::weapon_shape_resolved(&vector[], &option::none());
  assert!(es == spell_effect::shape_point() && esz == 0, 3);
  // The resolved override drives the SAME 9-cell CROSS/2 set the sim resolves (shared vector; anchor cell 105 = (5,5)).
  let cells = combat_grid::zone_cells(s, sz, 105, 100);
  assert!(cells == vector[65, 85, 103, 104, 105, 106, 107, 125, 145], 4);
}

#[test]
fun authorable_ap_overrides_with_family_fallback() {
  // no override ⇒ the family constant (longsword WL_AP_COST = 4)
  let fam = participant::weapon_line_of_authored(opt(b"longsword"), false, option::none());
  assert!(participant::weapon_snapshot_ap_cost(&fam) == 4, 0);
  // an authored override ⇒ that AP, family mechanics otherwise unchanged (reach stays longsword = 1)
  let authored = participant::weapon_line_of_authored(opt(b"longsword"), false, option::some(2));
  assert!(participant::weapon_snapshot_ap_cost(&authored) == 2, 1);
  assert!(participant::weapon_snapshot_reach(&authored) == 1, 2);
}

// ── multi-target resolution over the real fight ──────────────────────────────────────────────────────────────

#[test]
/// FRONT-ARC (spear): the aimed mob AND both perpendicular mobs take the hit; the mob one cell BEYOND the aim
/// (off the arc) is untouched. RED against the pre-§387 single-cell strike.
fun front_arc_hits_target_and_both_perpendiculars_only() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_group_fight(&mut sc, 4);
  // aim mob + the two arc mobs + a mob one cell BEYOND (not in the front arc)
  place_mob(&mut fight, 0, AIM);
  place_mob(&mut fight, 1, PERP_N);
  place_mob(&mut fight, 2, PERP_S);
  place_mob(&mut fight, 3, BEYOND);
  fight::attach_weapon_category(&mut fight, 0, opt(b"spear"));
  strike(&mut fight, &ver, AIM);
  assert!(hurt(&fight, 0), 0); // aimed
  assert!(hurt(&fight, 1), 1); // perpendicular
  assert!(hurt(&fight, 2), 2); // perpendicular
  assert!(!hurt(&fight, 3), 3); // beyond the arc — NOT hit
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// PODIUM (mace): the front arc PLUS the cell beyond the aim — 4 cells, so the BEYOND mob the arc missed is now hit.
fun podium_hits_the_arc_plus_the_cell_beyond() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_group_fight(&mut sc, 4);
  place_mob(&mut fight, 0, AIM);
  place_mob(&mut fight, 1, PERP_N);
  place_mob(&mut fight, 2, BEYOND);
  place_mob(&mut fight, 3, OFF); // far away — never in any shape
  fight::attach_weapon_category(&mut fight, 0, opt(b"mace"));
  strike(&mut fight, &ver, AIM);
  assert!(hurt(&fight, 0), 0); // aimed
  assert!(hurt(&fight, 1), 1); // perpendicular arc
  assert!(hurt(&fight, 2), 2); // beyond — the podium stem
  assert!(!hurt(&fight, 3), 3); // off-shape
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// DEFAULT (no authored category — a tool / bare hands / sword): the strike resolves EXACTLY one cell, the aimed
/// mob, exactly as it did before §387. This is the backward-compat guarantee an un-authored weapon keeps.
fun default_category_hits_only_the_aimed_cell() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_group_fight(&mut sc, 3);
  place_mob(&mut fight, 0, AIM);
  place_mob(&mut fight, 1, PERP_N);
  place_mob(&mut fight, 2, BEYOND);
  // no attach_weapon_category ⇒ category none ⇒ POINT
  strike(&mut fight, &ver, AIM);
  assert!(hurt(&fight, 0), 0); // aimed only
  assert!(!hurt(&fight, 1), 1);
  assert!(!hurt(&fight, 2), 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

fun opt(b: vector<u8>): Option<std::string::String> { option::some(b.to_string()) }

fun assert_shape(cat: &Option<std::string::String>, shape: u8, size: u64, modifiable: bool, line: bool) {
  let (s, sz, m, l) = participant::weapon_shape_of(cat);
  assert!(s == shape && sz == size && m == modifiable && l == line, 99);
}

/// A PvM group fight with `n` mobs (high hp so nobody dies mid-strike), the creator placed → ACTIVE at A_CELL.
fun active_group_fight(sc: &mut Scenario, n: u16): (Fight, Version) {
  stand_up(sc);
  create_fight_group(sc, 500, 1, 1000, n);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), A_CELL);
  (fight, ver)
}

fun place_mob(fight: &mut Fight, idx: u64, cell: u64) {
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(idx), cell);
}

fun strike(fight: &mut Fight, ver: &Version, target: u64) {
  actions::weapon_for_testing(fight, object::id_from_address(CHAR), target, ver, 1000, OWNER);
}

/// Did mob `idx` lose HP (created at 500)?
fun hurt(fight: &Fight, idx: u64): bool { mob::hp(fight::mobs(fight).borrow(idx)) < 500 }
