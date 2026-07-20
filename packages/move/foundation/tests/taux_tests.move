/// TAUX TESTS — golden vectors for the brisage coefficient economy (R3 canon + declared OURS curves),
/// derived from a byte-exact JS twin. Covers bounds clamping, the front-loaded per-item decay (incl. the
/// floor-terminal case), the lazy-accrual pressure settle with remainder carry (split-vs-single equivalence),
/// the per-tx pressure cap, the confirmed yield formula (exact / recipe-less-capped / stochastic), and the
/// EV-preservation property of stochastic rounding over seeded loops.
#[test_only]
module aresrpg_foundation::taux_tests;

use aresrpg_foundation::{prng, taux};

// ── bounds ──────────────────────────────────────────────────────────────────

#[test]
fun t_clamp_bounds() {
  assert!(taux::clamp_coefficient(0) == taux::floor_milli(), 0);
  assert!(taux::clamp_coefficient(999) == 1_000, 1);
  assert!(taux::clamp_coefficient(100_000) == 100_000, 2);
  assert!(taux::clamp_coefficient(4_000_001) == taux::cap_milli(), 3);
  assert!(taux::floor_milli() == 1_000 && taux::cap_milli() == 4_000_000, 4);
  assert!(taux::neutral_milli() == 100_000, 5);
}

// ── decay (front-loaded, asymptotic, floor-terminal) ────────────────────────

#[test]
fun t_decay_front_loaded_sequence() {
  // From 1000% (1_000_000 milli), 8 sequential item-crushes — the R3 anecdote shape
  // (1000% → ~700% after ~8): golden sequence from the JS twin.
  let mut c = 1_000_000;
  let expected = vector<u64>[960_040, 921_678, 884_850, 849_496, 815_556, 782_973, 751_694, 721_666];
  let mut i = 0;
  while (i < 8) {
    c = taux::update_on_crush(c);
    assert!(c == *expected.borrow(i), i);
    i = i + 1;
  };
}

#[test]
fun t_decay_floor_terminal() {
  // The last milli above the floor truncates to zero: decay(1001) = 1000; the floor is a fixpoint.
  assert!(taux::update_on_crush(1_001) == 1_000, 0);
  assert!(taux::update_on_crush(1_000) == 1_000, 1);
  // Out-of-bounds input is clamped before decaying (a sub-floor coefficient can never leave [floor, cap]).
  assert!(taux::update_on_crush(0) == 1_000, 2);
}

#[test]
fun t_decay_monotone_toward_floor() {
  // Strictly decreasing while above the floor (front-loaded: early drops are the largest).
  let mut c = 400_000;
  let mut prev_drop = 18_446_744_073_709_551_615; // u64::MAX
  let mut i = 0;
  while (i < 20) {
    let next = taux::update_on_crush(c);
    assert!(next < c, i);
    let drop = c - next;
    assert!(drop <= prev_drop, 100 + i); // never accelerates — front-loaded
    prev_drop = drop;
    c = next;
    i = i + 1;
  };
}

// ── pressure settle (lazy accrual, remainder carried) ───────────────────────

#[test]
fun t_settle_carries_subunit_remainder() {
  // 1 pressure unit = 3/5 milli: first settle gains 0 with carry 3; the next (carry 3 + 3) gains 1, carry 1.
  let (c1, r1) = taux::settle_pressure(100_000, 0, 0, 1);
  assert!(c1 == 100_000 && r1 == 3, 0);
  let (c2, r2) = taux::settle_pressure(c1, r1, 1, 2);
  assert!(c2 == 100_001 && r2 == 1, 1);
}

#[test]
fun t_settle_split_equals_single() {
  // The carry law: 10 single-step settles ≡ one 10-step settle — both (100_006, 0).
  let (single_c, single_r) = taux::settle_pressure(100_000, 0, 0, 10);
  assert!(single_c == 100_006 && single_r == 0, 0);
  let mut c = 100_000;
  let mut r = 0;
  let mut p = 0;
  while (p < 10) {
    let (nc, nr) = taux::settle_pressure(c, r, p, p + 1);
    c = nc; r = nr;
    p = p + 1;
  };
  assert!(c == single_c && r == single_r, 1);
}

#[test]
fun t_settle_clamps_at_cap() {
  let (c, r) = taux::settle_pressure(3_999_999, 0, 0, 10);
  assert!(c == taux::cap_milli() && r == 0, 0);
}

#[test]
fun t_effective_matches_settle() {
  let (c, _r) = taux::settle_pressure(100_000, 3, 1, 2);
  assert!(taux::effective_coefficient(100_000, 3, 1, 2) == c, 0);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_foundation::taux)]
fun t_settle_rewind_aborts() {
  taux::settle_pressure(100_000, 0, 5, 3); // EPressureRewind: monotone counter went backwards
}

// ── per-tx pressure cap ─────────────────────────────────────────────────────

#[test]
fun t_crush_pressure_saturates() {
  assert!(taux::crush_pressure(10) == 10, 0);
  assert!(taux::crush_pressure(taux::pressure_tx_cap()) == taux::pressure_tx_cap(), 1);
  assert!(taux::crush_pressure(taux::pressure_tx_cap() + 5_000) == taux::pressure_tx_cap(), 2);
}

// ── yield (R3 confirmed formula) ────────────────────────────────────────────

#[test]
fun t_yield_exact_consumes_no_rng() {
  // L50 item, 40 Fo (unit 5), Fo Ba rune (weight 5), coeff 100%: (50×40×5×100000)/(100×1000×5)
  // = exactly 2000 — zero remainder, so NO draw is consumed (Java-faithful conditional draw).
  let mut rng = prng::rng_seed(0);
  let y = taux::rune_yield(50, 40, 5, 5, 100_000, false, &mut rng);
  assert!(y == 2000, 0);
  assert!(rng == prng::rng_seed(0), 1);
}

#[test]
fun t_yield_recipeless_caps_coefficient() {
  // Same line at coeff 200% but recipe-less → priced at the 50% cap → 1000.
  let mut rng = prng::rng_seed(0);
  let y = taux::rune_yield(50, 40, 5, 5, 200_000, true, &mut rng);
  assert!(y == 1000, 0);
  // Below the cap, recipe-less changes nothing: 30% stays 30%.
  let y2 = taux::rune_yield(50, 40, 5, 5, 30_000, true, &mut rng);
  let y3 = taux::rune_yield(50, 40, 5, 5, 30_000, false, &mut rng);
  assert!(y2 == y3 && y2 == 600, 1);
  assert!(rng == prng::rng_seed(0), 2); // all three exact → still no draws
}

#[test]
fun t_yield_stochastic_golden() {
  // L48 item, 33 Fo, Fo RA rune (weight 50), coeff 100%: raw 158.4 → seed-0 draw 1831565813 %
  // 5_000_000 = 1_565_813 < remainder 2_000_000 → rounds UP → 159.
  let mut rng = prng::rng_seed(0);
  let y = taux::rune_yield(48, 33, 5, 50, 100_000, false, &mut rng);
  assert!(y == 159, 0);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_foundation::taux)]
fun t_yield_zero_rune_weight_aborts() {
  let mut rng = prng::rng_seed(0);
  taux::rune_yield(50, 40, 5, 0, 100_000, false, &mut rng); // EZeroDenominator
}

// ── stochastic rounding: EV preservation over seeded loops ──────────────────

#[test]
fun t_stochastic_round_ev_property() {
  // 51/5 = 10.2 → EV 10.2/round. 1000 rounds threading one rng from seed 42: golden sum 10_198
  // (EV 10_200, |Δ| = 2 ≪ 3σ ≈ 38) — deterministic, pinned exactly.
  let mut rng = prng::rng_seed(42);
  let mut sum = 0;
  let mut i = 0;
  while (i < 1000) {
    sum = sum + taux::stochastic_round(51, 5, &mut rng);
    i = i + 1;
  };
  assert!(sum == 10_198, 0);
}

#[test]
fun t_yield_ev_property() {
  // The 158.4 line, 500 crushes from seed 7: golden sum 79_201 (EV 79_200) — the fractional
  // remainder pays out at its exact expected rate over the loop.
  let mut rng = prng::rng_seed(7);
  let mut sum = 0;
  let mut i = 0;
  while (i < 500) {
    sum = sum + taux::rune_yield(48, 33, 5, 50, 100_000, false, &mut rng);
    i = i + 1;
  };
  assert!(sum == 79_201, 0);
}

#[test]
fun t_stochastic_round_exact_and_floor() {
  let mut rng = prng::rng_seed(0);
  assert!(taux::stochastic_round(100, 10, &mut rng) == 10, 0); // exact, no draw
  assert!(rng == prng::rng_seed(0), 1);
  // 7/2 = 3.5: seed-0 draw 1831565813 % 2 = 1 ≥ remainder 1 → stays 3 (floor).
  assert!(taux::stochastic_round(7, 2, &mut rng) == 3, 2);
}
