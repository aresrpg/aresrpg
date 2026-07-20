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
