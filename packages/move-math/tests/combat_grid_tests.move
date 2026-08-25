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
