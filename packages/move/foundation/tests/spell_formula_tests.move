// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL FORMULA TESTS — the AP/MP-removal DODGE SEED: a per-cast prng STATE threaded
/// from the public turn-seed stream (its own `DOMAIN_DODGE` tag decorrelates it from the crit stream), so a client
/// mirrors a drain's dodge byte-for-byte before commit. The source-file inline tests cover the §5h damage/heal
/// amplification, the crit boolean, push-collision, and per-point removal; this file adds the `dodge_seed` derivation.
#[test_only]
module aresrpg_foundation::spell_formula_tests;

use aresrpg_foundation::spell_formula as formula;

#[test]
/// `dodge_seed` is DETERMINISTIC (identical turn_seed + slot → identical state) and INPUT-BOUND (a different slot,
/// OR a different turn_seed — the SEAT feeds turn_seed — yields a different state, so every point of every drain
/// decorrelates and each seat gets its own sequence). Same contract the @aresrpg/sim mirror derives against.
fun t_dodge_seed_deterministic_and_input_bound() {
  let ts = 123456789;
  // deterministic: same inputs → same seed.
  assert!(formula::dodge_seed(ts, 0) == formula::dodge_seed(ts, 0), 0);
  // slot-bound: a different slot → a different seed (one seed per point of the cast).
  assert!(formula::dodge_seed(ts, 0) != formula::dodge_seed(ts, 1), 1);
  // turn-seed-bound (the seat feeds turn_seed): a different turn_seed → a different seed (per-seat sequence).
  assert!(formula::dodge_seed(ts, 0) != formula::dodge_seed(ts + 1, 0), 2);
}

#[test]
/// `punishment_base` — K_PUNISHMENT_DAMAGE's declared "damage scaling UP as caster HP drops", pinned at the three
/// points that define the line. The identical numbers are asserted against `@aresrpg/sim`'s
/// `spell_calculator::punishment_base` (the twin), so a drift on either side is a red test on both.
fun t_punishment_base_scales_with_missing_life() {
  // full life → IDENTITY (a healthy caster's punishment line is an ordinary damage line).
  assert!(formula::punishment_base(100, 200, 200) == 100, 0);
  // half life → ×1.5.
  assert!(formula::punishment_base(100, 100, 200) == 150, 1);
  // at death's door → ×2 (the ceiling; the scale is linear in the MISSING fraction, never unbounded).
  assert!(formula::punishment_base(100, 0, 200) == 200, 2);
  // integer floor, not rounding — the twin floors identically.
  assert!(formula::punishment_base(12, 100, 200) == 18, 3);
  assert!(formula::punishment_base(7, 150, 200) == 8, 4);
  // degenerate max_hp never divides by zero; hp above max cannot manufacture a discount.
  assert!(formula::punishment_base(50, 0, 0) == 50, 5);
  assert!(formula::punishment_base(50, 999, 200) == 50, 6);
}
