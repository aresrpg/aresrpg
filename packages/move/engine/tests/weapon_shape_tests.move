// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// §387 — WEAPON ATTACK SHAPES per FINE category, the CHAIN twin's half of the parity fixture.
///
/// THE REPORTED DIMENSION: a weapon strike resolved ONE cell whatever was equipped. These tests VARY THE
/// CATEGORY over the real `cast::weapon_strike` door — a staff must leave three mobs hurt where a sword leaves
/// two of them untouched — so a point-only resolver fails them. Nothing here asserts that a table exists.
///
/// The vectors are `packages/sim/test/fixtures/weapon_shapes.json` verbatim (Move cannot read JSON, so the same
/// numbers are transcribed here and the JS twin asserts the file directly):
///   attacker 105 = (5,5) · aimed 106 = (6,5) · beyond 107 · arc 86 / 126 · strike axis +x
#[test_only]
module aresrpg_fight::weapon_shape_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob, participant, version::Version};
use aresrpg_fight::fight_scaffold::{bag_spec, combatant_weapon, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{combat_grid, spell, spell_effect};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;

// The fixture's geometry, transcribed (see the module doc).
const CASTER: u64 = 105;
const ANCHOR: u64 = 106;
const BEYOND: u64 = 107;
const ARC_A: u64 = 126;
const ARC_B: u64 = 86;
const OFF_ZONE: u64 = 146; // (6,7) — two cells down the perpendicular: in NO ruled weapon zone.
const FAR: u64 = 112; // (12,5) — distance 7 on the strike axis: past a bow's own reach, inside its EXTENDED band.

const MOB_HP: u64 = 1000; // survives every swing, so "took damage" stays a readable HP delta

/// A fight seating a creator wielding `family`, with `mobs` punching bags — the REAL create door.
fun fight_with(sc: &mut Scenario, family: vector<u8>, mobs: u16): (Fight, Version) {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(MOB_HP);
  let clock = mk_clock(sc, 1000);
  let weapon = participant::weapon_line_of(option::some(family.to_string()), false);
  fight::create_for_testing(
    &mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(),
    &spec, mobs, combatant_weapon(CHAR, 100, weapon), &ver, &clock, sc.ctx(),
  );
  sui::clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  (fight, ver)
}

/// Stand the seat at `CASTER` with a full AP bar and park mob `i` on `cells[i]`.
fun place(fight: &mut Fight, cells: vector<u64>) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), CASTER);
  participant::begin_turn(fight::participants_mut(fight).borrow_mut(0), 0, 0, 0, 0);
  let mut i = 0;
  while (i < cells.length()) {
    mob::set_cell(fight::mobs_mut(fight).borrow_mut(i), cells[i]);
    i = i + 1;
  };
}

fun hp(fight: &Fight, idx: u64): u64 { mob::hp(fight::mobs(fight).borrow(idx)) }

/// A stat line carrying nothing but `range` — the only stat a weapon BAND can read.
fun range_stats(range: u64): spell::Stats { spell::new_stats(0, 0, 0, 0, 0, 0, range, 0, 0, 0, 0) }

// ╔══════════ [ the ZONE KINDS — the same geometry engine, the fixture's cell sets ] ══════════ ]

#[test]
fun zone_kinds_draw_the_fixture_cell_sets() {
  // single — POINT/0
  assert!(combat_grid::zone_cells(spell_effect::shape_point(), 0, ANCHOR, CASTER) == vector[ANCHOR], 0);
  // line_inline_2 — LINE/1
  assert!(combat_grid::zone_cells(spell_effect::shape_line(), 1, ANCHOR, CASTER) == vector[ANCHOR, BEYOND], 1);
  // line_perp_3 — TBAR/1
  let tbar = combat_grid::zone_cells(spell_effect::shape_tbar(), 1, ANCHOR, CASTER);
  assert!(tbar.length() == 3 && tbar.contains(&ANCHOR) && tbar.contains(&ARC_A) && tbar.contains(&ARC_B), 2);
  // podium_4 — PODIUM/1: the arc PLUS the cell beyond
  let podium = combat_grid::zone_cells(spell_effect::shape_podium(), 1, ANCHOR, CASTER);
  assert!(podium.length() == 4 && podium.contains(&BEYOND), 3);
  // cross_1 — CROSS/1: the radius-1 diamond, 5 cells (the attacker's own cell included)
  let cross = combat_grid::zone_cells(spell_effect::shape_cross(), 1, ANCHOR, CASTER);
  assert!(cross.length() == 5 && cross.contains(&CASTER) && cross.contains(&BEYOND), 4);
  // and none of them ever reaches the off-zone cell
  assert!(!tbar.contains(&OFF_ZONE) && !podium.contains(&OFF_ZONE) && !cross.contains(&OFF_ZONE), 5);
}

// ╔══════════ [ the STRIKE — the category decides who gets hurt ] ══════════ ]

#[test]
/// The dimension red: a STAFF (line_perp_3) hurts all three mobs on the front arc in ONE swing.
fun staff_strike_hits_the_whole_front_arc() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"staff", 3);
  place(&mut fight, vector[ANCHOR, ARC_A, ARC_B]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0); // the aimed mob
  assert!(hp(&fight, 1) < MOB_HP, 1); // the arc, one side
  assert!(hp(&fight, 2) < MOB_HP, 2); // the arc, the other side
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The negative control on the SAME board: a SWORD (single) leaves both arc mobs untouched. Without this the
/// test above would pass on any resolver that widened every weapon.
fun sword_strike_leaves_the_arc_untouched() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"sword", 3);
  place(&mut fight, vector[ANCHOR, ARC_A, ARC_B]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) == MOB_HP, 1);
  assert!(hp(&fight, 2) == MOB_HP, 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// A BATTLEAXE (podium_4) reaches the arc AND the cell beyond the target — four cells, one swing.
fun battleaxe_strike_reaches_the_podium_including_the_cell_beyond() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"battleaxe", 4);
  place(&mut fight, vector[ANCHOR, ARC_A, ARC_B, BEYOND]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) < MOB_HP, 1);
  assert!(hp(&fight, 2) < MOB_HP, 2);
  assert!(hp(&fight, 3) < MOB_HP, 3); // the podium's forward stem — a TBAR would miss this one
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// A CLUB (line_inline_2) thrusts THROUGH the target: the cell beyond takes the hit, the arc does not.
fun club_strike_runs_inline_not_across() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"club", 3);
  place(&mut fight, vector[ANCHOR, BEYOND, ARC_A]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) < MOB_HP, 1); // inline, beyond the target
  assert!(hp(&fight, 2) == MOB_HP, 2); // the perpendicular arc is NOT a club's zone
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// No zone ever splashes outside itself: a staff's arc stops at half-length 1.
fun a_zone_never_reaches_past_its_own_size() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"staff", 2);
  place(&mut fight, vector[ANCHOR, OFF_ZONE]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) == MOB_HP, 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔══════════ [ the DOOR — authored data outranks the category default ] ══════════ ]

#[test]
/// The published-data door: an authored `WeaponLine` carrying its own `(area_shape, area_size)` overrides the
/// category. A DAGGER line authored `podium_4` strikes the podium — the engine reads the data, not the name.
fun an_authored_line_zone_overrides_the_category_default() {
  let lines = vector[participant::new_weapon_line_shaped(2, 10, 10, 15, 15, spell_effect::shape_podium(), 1)];
  let (shape, size) = participant::weapon_strike_zone(&lines, &b"daggers".to_string());
  assert!(shape == spell_effect::shape_podium() && size == 1, 0);
  // …and with NO override the same line falls through to the category's own zone.
  let plain = vector[participant::new_weapon_line(2, 10, 15)];
  let (dagger_shape, _) = participant::weapon_strike_zone(&plain, &b"daggers".to_string());
  let (staff_shape, staff_size) = participant::weapon_strike_zone(&plain, &b"staff".to_string());
  assert!(dagger_shape == spell_effect::shape_point(), 1);
  assert!(staff_shape == spell_effect::shape_tbar() && staff_size == 1, 2);
}

#[test]
/// An un-authored / unknown category can never resolve wider than a pre-§387 strike.
fun an_unknown_category_stays_a_single_cell() {
  let none = vector[];
  let (shape, size) = participant::weapon_strike_zone(&none, &b"".to_string());
  assert!(shape == spell_effect::shape_point() && size == 0, 0);
  let (tool_shape, _) = participant::weapon_strike_zone(&none, &b"tool_miner".to_string());
  assert!(tool_shape == spell_effect::shape_point(), 1);
}

#[test]
/// The RANGE BAND rides the category too: only the bow's band grows with the caster's range stat, and only the
/// spellbook must be aimed along a straight line.
fun the_range_band_rides_the_category() {
  let (_, _, bow_min, bow_mod, bow_line) = participant::weapon_zone_of(&b"bow".to_string());
  let (_, _, wand_min, wand_mod, _) = participant::weapon_zone_of(&b"wand".to_string());
  let (_, _, book_min, book_mod, book_line) = participant::weapon_zone_of(&b"spellbook".to_string());
  let bow = participant::weapon_line_of(option::some(b"bow".to_string()), false);
  let book = participant::weapon_line_of(option::some(b"spellbook".to_string()), false);
  assert!(bow_min == 2 && bow_mod && !bow_line, 0); // §387 leg ① — the ruled 1.29 floor, not the melee 1
  assert!(wand_min == 2 && !wand_mod, 1); // the wand carries the SAME floor, and no stat ever moves its band
  assert!(book_min == 1 && !book_mod && book_line, 2); // the spellbook keeps the melee floor — the floor is a
  // per-category ruling, not a "ranged" blanket, so a category that did not move proves the others moved.
  let bow_reach = participant::weapon_line_reach(&bow);
  let book_reach = participant::weapon_line_reach(&book);
  assert!(bow_reach == 6 && book_reach == 5, bow_reach * 100 + book_reach);
  // The linearity gate itself: same row / same column only.
  assert!(combat_grid::same_line(CASTER, ANCHOR), 3);
  assert!(combat_grid::same_line(CASTER, CASTER + 20), 4);
  assert!(!combat_grid::same_line(CASTER, ANCHOR + 20), 5);
}

#[test]
#[expected_failure(abort_code = cast::EIllegalCast)]
/// §387 leg ① — the BAND FLOOR, driven: a BOW refuses a mob standing point-blank (distance 1, inside the ruled
/// minimum 2). The same `d >= range_min` door the ceiling already rides — a floor of 1 lets this swing land.
fun a_bow_cannot_strike_inside_its_minimum_range() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"bow", 1);
  place(&mut fight, vector[ANCHOR]); // (6,5) — adjacent to the archer: in reach, INSIDE the minimum
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The positive control on the same board: AT the minimum the bow strikes normally. Without this, the refusal
/// above would also pass on a bow that could not strike at all.
fun a_bow_strikes_at_its_minimum_range() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"bow", 1);
  place(&mut fight, vector[BEYOND]); // (7,5) — distance 2, the floor itself
  cast::weapon_strike(&mut fight, 0, BEYOND);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔══════════ [ §387 leg ② — the five zone-only categories, now DRIVEN through the real door ] ══════════ ]

#[test]
/// A HAMMER strikes its PODIUM. Until it carried an attack line it resolved BARE HANDS — and bare hands are
/// `single`, so the zone table's hammer row was inert on every real board. This is that row, driven.
fun a_hammer_strikes_its_podium_instead_of_fighting_bare_handed() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"hammer", 4);
  place(&mut fight, vector[ANCHOR, ARC_A, ARC_B, BEYOND]);
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) < MOB_HP, 1);
  assert!(hp(&fight, 2) < MOB_HP, 2);
  assert!(hp(&fight, 3) < MOB_HP, 3);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The WAND's own band, driven — the assert that used to stand in on the spellbook. Its reach is 2 and its
/// floor is 2, so its one legal distance is exactly 2: bare hands (reach 1) cannot make this swing land.
fun a_wand_strikes_at_its_own_band() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"wand", 1);
  place(&mut fight, vector[BEYOND]); // (7,5) — distance 2: the wand's floor AND its ceiling
  cast::weapon_strike(&mut fight, 0, BEYOND);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
#[expected_failure(abort_code = cast::EIllegalCast)]
/// …and the wand refuses point-blank exactly as the bow does — the floor is the category's, not the bow's.
fun a_wand_cannot_strike_inside_its_minimum_range() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"wand", 1);
  place(&mut fight, vector[ANCHOR]); // (6,5) — distance 1, inside the ruled minimum 2
  cast::weapon_strike(&mut fight, 0, ANCHOR);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
#[expected_failure(abort_code = cast::EIllegalCast)]
/// NON-MODIFIABILITY, driven on the wand itself: a caster carrying +3 range still cannot strike past the
/// wand's own reach of 2. Its positive control is the pair below — the same stat on a bow reaches distance 7.
fun a_wand_band_never_grows_with_the_range_stat() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"wand", 1);
  place(&mut fight, vector[FAR]); // (12,5) — distance 7: inside a bow's extended band, outside the wand's
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), range_stats(3));
  cast::weapon_strike(&mut fight, 0, FAR);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The contrast that makes the refusal above mean something: the BOW's band IS modifiable, so the same +3
/// range stat carries the same swing to the same cell.
fun a_bow_band_grows_with_the_range_stat() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"bow", 1);
  place(&mut fight, vector[FAR]); // distance 7 — one past the bow's own reach of 6
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), range_stats(3));
  cast::weapon_strike(&mut fight, 0, FAR);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
#[expected_failure(abort_code = cast::EIllegalCast)]
/// A SPELLBOOK strike aimed off the straight line aborts — the `line_only` gate, driven.
fun a_spellbook_cannot_strike_off_the_line() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"spellbook", 1);
  place(&mut fight, vector[ANCHOR + 20]); // (6,6) — diagonal from (5,5): in reach, off the line
  cast::weapon_strike(&mut fight, 0, ANCHOR + 20);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
