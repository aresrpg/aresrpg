/// DISTANCE-DIFFICULTY TESTS (§4 wave-2b) — the pure curve kernels in `world_math`: the piecewise-linear
/// `distance_progress` fit through three world-1 anchors, `level_cap`'s roster lerp (incl. the
/// single-level no-div-by-zero edge), `size_cap`'s group-size ramp (incl. the team_bound < 2 underflow guard),
/// and `roster_bounds`' authored-min / dormant-zero rules. Fully deterministic — no generator, no objects.
#[test_only]
module aresrpg_foundation::distance_difficulty_tests;

use aresrpg_foundation::world_math as wm;

// Owner world-1 anchors on a default 500k world: spawn centre (250000,250000); a zone `d` blocks out on +x sits
// at (250000 + d, 250000). Eligibility uses each mob's max_level CEILING (no member ever exceeds the cap), so the
// world-1 spawn table (protectors excluded) yields (roster_min, roster_max) = (3, 12) — razkin's ceiling 3 is the
// floor, sparrowdart's 12 the top. The LITERAL (2,10,12) is the (1,12) idealization (floor = 1).
const C: u32 = 250_000;

#[test]
fun t_world1_anchor_fit() {
  // ACTUAL world-1 on-chain band (3, 12) — the distance caps at/near the anchors:
  assert!(wm::level_cap(wm::distance_progress(C, C, C, C), 3, 12) == 3, 0);           // spawn: only the 1-3 floor mob
  assert!(wm::level_cap(wm::distance_progress(C + 250, C, C, C), 3, 12) == 4, 1);     // 250 blk: +the 1-4 mob (below level 3: members are 1-3)
  assert!(wm::level_cap(wm::distance_progress(C + 1000, C, C, C), 3, 12) == 10, 2);   // 1000 blk: cap 10 EXACT (level 10 anchor)
  assert!(wm::level_cap(wm::distance_progress(C + 5000, C, C, C), 3, 12) == 12, 3);   // 5000 blk: full roster (max anchor)
  assert!(wm::level_cap(wm::distance_progress(C + 50_000, C, C, C), 3, 12) == 12, 4); // beyond edge saturates
  // the LITERAL (2,10,12) is the (1,12) idealization — the curve hits it EXACTLY when the roster floor is 1:
  assert!(wm::level_cap(wm::distance_progress(C, C, C, C), 1, 12) == 1, 5);
  assert!(wm::level_cap(wm::distance_progress(C + 250, C, C, C), 1, 12) == 2, 6);
  assert!(wm::level_cap(wm::distance_progress(C + 1000, C, C, C), 1, 12) == 10, 7);
  assert!(wm::level_cap(wm::distance_progress(C + 5000, C, C, C), 1, 12) == 12, 8);
}

#[test]
fun t_progress_monotonic_and_bounded() {
  let p0 = wm::distance_progress(C, C, C, C);
  let p250 = wm::distance_progress(C + 250, C, C, C);
  let p1000 = wm::distance_progress(C + 1000, C, C, C);
  let p2500 = wm::distance_progress(C + 2500, C, C, C);
  let p5000 = wm::distance_progress(C + 5000, C, C, C);
  assert!(p0 == 0, 0);
  assert!(p250 == 91, 1);   // the authored anchor progress
  assert!(p1000 == 818, 2); // the authored anchor progress
  assert!(p0 <= p250 && p250 <= p1000 && p1000 <= p2500 && p2500 <= p5000, 3); // monotone non-decreasing
  assert!(p5000 == 1000, 4); // saturates at the edge
}

#[test]
fun t_distance_is_radial() {
  // same distance on +x / -x / +z → same progress (Euclidean, direction-agnostic)
  let px = wm::distance_progress(C + 1000, C, C, C);
  let pnx = wm::distance_progress(C - 1000, C, C, C);
  let pz = wm::distance_progress(C, C + 1000, C, C);
  assert!(px == pnx && px == pz, 0);
  // a 3-4-5 triangle: (600,800) delta = 1000 blocks → identical to an axial 1000
  assert!(wm::distance_progress(C + 600, C + 800, C, C) == px, 1);
}

#[test]
fun t_high_world_band_generalizes() {
  // world-20 spawn table = (179, 198). The IDENTICAL curve ramps its own band.
  assert!(wm::level_cap(wm::distance_progress(C, C, C, C), 179, 198) == 179, 0);
  assert!(wm::level_cap(wm::distance_progress(C + 1000, C, C, C), 179, 198) == 195, 1);
  assert!(wm::level_cap(wm::distance_progress(C + 5000, C, C, C), 179, 198) == 198, 2);
}

#[test]
fun t_level_cap_single_level_roster_no_div0() {
  // min == max → that level at every distance (the lerp term is 0; never a division by the span)
  assert!(wm::level_cap(0, 7, 7) == 7, 0);
  assert!(wm::level_cap(500, 7, 7) == 7, 1);
  assert!(wm::level_cap(1000, 7, 7) == 7, 2);
}

#[test]
fun t_size_cap_ramp_and_underflow_guard() {
  // team_bound 6: 2 near the spawn → 6 at the edge
  assert!(wm::size_cap(0, 6) == 2, 0);
  assert!(wm::size_cap(818, 6) == 5, 1); // d=1000
  assert!(wm::size_cap(1000, 6) == 6, 2);
  // team_bound at/below the near-cap → NO underflow, just the bound
  assert!(wm::size_cap(0, 1) == 1, 3);
  assert!(wm::size_cap(1000, 1) == 1, 4);
  assert!(wm::size_cap(1000, 2) == 2, 5);
}

#[test]
fun t_roster_bounds_rules() {
  // authored min ignores a 0 straggler; max is the plain max
  let (mn, mx) = wm::roster_bounds(&vector[0u16, 5, 3, 12]);
  assert!(mn == 3 && mx == 12, 0);
  // all dormant (unauthored) → (0,0): feature off, every mob eligible everywhere
  let (mn2, mx2) = wm::roster_bounds(&vector[0u16, 0, 0]);
  assert!(mn2 == 0 && mx2 == 0, 1);
  // empty roster → (0,0)
  let empty = vector<u16>[];
  let (mn3, mx3) = wm::roster_bounds(&empty);
  assert!(mn3 == 0 && mx3 == 0, 2);
}
