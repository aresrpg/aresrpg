// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DISTANCE-GRADED LEVELS (#1111) — the ruled model's second half. Membership stopped depending on distance
/// (`zone_comp`'s format-3 pick table); difficulty starts to, right here: a member's level is drawn from a
/// quarter-band window that slides from the bottom of its template's authored band at the world centre to the
/// top of it at the edge.
///
/// The sharp edge is not the arithmetic, it is the STREAM. A pack now holds several species, so one skipped
/// draw on a degenerate-band member would shift every later member's rolls and the client mirror
/// (`packages/frontend/src/game/spawn_compose.js`) would paint a pack the chain never seats. The pinned vector
/// below is shared with that mirror's own test — one stream, both sides.
#[test_only]
module aresrpg_fight::mob_graded_level_tests;

use aresrpg_fight::mob;
use aresrpg_foundation::{combat_grid, spell};
use std::unit_test::assert_eq;

fun full_mask(): vector<u64> {
  let mut m = combat_grid::empty_mask();
  let mut c = 0;
  while (c < combat_grid::grid_cells()) { combat_grid::mask_set(&mut m, c); c = c + 1; };
  m
}

fun banded_spec(min_level: u16, max_level: u16, base_hp: u64): mob::MobSpec {
  mob::new_mob_spec(min_level, max_level, base_hp, 6, 3,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], 100, vector[])
}

/// Spawn the three-species roster off ONE seeded stream at `progress` — the exact shape the member-list create
/// path walks: a chicklet with a real band, a point-band mid, and a wide-band elite.
fun roster_levels(progress: u64): (vector<u64>, u64) {
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let specs = vector[banded_spec(10, 20, 100), banded_spec(30, 30, 100), banded_spec(100, 200, 100)];
  let mut levels = vector<u64>[];
  let mut state = 0u64;
  let mut i = 0;
  while (i < specs.length()) {
    let (m, s) = mob::spawn_seeded_graded(&specs[i], &mask, &empty, &empty, &empty, 0, progress, state);
    state = s;
    levels.push_back(mob::level(&m));
    i = i + 1;
  };
  (levels, state)
}

#[test]
/// FIXTURE ⑤ — SAME SEED, progress 0 vs 1000 ⇒ MIN-BAND vs TOP-BAND. At the world centre every member is drawn
/// at the floor of its own authored band; at the edge, from its top quarter. This is the whole ruling in one
/// assertion, and it is what makes a fresh character's first fight survivable while the far ring stays a wall.
fun the_same_seed_yields_the_min_band_at_the_centre_and_the_top_band_at_the_edge() {
  let (near, _sn) = roster_levels(0);
  let (far, _sf) = roster_levels(1000);
  assert_eq!(near, vector<u64>[10, 30, 100]); // exactly each template's authored MINIMUM
  // the edge draws inside each band's TOP QUARTER — [18,20], the point band 30, [175,200]
  assert!(far[0] >= 18 && far[0] <= 20);
  assert_eq!(far[1], 30); // a point band is a point everywhere — distance cannot widen what was never a band
  assert!(far[2] >= 175 && far[2] <= 200);
  // and the gradient is monotone in the same direction for every banded species
  assert!(far[0] > near[0] && far[2] > near[2]);
}

#[test]
/// THE WINDOW ITSELF — the pure band function at the three anchors. Progress 0 collapses to the floor, 500 puts
/// the window mid-band, 1000 tops out at the authored max. A degenerate band stays a point throughout, and a
/// progress above the scale saturates rather than running off the top of the band.
fun the_graded_window_slides_up_the_authored_band() {
  let (lo0, hi0) = mob::graded_band(10, 20, 0);
  assert_eq!(lo0, 10); assert_eq!(hi0, 10);
  let (lo5, hi5) = mob::graded_band(10, 20, 500);
  assert_eq!(lo5, 13); assert_eq!(hi5, 15);
  let (lo9, hi9) = mob::graded_band(10, 20, 1000);
  assert_eq!(lo9, 18); assert_eq!(hi9, 20);
  let (plo, phi) = mob::graded_band(30, 30, 1000);
  assert_eq!(plo, 30); assert_eq!(phi, 30);
  let (slo, shi) = mob::graded_band(10, 20, 99_999); // saturates — never past the authored ceiling
  assert_eq!(slo, 18); assert_eq!(shi, 20);
}

#[test]
/// THE PARITY LAW — the graded spawn spends the SAME number of draws for every member, whatever its band. The
/// proof is the stream itself: three members of wildly different bands, walked at three different difficulties,
/// all land on the identical final state. `spawn_seeded` skips its level draw on a point band, which is safe
/// only when every member of a group is the same species — and that assumption is exactly what this wave
/// retires. A mismatch here is the silent desync: the map paints one pack, the chain seats another.
fun every_member_costs_the_same_draws_whatever_its_band() {
  let (_l0, state_at_0) = roster_levels(0);
  let (_l5, state_at_500) = roster_levels(500);
  let (_l9, state_at_1000) = roster_levels(1000);
  assert_eq!(state_at_0, state_at_500);
  assert_eq!(state_at_500, state_at_1000);
  // PINNED — the same anchor `spawn_compose.test.js` asserts on the client side. Three members × three draws
  // (level · archimob · cell) off seed 0.
  assert_eq!(state_at_0, 3599190429);
}

#[test]
/// The pinned per-member vector, frozen: levels at the three anchors off seed 0, the exact rows the client
/// mirror reproduces. Any drift on either side breaks a test before it lies to a player.
fun the_graded_stream_is_frozen() {
  let (near, _a) = roster_levels(0);
  let (mid, _b) = roster_levels(500);
  let (far, _c) = roster_levels(1000);
  assert_eq!(near, vector<u64>[10, 30, 100]);
  assert_eq!(mid, vector<u64>[15, 30, 128]);
  assert_eq!(far, vector<u64>[20, 30, 178]);
}

#[test]
/// HP still scales across the template's AUTHORED band, not the window — the window moved, the species did not.
/// A level-20 chicklet at the world edge is a level-20 chicklet, with exactly the HP the authored curve gives
/// that level.
fun hp_follows_the_authored_curve_not_the_window() {
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let spec = banded_spec(10, 20, 100);
  let mut seed = 0u64;
  while (seed < 50) {
    let (m, _s) = mob::spawn_seeded_graded(&spec, &mask, &empty, &empty, &empty, 0, 1000, seed);
    assert_eq!(mob::hp(&m), mob::scaled_hp_for_testing(100, 10, 20, mob::level(&m)));
    assert!(mob::level(&m) >= 18 && mob::level(&m) <= 20);
    seed = seed + 1;
  };
}
