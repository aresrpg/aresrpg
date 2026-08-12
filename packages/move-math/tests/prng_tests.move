// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Golden vectors captured LIVE from the client sim's prng.js — the determinism contract.
/// The Move port MUST be byte-identical or every on-chain roll desyncs from client prediction.
#[test_only]
module aresrpg_math::prng_tests;

use aresrpg_math::prng::{draw, mix, rng_int, rng_next, rng_range, rng_seed, scramble};

#[test]
fun prng_matches_js_reference() {
  let s = rng_seed(0);
  let (s, v0) = rng_next(s);
  assert!(s == 1831565813 && v0 == 1144304738, 0);
  let (s, v1) = rng_next(s);
  assert!(s == 3663131626 && v1 == 1416247, 1);
  let (s, v2) = rng_next(s);
  assert!(s == 1199730143 && v2 == 958946056, 2);
  let (_s, v3) = rng_next(s);
  assert!(v3 == 627933444, 3);

  let (_s, r) = rng_range(rng_seed(12345), 1, 100);
  assert!(r == 70, 4);
  let (_s, i) = rng_int(rng_seed(999), 6);
  assert!(i == 1, 5);
}

/// `draw` must RETURN the value and ADVANCE the state to `rng_next`'s new state — the very
/// contract the 2026-08-10 audit found inverted (draw was untested). Locks it forever.
#[test]
fun draw_returns_value_and_advances_state() {
  let mut state = rng_seed(0);
  let v0 = draw(&mut state); // rng_next(0) = (1831565813, 1144304738)
  assert!(v0 == 1144304738, 0);
  assert!(state == 1831565813, 1);
  let v1 = draw(&mut state); // rng_next(1831565813) = (3663131626, 1416247)
  assert!(v1 == 1416247, 2);
  assert!(state == 3663131626, 3);
}

#[test]
fun scramble_and_mix_are_deterministic() {
  assert!(scramble(0) == 1144304738, 0);
  assert!(mix(0, 0) == 1144304738, 1);
  assert!(scramble(1) == scramble(1), 2);
  assert!(scramble(0) != scramble(1), 3);
  assert!(mix(mix(7, 3), 9) == mix(mix(7, 3), 9), 4);
  assert!(mix(mix(7, 3), 9) != mix(mix(7, 9), 3), 5);
}

#[test]
fun mix_masks_degenerate_u64_before_add() {
  assert!(mix(1, 18_446_744_073_709_551_615) == 1144304738, 0);
}
