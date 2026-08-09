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
  fight_with_range(sc, family, mobs, 0)
}

/// `fight_with`, plus a caster RANGE stat — the dial the ruled table says extends a bow's band and must NOT
/// extend anything else's.
fun fight_with_range(sc: &mut Scenario, family: vector<u8>, mobs: u16, range_stat: u64): (Fight, Version) {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let spec = bag_spec(MOB_HP);
  let clock = mk_clock(sc, 1000);
  let weapon = participant::weapon_line_of(option::some(family.to_string()), false);
  let seat = if (range_stat == 0) combatant_weapon(CHAR, 100, weapon) else participant::new_combatant(
    object::id_from_address(CHAR), b"senshi".to_string(), 1,
    spell::new_stats(0, 0, 0, 0, 0, 0, range_stat, 0, 0, 0, 0),
    100, 100, 6, 3, weapon, sui::vec_map::empty(),
  );
  fight::create_for_testing(
    &mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(),
    &spec, mobs, seat, &ver, &clock, sc.ctx(),
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
  place_from(fight, CASTER, cells)
}

/// `place`, with the attacker standing on an arbitrary cell — the rotation matrix moves BOTH ends.
fun place_from(fight: &mut Fight, caster: u64, cells: vector<u64>) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), caster);
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

/// Every mob's HP, in seat order — the before/after snapshot the rotation matrix diffs.
fun hp_all(fight: &Fight, n: u64): vector<u64> {
  let mut out = vector[];
  let mut i = 0;
  while (i < n) { out.push_back(hp(fight, i)); i = i + 1; };
  out
}

/// Exact SET equality (no duplicates on either side): same length AND every wanted cell present. The length
/// half is the "and NOTHING outside" assertion — an extra cell fails just as loudly as a missing one.
fun same_set(got: &vector<u64>, want: &vector<u64>): bool {
  if (got.length() != want.length()) return false;
  let mut i = 0;
  while (i < want.length()) {
    if (!got.contains(&want[i])) return false;
    i = i + 1;
  };
  true
}

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

// ╔══════════ [ §387 — THE ROTATION MATRIX: every zone kind, every facing, nothing outside ] ══════════ ]
//
// A directional zone is drawn around the attacker→target AXIS, so the single-facing coverage above proves
// nothing about the other three facings. These vectors are `packages/sim/test/fixtures/weapon_shape_facings.json`
// verbatim (Move cannot read JSON; the sim twin asserts the same file directly in
// `packages/sim/test/weapon_shapes.test.js`). They were derived from the RULED GEOMETRY, not read out of either
// implementation — so agreeing with them is evidence, not a tautology.
//
// Six conditions: the four cardinals, the DIAGONAL aim (|dx| ties |dy| — both twins must break the tie to the x
// axis), and a target on the board's LAST COLUMN (the forward step and the inline second cell fall off the grid
// and must be DROPPED, never wrapped to x=0 nineteen columns away).
const FACING_CASTER: vector<u64> = vector[105, 105, 105, 105, 105, 118];
const FACING_ANCHOR: vector<u64> = vector[106, 104, 125, 85, 126, 119];
const F_SINGLE: vector<vector<u64>> = vector[
  vector[106], vector[104], vector[125], vector[85], vector[126], vector[119],
];
const F_LINE_INLINE_2: vector<vector<u64>> = vector[
  vector[106, 107], vector[104, 103], vector[125, 145], vector[85, 65], vector[126, 127], vector[119],
];
const F_LINE_PERP_3: vector<vector<u64>> = vector[
  vector[106, 126, 86], vector[104, 124, 84], vector[125, 126, 124], vector[85, 86, 84],
  vector[126, 146, 106], vector[119, 139, 99],
];
const F_CROSS_1: vector<vector<u64>> = vector[
  vector[86, 105, 106, 107, 126], vector[84, 103, 104, 105, 124], vector[105, 124, 125, 126, 145],
  vector[65, 84, 85, 86, 105], vector[106, 125, 126, 127, 146], vector[99, 118, 119, 139],
];
const F_PODIUM_4: vector<vector<u64>> = vector[
  vector[106, 126, 86, 107], vector[104, 124, 84, 103], vector[125, 126, 124, 145],
  vector[85, 86, 84, 65], vector[126, 146, 106, 127], vector[119, 139, 99],
];

#[test]
/// EVERY zone kind in EVERY facing draws exactly its ruled cells — 30 exact-set assertions over the one zone
/// engine both twins share. A resolver that ignored the axis, or wrapped at the wall, fails here.
fun every_zone_kind_draws_its_cells_in_every_facing() {
  let (casters, anchors) = (FACING_CASTER, FACING_ANCHOR);
  let (singles, inlines, perps, crosses, podiums) = (F_SINGLE, F_LINE_INLINE_2, F_LINE_PERP_3, F_CROSS_1, F_PODIUM_4);
  let mut f = 0;
  while (f < casters.length()) {
    let (caster, anchor) = (casters[f], anchors[f]);
    assert!(same_set(&combat_grid::zone_cells(spell_effect::shape_point(), 0, anchor, caster), &singles[f]), f * 10 + 0);
    assert!(same_set(&combat_grid::zone_cells(spell_effect::shape_line(), 1, anchor, caster), &inlines[f]), f * 10 + 1);
    assert!(same_set(&combat_grid::zone_cells(spell_effect::shape_tbar(), 1, anchor, caster), &perps[f]), f * 10 + 2);
    assert!(same_set(&combat_grid::zone_cells(spell_effect::shape_cross(), 1, anchor, caster), &crosses[f]), f * 10 + 3);
    assert!(same_set(&combat_grid::zone_cells(spell_effect::shape_podium(), 1, anchor, caster), &podiums[f]), f * 10 + 4);
    f = f + 1;
  };
}

#[test]
/// The rotation has TEETH: each directional kind draws a DIFFERENT cell set in each of the four cardinals.
/// Without this, the matrix above would still pass on a resolver that returned one fixed pattern everywhere.
fun the_directional_kinds_genuinely_rotate() {
  let (casters, anchors) = (FACING_CASTER, FACING_ANCHOR);
  let shapes = vector[spell_effect::shape_line(), spell_effect::shape_tbar(), spell_effect::shape_podium()];
  let mut s = 0;
  while (s < shapes.length()) {
    let mut drawn = vector[];
    let mut f = 0;
    while (f < 4) { // the four cardinals only — the tie/wall rows are separate conditions
      let cells = combat_grid::zone_cells(shapes[s], 1, anchors[f], casters[f]);
      assert!(!drawn.contains(&cells), s * 10 + f);
      drawn.push_back(cells);
      f = f + 1;
    };
    s = s + 1;
  };
}

#[test]
/// The DIAGONAL tie and the WALL clamp, named. caster 105 (5,5) aiming 126 (6,6) has |dx| == |dy|: x wins, so
/// the podium's forward step is 127 and the bar runs on y. A y-tie would put 146 forward and 125/127 on the bar.
fun a_diagonal_aim_breaks_to_x_and_a_wall_aim_clips() {
  let podium_tie = combat_grid::zone_cells(spell_effect::shape_podium(), 1, 126, 105);
  assert!(same_set(&podium_tie, &vector[126, 146, 106, 127]), 0);
  // 119 = (19,5), the last column: the forward step and the inline second cell are off-grid and get DROPPED.
  let inline_wall = combat_grid::zone_cells(spell_effect::shape_line(), 1, 119, 118);
  let podium_wall = combat_grid::zone_cells(spell_effect::shape_podium(), 1, 119, 118);
  assert!(inline_wall == vector[119], 1);
  assert!(same_set(&podium_wall, &vector[119, 139, 99]), 2);
  // …and nothing wrapped to the far side of the board (x == 0 ⇒ cell % 20 == 0).
  let mut i = 0;
  while (i < podium_wall.length()) { assert!(podium_wall[i] % 20 != 0, 3); i = i + 1; };
}

// ╔══════════ [ §387 — the ruled table, row for row against the fixture ] ══════════ ]
//
// The fixture's `categories` block, transcribed. This is the anti-DRIFT gate between the two tables the twin
// unavoidably carries (`participant::WZ_*` on chain, `CATEGORY_STRIKES` in JS): both are asserted against THIS
// one spec, so they cannot drift apart without one of the two twins going red.
const RULED_CATEGORIES: vector<vector<u8>> = vector[
  b"sword", b"dagger", b"daggers", b"shovel", b"axe", b"pickaxe",
  b"club", b"longsword",
  b"scythe", b"staff", b"spear",
  b"battleaxe", b"mace", b"hammer",
  b"bow", b"wand", b"spellbook",
];
const RULED_SHAPE: vector<u8> = vector[0, 0, 0, 0, 0, 0, 3, 3, 4, 4, 4, 8, 8, 8, 0, 0, 0];
const RULED_SIZE: vector<u64> = vector[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
// bow 2 · wand 2 · spellbook 1 — the ruled ranged FLOOR (#387 leg ①), transcribed from the same
// `weapon_shapes.json` rows; every melee category keeps the floor 1.
const RULED_RANGE_MIN: vector<u64> = vector[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1];
const RULED_RANGE_MOD: vector<bool> = vector[
  false, false, false, false, false, false, false, false, false, false, false, false, false, false,
  true, false, false, // bow · wand · spellbook
];
const RULED_LINE_ONLY: vector<bool> = vector[
  false, false, false, false, false, false, false, false, false, false, false, false, false, false,
  false, false, true, // spellbook alone
];
/// The ruled CELL COUNT per category — the owner's table read as "how many cells does one swing touch".
const RULED_CELLS: vector<u64> = vector[1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 1, 1, 1];

#[test]
/// Every enumerated category resolves its ruled zone AND its ruled range band — 85 assertions, the whole table.
fun every_ruled_category_resolves_its_fixture_row() {
  let cats = RULED_CATEGORIES;
  let (shapes, sizes, mins, mods, lines) = (RULED_SHAPE, RULED_SIZE, RULED_RANGE_MIN, RULED_RANGE_MOD, RULED_LINE_ONLY);
  let mut i = 0;
  while (i < cats.length()) {
    let (shape, size, rmin, rmod, lonly) = participant::weapon_zone_of(&cats[i].to_string());
    assert!(shape == shapes[i], i * 10 + 0);
    assert!(size == sizes[i], i * 10 + 1);
    assert!(rmin == mins[i], i * 10 + 2);
    assert!(rmod == mods[i], i * 10 + 3);
    assert!(lonly == lines[i], i * 10 + 4);
    i = i + 1;
  };
}

#[test]
/// The table read as the OWNER ruled it: 1-CELL · 2-INLINE · 3-FRONT-ARC · PODIUM-4 · ranged-single. One
/// assertion per category, in every facing — the cell COUNT a swing touches, never wider, never narrower.
fun every_ruled_category_touches_its_ruled_cell_count() {
  let (cats, counts) = (RULED_CATEGORIES, RULED_CELLS);
  let (casters, anchors) = (FACING_CASTER, FACING_ANCHOR);
  let mut i = 0;
  while (i < cats.length()) {
    let (shape, size, _, _, _) = participant::weapon_zone_of(&cats[i].to_string());
    let mut f = 0;
    while (f < 5) { // the wall-clamped row is the deliberate exception: off-grid cells are dropped
      assert!(combat_grid::zone_cells(shape, size, anchors[f], casters[f]).length() == counts[i], i * 10 + f);
      f = f + 1;
    };
    i = i + 1;
  };
}

// ╔══════════ [ §387 — DRIVEN rotation: the real strike door, every facing, nothing outside ] ══════════ ]
//
// The tests above assert GEOMETRY. These assert the STRIKE: mobs are parked on the zone AND on two off-zone
// control cells adjacent to it, the real `cast::weapon_strike` swings, and the control mobs must come out
// untouched in every facing. Mob 0..k-1 hold the zone; the last two are always the controls.
const DRIVEN_ANCHOR: vector<u64> = vector[106, 104, 125, 85];
/// Two cells per facing that sit OUTSIDE every ruled zone at that facing (both adjacent to one — a sharp control).
const DRIVEN_OFF_A: vector<u64> = vector[146, 144, 127, 87];
const DRIVEN_OFF_B: vector<u64> = vector[108, 102, 165, 45];

/// Drive `family`'s strike at each cardinal facing with mobs on `zone_cells[f]` + the two controls, and assert
/// exactly the zone mobs took damage. `zone` is indexed by facing; the controls are seats `n`/`n+1`.
fun drive_rotation(sc: &mut Scenario, family: vector<u8>, zone: vector<vector<u64>>) {
  let n = zone[0].length();
  let (mut fight, ver) = fight_with(sc, family, ((n + 2) as u16));
  let (anchors, off_a, off_b) = (DRIVEN_ANCHOR, DRIVEN_OFF_A, DRIVEN_OFF_B);
  let mut f = 0;
  while (f < anchors.length()) {
    let mut cells = zone[f];
    cells.push_back(off_a[f]);
    cells.push_back(off_b[f]);
    place_from(&mut fight, CASTER, cells);
    let before = hp_all(&fight, n + 2);
    cast::weapon_strike(&mut fight, 0, anchors[f]);
    let after = hp_all(&fight, n + 2);
    let mut m = 0;
    while (m < n) { assert!(after[m] < before[m], f * 100 + m); m = m + 1; }; // every zone cell struck
    assert!(after[n] == before[n], f * 100 + 90); // …and NOTHING outside it
    assert!(after[n + 1] == before[n + 1], f * 100 + 91);
    f = f + 1;
  };
  ts::return_shared(fight);
  ts::return_shared(ver);
}

#[test]
/// 3-FRONT-ARC, driven: a STAFF sweeps its three cells in every facing and never the two adjacent controls.
fun a_staff_sweeps_its_front_arc_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"staff", vector[
    vector[106, 126, 86], vector[104, 124, 84], vector[125, 126, 124], vector[85, 86, 84],
  ]);
  sc.end();
}

#[test]
/// PODIUM-4, driven (#1870 — battleaxe is podium): four cells in every facing, the forward stem included.
fun a_battleaxe_strikes_its_podium_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"battleaxe", vector[
    vector[106, 126, 86, 107], vector[104, 124, 84, 103], vector[125, 126, 124, 145], vector[85, 86, 84, 65],
  ]);
  sc.end();
}

#[test]
/// PODIUM-4, driven on a SECOND category — the shape rides the ruling, not one family's row.
fun a_mace_strikes_its_podium_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"mace", vector[
    vector[106, 126, 86, 107], vector[104, 124, 84, 103], vector[125, 126, 124, 145], vector[85, 86, 84, 65],
  ]);
  sc.end();
}

#[test]
/// 2-INLINE, driven: a CLUB thrusts through the target in every facing, never across it.
fun a_club_thrusts_inline_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"club", vector[
    vector[106, 107], vector[104, 103], vector[125, 145], vector[85, 65],
  ]);
  sc.end();
}

#[test]
/// 2-INLINE on a second category — LONGSWORD, the ruling's other 2-cell weapon.
fun a_longsword_thrusts_inline_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"longsword", vector[
    vector[106, 107], vector[104, 103], vector[125, 145], vector[85, 65],
  ]);
  sc.end();
}

#[test]
/// 1-CELL, driven: a SWORD touches the aimed cell alone in every facing — the negative half of the whole
/// matrix. Passing this while the arc tests also pass is what proves the resolver reads the CATEGORY.
fun a_sword_touches_one_cell_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  drive_rotation(&mut sc, b"sword", vector[vector[106], vector[104], vector[125], vector[85]]);
  sc.end();
}

#[test]
/// 1-CELL on a second category — DAGGERS, and the arc/podium cells around it stay untouched. Same board the
/// staff and battleaxe tests sweep, so a resolver that widened every weapon cannot pass both.
fun daggers_leave_the_arc_and_the_stem_untouched_in_every_facing() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"daggers", 4);
  let anchors = DRIVEN_ANCHOR;
  let podium = vector[
    vector[106, 126, 86, 107], vector[104, 124, 84, 103], vector[125, 126, 124, 145], vector[85, 86, 84, 65],
  ];
  let mut f = 0;
  while (f < anchors.length()) {
    place_from(&mut fight, CASTER, podium[f]);
    let before = hp_all(&fight, 4);
    cast::weapon_strike(&mut fight, 0, anchors[f]);
    let after = hp_all(&fight, 4);
    assert!(after[0] < before[0], f * 100); // the aimed cell alone
    let mut m = 1;
    while (m < 4) { assert!(after[m] == before[m], f * 100 + m); m = m + 1; };
    f = f + 1;
  };
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔══════════ [ §387 — the RANGED band, driven: the refusals the table rules ] ══════════ ]

#[test]
/// A melee strike BEYOND the weapon's own reach refuses. A sword reaches 1; the mob stands at 2.
#[expected_failure(abort_code = cast::EIllegalCast)]
fun a_strike_beyond_the_bands_ceiling_refuses() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"sword", 1);
  place(&mut fight, vector[107]); // (7,5) — two cells east of the attacker
  cast::weapon_strike(&mut fight, 0, 107);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The band's FLOOR refuses too: the ruled minimum is 1, so a strike at distance 0 — the attacker's own cell —
/// is illegal even with a living mob standing there.
#[expected_failure(abort_code = cast::EIllegalCast)]
fun a_strike_below_the_bands_floor_refuses() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"bow", 1);
  place(&mut fight, vector[CASTER]);
  cast::weapon_strike(&mut fight, 0, CASTER);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The BOW's band is MODIFIABLE: reach 6 plus a range stat of 2 lands a strike at distance 8, which the same
/// bow without the stat cannot reach (proven by the refusal test below).
fun a_bow_with_the_range_stat_strikes_past_its_own_reach() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with_range(&mut sc, b"bow", 1, 2);
  place(&mut fight, vector[CASTER + 8]); // (13,5) — eight cells east, reach 6 + range 2
  cast::weapon_strike(&mut fight, 0, CASTER + 8);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// …and the extension is FINITE: one cell past `reach + range` still refuses.
#[expected_failure(abort_code = cast::EIllegalCast)]
fun a_bows_extended_band_still_has_a_ceiling() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with_range(&mut sc, b"bow", 1, 2);
  place(&mut fight, vector[CASTER + 9]);
  cast::weapon_strike(&mut fight, 0, CASTER + 9);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// NON-MODIFIABILITY, driven — the ruled property of the wand and the spellbook. A spellbook reaches 5; a
/// range stat of 3 does NOT buy it a sixth cell. (The wand carries the identical `range_modifiable == false`
/// row — asserted in `every_ruled_category_resolves_its_fixture_row` — but no engine damage line yet, so the
/// mechanic is driven here on the category that has one.)
#[expected_failure(abort_code = cast::EIllegalCast)]
fun the_range_stat_never_extends_a_non_modifiable_band() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with_range(&mut sc, b"spellbook", 1, 3);
  place(&mut fight, vector[CASTER + 6]); // one past the spellbook's fixed reach of 5
  cast::weapon_strike(&mut fight, 0, CASTER + 6);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The same seat, INSIDE the fixed band, lands — so the refusal above is the band and not a broken fixture.
fun a_spellbook_strikes_on_the_line_inside_its_fixed_band() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with_range(&mut sc, b"spellbook", 1, 3);
  place(&mut fight, vector[CASTER + 5]); // (10,5) — straight east, exactly the fixed reach
  cast::weapon_strike(&mut fight, 0, CASTER + 5);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// A ranged strike is still a SINGLE cell: a bow firing across the board leaves the cells around its target
/// untouched. Range is a BAND, never a wider zone — the half of the ruling a "ranged ⇒ AoE" reading would miss.
fun a_ranged_strike_stays_one_cell_at_the_far_end_of_its_band() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = fight_with(&mut sc, b"bow", 3);
  place(&mut fight, vector[CASTER + 6, CASTER + 7, CASTER + 26]); // target, one beyond, one on the perpendicular
  cast::weapon_strike(&mut fight, 0, CASTER + 6);
  assert!(hp(&fight, 0) < MOB_HP, 0);
  assert!(hp(&fight, 1) == MOB_HP, 1);
  assert!(hp(&fight, 2) == MOB_HP, 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
