/// COMBAT GRID TESTS — coverage for the D75 shape vocabulary (rect/ellipse/rounded/blob/cross masks + their
/// shape-code getters), the king-isolation placer, start-cell/path-sentinel helpers, and the fixed (no-RNG)
/// damage pipeline. `fill_row`/`corner_cut` are PRIVATE per-row fill helpers with no public wrapper — covered
/// TRANSITIVELY: every shape builder below (`rect_mask`/`ellipse_mask`/`rounded_mask`/`blob_mask`/`cross_mask`)
/// calls `fill_row`, and `rounded_mask`/`blob_mask` call `corner_cut`.
#[test_only]
module aresrpg_foundation::combat_grid_tests;

use aresrpg_foundation::combat_grid as grid;
use aresrpg_foundation::spell;

#[test]
fun t_shape_and_dir_and_sentinel_constant_getters() {
  assert!(grid::shape_rect() == 0, 0);
  assert!(grid::shape_rounded() == 1, 1);
  assert!(grid::shape_ellipse() == 2, 2);
  assert!(grid::shape_cross() == 3, 3);
  assert!(grid::shape_blob() == 4, 4);
  assert!(grid::dir_none() == 255, 5);
  assert!(grid::mask_words() == 6, 6);
  assert!(grid::path_unreachable() == grid::grid_cells(), 7); // 380 = 20 * 19
}

#[test]
fun t_is_start_cell_and_mask_any_and_on_mask() {
  assert!(grid::is_start_cell(grid::encode(3, 0)), 0); // row 0 < START_ROWS(2)
  assert!(grid::is_start_cell(grid::encode(3, 1)), 1); // row 1 < 2
  assert!(!grid::is_start_cell(grid::encode(3, 2)), 2); // row 2 is not a start row
  assert!(!grid::is_start_cell(9999), 3); // out of grid

  let empty = grid::empty_mask();
  assert!(!grid::mask_any(&empty), 4);
  let mut m = grid::empty_mask();
  grid::mask_set(&mut m, grid::encode(1, 1));
  assert!(grid::mask_any(&m), 5);
  assert!(grid::on_mask(&m, grid::encode(1, 1)), 6);
  assert!(!grid::on_mask(&m, grid::encode(2, 2)), 7);
}

#[test]
fun t_cheby_and_approach_functions() {
  let a = grid::encode(2, 2);
  let b = grid::encode(5, 6);
  assert!(grid::cheby(a, b) == 4, 0); // max(|2-5|,|2-6|) = max(3,4)

  // approach: king-step greedy toward b, stops adjacent (Chebyshev <= 1).
  let near = grid::approach(a, b, 10); // plenty of budget to reach adjacency
  assert!(grid::cheby(near, b) == 1, 1);
  let one_step = grid::approach(a, b, 1);
  assert!(one_step == grid::encode(3, 3), 2); // one diagonal king-step toward b

  // approach_manhattan: 4-directional greedy, stops when Manhattan <= 1.
  let near_m = grid::approach_manhattan(a, b, 10);
  assert!(grid::manhattan(near_m, b) <= 1, 3);
  let one_step_m = grid::approach_manhattan(a, b, 1);
  assert!(one_step_m == grid::encode(2, 3), 4); // dy(4) > dx(3) -> reduces y first
}

#[test]
fun t_blocker_placeable_rim_and_adjacency_rules() {
  let mask = grid::rect_mask(10, 10);
  let cand = grid::encode(5, 5);
  let none_blocked: vector<u64> = vector[];
  assert!(grid::blocker_placeable(&mask, &none_blocked, cand), 0); // interior, clear 8-ring, no neighbors
  assert!(!grid::blocker_placeable(&mask, &none_blocked, grid::encode(0, 0)), 1); // rim cell rejected
  let blocked = vector[grid::encode(6, 6)]; // Chebyshev-1 diagonal neighbor of cand
  assert!(!grid::blocker_placeable(&mask, &blocked, cand), 2);
  let far_blocked = vector[grid::encode(0, 0)]; // far away — no conflict
  assert!(grid::blocker_placeable(&mask, &far_blocked, cand), 3);
}

#[test]
fun t_shape_masks_rect_ellipse_rounded_blob_cross() {
  // RECT: the filled [0,w)x[0,h) rectangle.
  let rect = grid::rect_mask(4, 3);
  assert!(grid::on_mask(&rect, grid::encode(3, 2)), 0); // corner inside
  assert!(!grid::on_mask(&rect, grid::encode(4, 2)), 1); // just outside width

  // ELLIPSE inscribed in 5x5: center (2,2) is in, the far corner (0,0) is out.
  let ell = grid::ellipse_mask(5, 5);
  assert!(grid::on_mask(&ell, grid::encode(2, 2)), 2);
  assert!(!grid::on_mask(&ell, grid::encode(0, 0)), 3);

  // ROUNDED 6x6 r=2: the extreme corner is bevelled away, the center stays; r=0 degenerates to RECT.
  let rnd = grid::rounded_mask(6, 6, 2);
  assert!(!grid::on_mask(&rnd, grid::encode(0, 0)), 4);
  assert!(grid::on_mask(&rnd, grid::encode(3, 3)), 5);
  assert!(grid::rounded_mask(6, 6, 0) == grid::rect_mask(6, 6), 6);

  // BLOB 8x8, only the top-left corner rounded (others radius 0) — asymmetric per-corner cut.
  let blob = grid::blob_mask(8, 8, 3, 0, 0, 0);
  assert!(!grid::on_mask(&blob, grid::encode(0, 0)), 7); // top-left corner cut
  assert!(grid::on_mask(&blob, grid::encode(7, 0)), 8); // top-right NOT cut (radius 0)
  assert!(grid::on_mask(&blob, grid::encode(0, 7)), 9); // bottom-left NOT cut (radius 0)

  // CROSS 7x7: horizontal bar row [3,4) full width; other rows only cols [3,4).
  let cross = grid::cross_mask(7, 7, 3, 4, 3, 4);
  assert!(grid::on_mask(&cross, grid::encode(0, 3)), 10); // horizontal bar row, far left
  assert!(grid::on_mask(&cross, grid::encode(3, 0)), 11); // vertical bar column, top row
  assert!(!grid::on_mask(&cross, grid::encode(0, 0)), 12); // corner — neither bar
}

#[test]
fun t_fixed_damage_is_deterministic_midpoint_no_rng() {
  let caster = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  let target = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  let dmg = grid::fixed_damage(spell::el_fire(), 10, 20, &caster, &target, 1);
  assert!(dmg == 15, 0); // midpoint (10+20)/2, no level scaling above L1, zero resist
}
