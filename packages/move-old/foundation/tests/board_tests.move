// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// BOARD TESTS — coverage for the deterministic board generator's public surface (`board_seed_from_anchor`,
/// `generate`, `generate_for_anchor`, the `GridSpec` getters). Every internal draw step (`build_shape`,
/// `min_u64`, `placeable_candidates`, `place_blockers`, `open_cells`, `pick_starts`, `tail_after`) is PRIVATE
/// with no public wrapper — covered TRANSITIVELY by `generate`, which calls every one of them unconditionally
/// per draw (`min_u64` only on the ROUNDED/BLOB branches of the 4-shape vocab, hence the seed sweep below to
/// guarantee at least one draw lands on either).
#[test_only]
module aresrpg_foundation::board_tests;

use aresrpg_foundation::board as bd;

#[test]
fun t_board_seed_from_anchor_and_generate_for_anchor() {
  let seed1 = bd::board_seed_from_anchor(12345, 10, 20);
  let seed2 = bd::board_seed_from_anchor(12345, 11, 20);
  assert!(seed1 != seed2, 0); // different anchors fold to different seeds
  let seed_same = bd::board_seed_from_anchor(12345, 10, 20);
  assert!(seed1 == seed_same, 1); // deterministic

  let g = bd::generate_for_anchor(999, 3, 7);
  assert!(bd::grid_width(&g) >= 7 && bd::grid_width(&g) <= 17, 2);
  assert!(bd::grid_height(&g) >= 7 && bd::grid_height(&g) <= 19, 3);
}

#[test]
fun t_generate_produces_valid_boards_across_seeds_and_variants() {
  let mut seed = 1u64;
  while (seed < 40) {
    let g = bd::generate(seed, seed % 3);
    let w = bd::grid_width(&g);
    let h = bd::grid_height(&g);
    assert!(w >= 7 && w <= 17, seed);
    assert!(h >= 7 && h <= 19, seed);
    assert!(bd::shape_mask(&g).length() == 6, seed); // MASK_WORDS
    assert!(bd::start_cells_a(&g).length() <= 6, seed); // MAX_SEATS
    assert!(bd::start_cells_b(&g).length() <= 6, seed);
    assert!(bd::obstacles(&g).length() <= 6, seed); // OBS_MAX
    assert!(bd::holes(&g).length() <= 4, seed); // HOLE_MAX
    seed = seed + 1;
  };
}

#[test]
/// SHAPE DIVERSITY (regression guard for "why is the board still a square?"): the generator's shape draw
/// (vocab[rng_int(N_SHAPES)] over BLOB/ROUNDED/ELLIPSE/CROSS — rect deliberately NOT in the world vocab) actually
/// diversifies. Proves (a) different anchors yield ≥2 DISTINCT shape masks, and (b) generated boards are NOT the
/// full bounding rectangle (the "always square" claim is dead at this layer — a live square can only come from a
/// STALE published lineage or a mirror, never from this code). Sweeps real `generate_for_anchor` inputs; a small
/// tolerance rides (a maxed-bars CROSS draw can legitimately fill its box) — the sweep must be OVERWHELMINGLY
/// non-rect and never uniform.
fun t_shape_draw_diversifies_and_is_not_forced_rect() {
  let mut masks: vector<vector<u64>> = vector[];
  let mut non_rect = 0u64;
  let mut ax = 1u32;
  while (ax < 17) {
    let g = bd::generate_for_anchor(999, ax, ax * 31 + 7); // 16 distinct anchors, one world seed
    let mask = bd::shape_mask(&g);
    if (!masks.contains(&mask)) masks.push_back(mask);
    // rect-ness probe: the mask of the full bounding box (what a FORCED shape_code 0 would always produce)
    if (mask != aresrpg_foundation::combat_grid::rect_mask(bd::grid_width(&g), bd::grid_height(&g))) non_rect = non_rect + 1;
    ax = ax + 1;
  };
  assert!(masks.length() >= 2, masks.length()); // ≥2 distinct shapes across anchors — the draw is live
  assert!(non_rect >= 14, non_rect); // overwhelmingly non-rect (tolerates rare maxed-bars CROSS boxes)
}
