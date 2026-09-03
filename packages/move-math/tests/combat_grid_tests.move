// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::combat_grid_tests;

use aresrpg_math::{combat_grid, spell_effect};

#[test]
fun steered_path_accepts_the_declared_route() {
  let walls = combat_grid::mask_from_cells(&vector[10]);

  assert!(combat_grid::path_is_walkable(0, &vector[1, 2, 3], &walls, 3), 0);
  assert!(combat_grid::path_is_walkable(0, &vector[20, 40, 41], &walls, 3), 1);
}

#[test]
fun steered_path_rejects_invalid_steps() {
  let walls = combat_grid::mask_from_cells(&vector[10]);

  assert!(!combat_grid::path_is_walkable(0, &vector[2], &walls, 3), 0);
  assert!(!combat_grid::path_is_walkable(0, &vector[1, 2, 10], &walls, 3), 1);
  assert!(!combat_grid::path_is_walkable(0, &vector[1, 2, 3, 4], &walls, 3), 2);
}

/// The bounded zone scan must equal the naive full-board oracle (`in_zone` is the semantic
/// home) for every direction-independent shape — the allmap carve-out included: a bounding
/// box would silently amputate it, and the client twin would mirror the bug green.
#[test]
fun bounded_zone_scan_equals_the_full_board_oracle() {
  let shapes = vector[
    spell_effect::shape_point(),
    spell_effect::shape_circle(),
    spell_effect::shape_cross(),
    spell_effect::shape_ring(),
    spell_effect::shape_allmap(),
    spell_effect::shape_blob(),
  ];
  let anchors = vector[
    combat_grid::encode(0, 0), // corner — the box clamps
    combat_grid::encode(10, 9), // center
    combat_grid::encode(19, 5), // right edge
  ];
  let mut s = 0;
  while (s < shapes.length()) {
    let mut a = 0;
    while (a < anchors.length()) {
      let mut size = 0;
      while (size <= 3) {
        let anchor = anchors[a];
        let got = combat_grid::zone_cells(shapes[s], size, anchor, anchor);
        let mut expected = vector[];
        let mut c = 0;
        while (c < combat_grid::grid_cells()) {
          if (combat_grid::in_zone(shapes[s], size, anchor, c)) expected.push_back(c);
          c = c + 1;
        };
        assert!(got == expected, (s * 100 + a * 10 + size));
        size = size + 1;
      };
      a = a + 1;
    };
    s = s + 1;
  };
}

/// Runtime targeting walks fighters, not cells. Its rank must still preserve every historical
/// zone member and traversal order across static, directional, edge-clamped and full-map shapes.
#[test]
fun point_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_point()) }

#[test]
fun circle_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_circle()) }

#[test]
fun cross_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_cross()) }

#[test]
fun line_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_line()) }

#[test]
fun tbar_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_tbar()) }

#[test]
fun ring_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_ring()) }

#[test]
fun allmap_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_allmap()) }

#[test]
fun cone_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_cone()) }

#[test]
fun podium_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_podium()) }

#[test]
fun blob_rank_matches_the_cell_oracle() { assert_shape_rank(spell_effect::shape_blob()) }

fun assert_shape_rank(shape: u8) {
  let anchors = vector[
    combat_grid::encode(10, 9),
    combat_grid::encode(15, 9),
    combat_grid::encode(5, 9),
    combat_grid::encode(10, 14),
    combat_grid::encode(10, 4),
    combat_grid::encode(0, 0),
    combat_grid::encode(19, 18),
  ];
  let casters = vector[
    combat_grid::encode(10, 9),
    combat_grid::encode(10, 9),
    combat_grid::encode(10, 9),
    combat_grid::encode(10, 9),
    combat_grid::encode(10, 9),
    combat_grid::encode(1, 1),
    combat_grid::encode(18, 17),
  ];
  let sizes = vector[0, 1, 3, 10];
  let mut case_index = 0;
  while (case_index < anchors.length()) {
    let mut size_index = 0;
    while (size_index < sizes.length()) {
      assert_rank_case(
        shape,
        sizes[size_index],
        anchors[case_index],
        casters[case_index],
        (shape as u64) * 100 + case_index * 10 + size_index,
      );
      size_index = size_index + 1;
    };
    case_index = case_index + 1;
  };
}

fun assert_rank_case(shape: u8, size: u64, anchor: u64, caster: u64, code: u64) {
  let expected = combat_grid::zone_cells(shape, size, anchor, caster);
  let expected_mask = combat_grid::mask_from_cells(&expected);
  let mut index = 0;
  let mut previous = option::none();
  while (index < expected.length()) {
    let rank = combat_grid::zone_rank(shape, size, anchor, caster, expected[index]);
    assert!(rank.is_some(), 10_000 + code);
    if (previous.is_some()) assert!(*previous.borrow() < *rank.borrow(), 20_000 + code);
    previous = rank;
    index = index + 1;
  };
  let mut cell = 0;
  while (cell < combat_grid::grid_cells()) {
    let ranked = combat_grid::zone_rank(shape, size, anchor, caster, cell).is_some();
    assert!(ranked == combat_grid::mask_get(&expected_mask, cell), 30_000 + code);
    cell = cell + 1;
  };
}
