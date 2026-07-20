// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORGEMAGIE TESTS — golden vectors for the sealed applyRune port (docs/HYTALE_FORMULAS_VENDORED.md §2),
/// derived from a byte-exact JS twin of the integer math threading the shipped mulberry32 `prng::draw` stream.
/// Covers the 3 outcomes, proximity 0/1 boundaries, exotic floor (level bonus bypass), over-mage penalty,
/// the puits spend-first/re-bank ledger round-trip, selectStatToReduce priorities, the gain cap, XP, and
/// rng-stream discipline (draws consumed per branch).
#[test_only]
module aresrpg_foundation::forgemagie_tests;

use aresrpg_foundation::{forgemagie as fm, prng, rune_catalog as cat};

// ── helpers ──────────────────────────────────────────────────────────────────

fun zeros(): vector<u64> {
  let mut v = vector<u64>[];
  let mut i = 0;
  while (i < 17) { v.push_back(0); i = i + 1; };
  v
}

fun with(mut v: vector<u64>, stat: u8, value: u64): vector<u64> {
  *v.borrow_mut(stat as u64) = value;
  v
}

// ── the 3 outcomes (seed-0 roll = 565813 / 1e6) ─────────────────────────────

#[test]
fun t_g1_critical_success_fresh_stat() {
  // Proximity 0 (cur 0 / max 40): rate 990000, critChance clamps to 600000 > roll 565813 → CS.
  // CS: +1 Fo, puits untouched, no loss; exactly ONE draw consumed (state → 1144304738).
  let mut rng = prng::rng_seed(0);
  let r = fm::apply_rune(zeros(), with(zeros(), cat::stat_strength(), 40), cat::stat_strength(), 1, 5, 1, 0, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_cs(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 1, 1);
  assert!(fm::new_puits(&r) == 0, 2);
  assert!(!fm::has_loss(&r), 3);
  assert!(fm::applied_value(&r) == 1, 4);
  assert!(rng == 1144304738, 5); // one draw exactly
}

#[test]
fun t_g2_neutral_success_pays_via_loss() {
  // Proximity 1/2 (20/40): finalRate 745000, critChance 298000 → roll 565813 = NS. Puits 0 →
  // the 5 weight overflows into a loss: vitality is the only unprotected positive stat → −5 Vi
  // (unit 1), lost weight 5 == remaining → nothing re-banked.
  let mut rng = prng::rng_seed(0);
  let cur = with(with(zeros(), cat::stat_strength(), 20), cat::stat_vitality(), 100);
  let tmax = with(with(zeros(), cat::stat_strength(), 40), cat::stat_vitality(), 100);
  let r = fm::apply_rune(cur, tmax, cat::stat_strength(), 1, 5, 1, 0, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_ns(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 21, 1);
  assert!(*fm::new_stats(&r).borrow(cat::stat_vitality() as u64) == 95, 2);
  assert!(fm::new_puits(&r) == 0, 3);
  assert!(fm::lost_stat(&r) == cat::stat_vitality(), 4);
  assert!(fm::lost_amount(&r) == 5, 5);
}

#[test]
fun t_g3_critical_failure_at_proximity_one() {
  // Proximity 1 (40/40): finalRate 500000 ≤ roll 565813 → CF. Puits 10 ≥ weight 5 → puits pays
  // fully: 10−5 = 5, stats untouched, no loss, applied 0.
  let mut rng = prng::rng_seed(0);
  let cur = with(zeros(), cat::stat_strength(), 40);
  let tmax = with(zeros(), cat::stat_strength(), 40);
  let r = fm::apply_rune(cur, tmax, cat::stat_strength(), 1, 5, 1, 10, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_cf(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 40, 1);
  assert!(fm::new_puits(&r) == 5, 2);
  assert!(!fm::has_loss(&r), 3);
  assert!(fm::applied_value(&r) == 0, 4);
}

#[test]
fun t_g4_critical_failure_rebanks_overshoot() {
  // CF with puits 3 < weight 5 → remaining 2. Candidates {wisdom 10/10, strength 40/40} (none
  // over-maged); pick = draw₂ % 2 = 1 → strength; lose ceil(2/5)=1 pt (unit 5) → lost weight 5,
  // overshoot 3 RE-BANKED into puits. The ledger round-trip: 3 → 0 → 3.
  let mut rng = prng::rng_seed(0);
  let cur = with(with(zeros(), cat::stat_strength(), 40), cat::stat_wisdom(), 10);
  let tmax = with(with(zeros(), cat::stat_strength(), 40), cat::stat_wisdom(), 10);
  let r = fm::apply_rune(cur, tmax, cat::stat_strength(), 1, 5, 1, 3, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_cf(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 39, 1);
  assert!(*fm::new_stats(&r).borrow(cat::stat_wisdom() as u64) == 10, 2);
  assert!(fm::new_puits(&r) == 3, 3);
  assert!(fm::lost_stat(&r) == cat::stat_strength(), 4);
  assert!(fm::lost_amount(&r) == 1, 5);
}

// ── exotic + over-mage + level bonus ────────────────────────────────────────

#[test]
fun t_g5_exotic_floor_bypasses_level_bonus() {
  // max 0 → exotic: finalRate pinned 10000 (1%) even at runic level 50. Roll 565813 → CF.
  // Empty item (no other stat) → loss pool empty → puits 0, no loss (found=false path).
  let mut rng = prng::rng_seed(0);
  let r = fm::apply_rune(zeros(), zeros(), cat::stat_strength(), 1, 5, 50, 0, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_cf(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 0, 1);
  assert!(fm::new_puits(&r) == 0, 2);
  assert!(!fm::has_loss(&r), 3);
}

#[test]
fun t_g6_over_mage_penalty() {
  // cur 60 / max 40: proximity 1.5 → rate 255000; overRatio 0.5 → penalty 0.5²·0.8 = 200000 →
  // rate 55000; critChance floors at 10000. Roll 565813 → CF. Loss: strength IS the over-maged
  // pool (60>40, protected=none on CF) → −1 Fo (ceil(5/5)), lost weight 5 == remaining → puits 0.
  let mut rng = prng::rng_seed(0);
  let cur = with(zeros(), cat::stat_strength(), 60);
  let tmax = with(zeros(), cat::stat_strength(), 40);
  let r = fm::apply_rune(cur, tmax, cat::stat_strength(), 1, 5, 1, 0, &mut rng);
  assert!(fm::outcome(&r) == fm::outcome_cf(), 0);
  assert!(*fm::new_stats(&r).borrow(cat::stat_strength() as u64) == 59, 1);
  assert!(fm::lost_stat(&r) == cat::stat_strength(), 2);
  assert!(fm::lost_amount(&r) == 1, 3);
  assert!(fm::new_puits(&r) == 0, 4);
}

#[test]
fun t_g8_level_bonus_flips_cf_to_ns() {
  // Proximity 0.9 (36/40): L1 finalRate 549000 ≤ roll 565813 → CF; L50 finalRate 549000+196000 =
  // 745000 > roll → NS (big puits so NS pays cleanly). The +0.4%/level bonus, observable.
  let mut rng1 = prng::rng_seed(0);
  let r1 = fm::apply_rune(with(zeros(), cat::stat_strength(), 36), with(zeros(), cat::stat_strength(), 40), cat::stat_strength(), 1, 5, 1, 1000, &mut rng1);
  assert!(fm::outcome(&r1) == fm::outcome_cf(), 0);
  let mut rng2 = prng::rng_seed(0);
  let r2 = fm::apply_rune(with(zeros(), cat::stat_strength(), 36), with(zeros(), cat::stat_strength(), 40), cat::stat_strength(), 1, 5, 50, 1000, &mut rng2);
  assert!(fm::outcome(&r2) == fm::outcome_ns(), 1);
}

// ── puits ledger direct (pay_weight) ────────────────────────────────────────

#[test]
fun t_pay_weight_spend_first_no_rng() {
  // puits covers the weight → pure subtraction, NO draw consumed, no loss.
  let mut rng = prng::rng_seed(0);
  let mut stats = with(zeros(), cat::stat_vitality(), 50);
  let tmax = with(zeros(), cat::stat_vitality(), 100);
  let (puits, lost, amount) = fm::pay_weight(&mut stats, &tmax, fm::no_stat(), 100, 30, &mut rng);
  assert!(puits == 70, 0);
  assert!(lost == fm::no_stat(), 1);
  assert!(amount == 0, 2);
  assert!(rng == prng::rng_seed(0), 3); // untouched
  assert!(*stats.borrow(cat::stat_vitality() as u64) == 50, 4);
}

#[test]
fun t_pay_weight_exact_burn() {
  // Shortfall burns vitality at unit weight 1: remaining 7 → −7 Vi, zero re-bank.
  let mut rng = prng::rng_seed(0);
  let mut stats = with(zeros(), cat::stat_vitality(), 50);
  let tmax = with(zeros(), cat::stat_vitality(), 100);
  let (puits, lost, amount) = fm::pay_weight(&mut stats, &tmax, fm::no_stat(), 0, 7, &mut rng);
  assert!(puits == 0, 0);
  assert!(lost == cat::stat_vitality(), 1);
  assert!(amount == 7, 2);
  assert!(*stats.borrow(cat::stat_vitality() as u64) == 43, 3);
}

#[test]
fun t_pay_weight_rebank() {
  // Wisdom-only (unit 15) burning 7: lose ceil(7/15)=1 pt → 15 released, 8 re-banked.
  let mut rng = prng::rng_seed(0);
  let mut stats = with(zeros(), cat::stat_wisdom(), 10);
  let tmax = with(zeros(), cat::stat_wisdom(), 10);
  let (puits, lost, amount) = fm::pay_weight(&mut stats, &tmax, fm::no_stat(), 0, 7, &mut rng);
  assert!(puits == 8, 0);
  assert!(lost == cat::stat_wisdom(), 1);
  assert!(amount == 1, 2);
  assert!(*stats.borrow(cat::stat_wisdom() as u64) == 9, 3);
}

// ── selectStatToReduce priorities ───────────────────────────────────────────

#[test]
fun t_select_prefers_over_maged() {
  // strength 50/40 over-maged beats vitality 10/100 — pool has one member, pick deterministic.
  let mut rng = prng::rng_seed(0);
  let stats = with(with(zeros(), cat::stat_strength(), 50), cat::stat_vitality(), 10);
  let tmax = with(with(zeros(), cat::stat_strength(), 40), cat::stat_vitality(), 100);
  let loss = fm::select_stat_to_reduce(&stats, &tmax, fm::no_stat(), 5, &mut rng);
  assert!(fm::loss_found(&loss), 0);
  assert!(fm::loss_stat(&loss) == cat::stat_strength(), 1);
}

#[test]
fun t_select_skips_protected() {
  // Same board, strength protected → falls to vitality (regular pool).
  let mut rng = prng::rng_seed(0);
  let stats = with(with(zeros(), cat::stat_strength(), 50), cat::stat_vitality(), 10);
  let tmax = with(with(zeros(), cat::stat_strength(), 40), cat::stat_vitality(), 100);
  let loss = fm::select_stat_to_reduce(&stats, &tmax, cat::stat_strength(), 5, &mut rng);
  assert!(fm::loss_stat(&loss) == cat::stat_vitality(), 0);
}

#[test]
fun t_select_random_pick_golden() {
  // Two candidates {vitality(0), strength(2)}: seed-0 draw 1831565813 % 2 = 1 → strength;
  // amount = ceil(7/5) = 2 → 30 → 28.
  let mut rng = prng::rng_seed(0);
  let stats = with(with(zeros(), cat::stat_vitality(), 30), cat::stat_strength(), 30);
  let tmax = with(with(zeros(), cat::stat_vitality(), 100), cat::stat_strength(), 100);
  let loss = fm::select_stat_to_reduce(&stats, &tmax, fm::no_stat(), 7, &mut rng);
  assert!(fm::loss_stat(&loss) == cat::stat_strength(), 0);
  assert!(fm::loss_amount(&loss) == 2, 1);
  assert!(fm::loss_new_value(&loss) == 28, 2);
}

#[test]
fun t_select_empty_pool() {
  let mut rng = prng::rng_seed(0);
  let loss = fm::select_stat_to_reduce(&zeros(), &zeros(), fm::no_stat(), 5, &mut rng);
  assert!(!fm::loss_found(&loss), 0);
}

#[test]
fun t_select_loss_capped_at_current() {
  // amountToLose = min(ceil(needed/unit), current): vitality 3 burning 10 → all 3, not 10.
  let mut rng = prng::rng_seed(0);
  let stats = with(zeros(), cat::stat_vitality(), 3);
  let tmax = with(zeros(), cat::stat_vitality(), 100);
  let loss = fm::select_stat_to_reduce(&stats, &tmax, fm::no_stat(), 10, &mut rng);
  assert!(fm::loss_amount(&loss) == 3, 0);
  assert!(fm::loss_new_value(&loss) == 0, 1);
}

// ── gain cap + XP ───────────────────────────────────────────────────────────

#[test]
fun t_gain_cap_matches_java() {
  // cap = templateMax + floor(101/unit_retro), exact in the ×5 domain (505/unit_scaled):
  // Fo: 40 + 101/1×5→wait, unit_retro 1 → +101 → cap 141. Vi (0.2): +505. Po (51): +1. PA (100): +1.
  assert!(fm::gain_capped(40, 10, 40, cat::stat_strength()) == 50, 0); // under cap
  assert!(fm::gain_capped(140, 10, 40, cat::stat_strength()) == 141, 1); // capped at 40+101
  assert!(fm::gain_capped(0, 600, 100, cat::stat_vitality()) == 600, 2); // under 100+505
  assert!(fm::gain_capped(600, 10, 100, cat::stat_vitality()) == 605, 3); // capped at 605
  assert!(fm::gain_capped(1, 1, 1, cat::stat_range()) == 2, 4); // Po: cap 1+1 = 2
  assert!(fm::gain_capped(2, 1, 1, cat::stat_action()) == 2, 5); // PA: cap 1+1, already there
}

#[test]
fun t_compute_xp_java_faithful() {
  // Java: max(1, (int)(weight_retro × (1 + lvl/50) × tierMult)); scaled form divides ×5 back out.
  assert!(fm::compute_xp(cat::tier_ba(), 5, 50) == 2, 0); // Fo Ba: 1×2×1 = 2
  assert!(fm::compute_xp(cat::tier_ra(), 50, 50) == 40, 1); // Fo Ra: 10×2×2 = 40
  assert!(fm::compute_xp(cat::tier_ba(), 5, 1) == 1, 2); // Fo Ba L1: floor(1.02) = 1
  assert!(fm::compute_xp(cat::tier_ba(), 1, 1) == 1, 3); // tiny weight → max(1, 0) floor
  assert!(fm::compute_xp(cat::tier_ba(), 500, 100) == 300, 4); // Ga Pa on L100: 100×3×1
}

// ── rng-stream discipline + input guards ────────────────────────────────────

#[test]
fun t_stream_two_draws_on_loss_path() {
  // G4 consumed exactly two draws (outcome + pool pick): state == state-after-2-draws from seed 0.
  let mut probe = prng::rng_seed(0);
  prng::draw(&mut probe);
  prng::draw(&mut probe);
  let mut rng = prng::rng_seed(0);
  let cur = with(with(zeros(), cat::stat_strength(), 40), cat::stat_wisdom(), 10);
  let tmax = with(with(zeros(), cat::stat_strength(), 40), cat::stat_wisdom(), 10);
  fm::apply_rune(cur, tmax, cat::stat_strength(), 1, 5, 1, 3, &mut rng);
  assert!(rng == probe, 0);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_foundation::forgemagie)]
fun t_bad_stats_len_aborts() {
  let mut rng = prng::rng_seed(0);
  let mut short = vector<u64>[];
  short.push_back(0);
  fm::apply_rune(short, zeros(), 0, 1, 5, 1, 0, &mut rng); // EBadLen
}

// ╔════════════════ [ Brisage band curve (curve-based) ] ═ ]
// The flat YIELD_DIVISOR became a per-level-band divisor (docs/ECONOMY_SIM.md §7). These are GOLDEN
// constants — the exact integers the crush sim runner (see docs, sim/crush_run.mjs) solves so the STEADY-STATE crush
// ratio reaches the 70% target ceiling at each band's peak and NEVER exceeds it (crush never strictly beats
// selling; verified global steady-state max 70%). The sim is the economic oracle (it mirrors the level^1.4
// sale law + multi-stat gear + the taux steady-state); these tests pin its output so any divisor reduction
// that would reopen crush > sale fails HERE.

/// A raw 17-stat vector carrying `value` on the strength line (all else 0) — the brisage kernel input.
fun raw_str(value: u64): vector<u64> {
  let mut v = zeros();
  *v.borrow_mut(cat::stat_strength() as u64) = value;
  v
}

/// Total strength runes owed across all three tiers in a crush `counts` 51-vector (idx = stat×3 + tier−1).
fun str_owed(counts: &vector<u64>): u64 {
  let base = (cat::stat_strength() as u64) * 3;
  *counts.borrow(base) + *counts.borrow(base + 1) + *counts.borrow(base + 2)
}

#[test]
/// The solved band table — the never-≥100% guard. Each divisor is what the sim proved holds the floor
/// ceiling; a golden pin (band midpoints + the 151+ catch-all).
fun t_band_divisor_table() {
  assert!(fm::band_divisor(10) == 277, 0); // band 1-20  mid
  assert!(fm::band_divisor(35) == 2044, 1); // band 21-50  mid
  assert!(fm::band_divisor(75) == 6675, 2); // band 51-100 mid
  assert!(fm::band_divisor(125) == 12922, 3); // band 101-150 mid
  assert!(fm::band_divisor(175) == 19822, 4); // band 151-200 mid
  assert!(fm::band_divisor(200) == 19822, 5); // last band, exact upper bound
  assert!(fm::band_divisor(1000) == 19822, 6); // 151+ catch-all (levels above the last bound)
  assert!(fm::band_divisor(1) == 277, 7); // first band, lowest level
  assert!(fm::yield_divisor() == 2044, 8); // legacy getter → band_divisor(50) reference
}

#[test]
/// Band EDGES: the divisor must switch at exactly level 20/21, 50/51, 100/101, 150/151 (inclusive upper
/// bounds). Off-by-one here silently mis-prices a whole level band.
fun t_band_divisor_boundaries() {
  assert!(fm::band_divisor(20) == 277 && fm::band_divisor(21) == 2044, 0); // 1-20 | 21-50
  assert!(fm::band_divisor(50) == 2044 && fm::band_divisor(51) == 6675, 1); // 21-50 | 51-100
  assert!(fm::band_divisor(100) == 6675 && fm::band_divisor(101) == 12922, 2); // 51-100 | 101-150
  assert!(fm::band_divisor(150) == 12922 && fm::band_divisor(151) == 19822, 3); // 101-150 | 151-200
}

#[test]
/// Monotonic increasing across bands — crush value multiplies item_level × stat_value (both level-growing),
/// so it compounds faster than the level^1.4 sale law; every higher band MUST divide harder or the floor
/// drifts up and eventually beats selling. The sim relies on this ordering (§7).
fun t_band_divisor_monotonic() {
  let d = vector[fm::band_divisor(10), fm::band_divisor(35), fm::band_divisor(75), fm::band_divisor(125), fm::band_divisor(175)];
  let mut i = 1;
  while (i < d.length()) {
    assert!(*d.borrow(i) > *d.borrow(i - 1), i); // strictly increasing
    i = i + 1;
  };
}

#[test]
/// crush_lines CONSUMES band_divisor at the item's level (not the old flat 66). One EXACT golden per spanning
/// band: coeff is chosen so the raw R3 quotient is a whole number (stochastic_round returns it deterministically,
/// no draw) — the total owed pins the divisor. Under the old 66 each of these would yield ~4-42x more.
fun t_crush_lines_uses_band_divisor() {
  // band 1-20 (D=277): L10 × 40 Fo @ 692.5% → 10×40×692500 / (100000×277) = 10 exactly (old 66 → ~42).
  let mut rng = prng::rng_seed(0);
  let (counts, weight) = fm::crush_lines(&raw_str(40), 10, 692_500, false, &mut rng);
  assert!(str_owed(&counts) == 10, 0);
  assert!(weight == 40 * 5, 1); // total line weight = value × unit (×5 domain)

  // band 21-50 (D=2044): L35 × 40 Fo @ 1460% → 35×40×1460000 / (100000×2044) = 10 exactly (old 66 → ~310).
  let mut rng2 = prng::rng_seed(0);
  let (c2, _w2) = fm::crush_lines(&raw_str(40), 35, 1_460_000, false, &mut rng2);
  assert!(str_owed(&c2) == 10, 2);

  // band 51-100 (D=6675): L75 × 40 Fo @ 2225% → 75×40×2225000 / (100000×6675) = 10 exactly.
  let mut rng3 = prng::rng_seed(0);
  let (c3, _w3) = fm::crush_lines(&raw_str(40), 75, 2_225_000, false, &mut rng3);
  assert!(str_owed(&c3) == 10, 3);

  // band 151-200 (D=19822): L175 × 40 Fo @ 1982.2% → 175×40×1982200 / (100000×19822) = 7 exactly.
  let mut rng5 = prng::rng_seed(0);
  let (c5, _w5) = fm::crush_lines(&raw_str(40), 175, 1_982_200, false, &mut rng5);
  assert!(str_owed(&c5) == 7, 4);
}

#[test]
/// recipe-less (drop-only template) clamps the coeff to `recipeless_cap_milli` (50%) BEFORE the band divisor
/// — a drop-only item can never crush at a high bracket coeff (anti boss-loot-fodder). At L20 (band 1-20,
/// D=277) × 40 Fo @ 380.875% the recipe-FULL yield is exactly 11; recipe-less clamps the coeff to 50% so the
/// SAME line yields far less. Same seed both runs — the ONLY difference is the recipe_less flag.
fun t_crush_recipeless_caps_before_divisor() {
  let mut r1 = prng::rng_seed(1);
  let (full, _) = fm::crush_lines(&raw_str(40), 20, 380_875, false, &mut r1);
  let mut r2 = prng::rng_seed(1);
  let (capped, _) = fm::crush_lines(&raw_str(40), 20, 380_875, true, &mut r2);
  assert!(str_owed(&full) == 11, 0); // recipe-full uses the real 380.875% coeff (÷277 = 11 exactly)
  assert!(str_owed(&capped) < str_owed(&full), 1); // recipe-less clamped to 50% ⇒ strictly fewer runes
  assert!(str_owed(&capped) <= 2, 2); // ~1.44 EV at the 50% cap ÷277
}

/// Crush-to-sale ratio for a SINGLE Ba line, as a percent — the sim's weight-fraction rune pricing collapses
/// to a sale-INDEPENDENT identity here: a value-`V` strength line yields runes each worth `sale/V` of the
/// item's own sale value (rune_weight(Fo,Ba)=5, item weight = V×5, so per-rune = sale × 5/(V×5) = sale/V), so
/// crush_value/sale = yield_n / V. `V < 9` keeps every roll Ba (no Pa/Ra), making the identity exact. This is
/// the Move-side shadow of the sim's multi-stat never-≥100% proof (docs/ECONOMY_SIM.md §7).
fun single_ba_ratio_pct(yield_n: u64, value: u64): u64 { yield_n * 100 / value }

#[test]
/// NEVER strictly beats selling — at each band's own sim-cited PEAK steady-state coefficient (the highest the
/// taux bracket settles to; from crush_sim.json), a single Ba-line reference item crushes for < 100% of its
/// sale value. Coefficients are goldens (re-derived when the sim re-runs). value=8 (< 9 ⇒ Ba-only, exact).
fun t_crush_never_beats_sale_single_line() {
  let v = 8;
  // (level, peak steady coeff milli) per band — the worst (highest-ratio) point the sim reports for each band.
  let points = vector[
    vector[20u64, 853_000],   // band 1-20  peak @L20 (bracket-1 straddle, coeff 853%)
    vector[50, 1_855_000],    // band 21-50 peak @L50 (bracket 2, coeff 1855% — the global max coeff)
    vector[95, 1_581_000],    // band 51-100 peak region @L95 (bracket 4, coeff 1581%)
    vector[150, 1_653_000],   // band 101-150 peak @L150 (assumed bracket, coeff 1653%)
    vector[200, 1_653_000],   // band 151-200 peak @L200 (assumed bracket, coeff 1653%)
  ];
  let mut i = 0;
  while (i < points.length()) {
    let p = points.borrow(i);
    let level = *p.borrow(0);
    let coeff = *p.borrow(1);
    let mut rng = prng::rng_seed(level); // level as a distinct seed per point
    let (counts, _w) = fm::crush_lines(&raw_str(v), level, coeff, false, &mut rng);
    let ratio = single_ba_ratio_pct(str_owed(&counts), v);
    assert!(ratio < 100, i); // crush never strictly beats selling at the representative steady-state
    i = i + 1;
  };
}

// ── ForgeResult accessor + crush accumulator (not exercised above) ─────────

#[test]
fun t_applied_stat_accessor() {
  let mut rng = prng::rng_seed(0);
  let r = fm::apply_rune(zeros(), with(zeros(), cat::stat_strength(), 40), cat::stat_strength(), 1, 5, 1, 0, &mut rng);
  assert!(fm::applied_stat(&r) == cat::stat_strength(), 0);
}

#[test]
fun t_add_counts_accumulates_elementwise_across_calls() {
  let mut owed = fm::zero_counts();
  let mut c1 = fm::zero_counts();
  *c1.borrow_mut(0) = 3;
  *c1.borrow_mut(5) = 2;
  fm::add_counts(&mut owed, &c1);
  assert!(*owed.borrow(0) == 3, 0);
  assert!(*owed.borrow(5) == 2, 1);

  let mut c2 = fm::zero_counts();
  *c2.borrow_mut(0) = 4;
  fm::add_counts(&mut owed, &c2);
  assert!(*owed.borrow(0) == 7, 2); // accumulates across calls
  assert!(*owed.borrow(5) == 2, 3); // untouched index unaffected
}
