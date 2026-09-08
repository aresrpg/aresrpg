// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::forge_tests;

use aresrpg_math::{forge, item_stats::{Self, ItemStatistics}, prng, rune_catalog};

fun stats(): vector<u64> {
  let mut values = vector[];
  while (values.length() < rune_catalog::stat_count()) values.push_back(0);
  values
}

fun block(raw: vector<u64>): ItemStatistics {
  item_stats::from_vector(raw.map!(|value| (value + (item_stats::shift() as u64)) as u16))
}

#[test]
fun loss_selection_prefers_overmages_and_preserves_the_protected_line() {
  let mut current = stats();
  let mut maximum = stats();
  *current.borrow_mut(0) = 100;
  *maximum.borrow_mut(0) = 100;
  *current.borrow_mut(8) = 1;
  let mut rng = 1;
  let result = forge::apply_rune(block(current), item_stats::zero(), block(maximum), 0, 1, 0, &mut rng);
  assert!(forge::outcome(&result) == forge::outcome_cf(), 0);
  assert!(forge::lost_amounts(&result)[8] == 1, 1);
  assert!(forge::lost_amounts(&result)[0] == 0, 2);
  assert!(forge::new_puits(&result) == 1980, 3);
  let empty = forge::apply_rune(block(stats()), block(stats()), block(stats()), 8, 1, 0, &mut rng);
  assert!(forge::lost_amounts(&empty) == stats(), 4);
  assert!(forge::new_puits(&empty) == 0, 5);

}

#[test]
fun scribe_outcomes_pay_sink_first_and_bank_destroyed_weight_overshoot() {
  let mut current = stats();
  let mut maximum = stats();
  *current.borrow_mut(1) = 1;
  *maximum.borrow_mut(1) = 1;
  *maximum.borrow_mut(2) = 100;
  *current.borrow_mut(2) = 50;
  let mut seen = vector[false, false, false];
  // Pinned draws exercise the three outcome intervals for the signed-range model.
  let seeds = vector[0, 2, 4];
  let mut index = 0;
  while (index < seeds.length()) {
    let mut rng = seeds[index];
    let result = forge::apply_rune(block(current), item_stats::zero(), block(maximum), 2, 2, 20, &mut rng);
    let outcome = forge::outcome(&result);
    *seen.borrow_mut(outcome as u64) = true;
    assert!(forge::lost_amounts(&result).length() == rune_catalog::stat_count(), 0);
    assert!(forge::new_puits(&result) == 20, 1);
    if (outcome == forge::outcome_cs()) {
      assert!(forge::lost_amounts(&result) == stats(), 2);
      assert!(forge::new_stats(&result).wisdom() == item_stats::shift() + 1, 3);
    } else {
      assert!(forge::lost_amounts(&result)[1] == 1, 4);
      assert!(forge::new_stats(&result).wisdom() == item_stats::shift(), 5);
    };
    let gained = if (outcome == forge::outcome_cf()) 0 else 3;
    assert!(forge::applied_value(&result) == gained && (forge::new_stats(&result).strength() as u64) == (item_stats::shift() as u64) + 50 + gained, 6);
    index = index + 1;
  };
  assert!(seen == vector[true, true, true], 7);
}

#[test]
fun sufficient_sink_never_destroys_stats_and_empty_items_report_no_loss() {
  let mut maximum = stats();
  *maximum.borrow_mut(2) = 100;
  let mut seed = 0;
  while (seed < 100) {
    let mut rng = seed;
    let paid = forge::apply_rune(block(stats()), item_stats::zero(), block(maximum), 2, 2, 100, &mut rng);
    assert!(forge::lost_amounts(&paid) == stats(), 0);
    assert!(forge::new_puits(&paid) == (if (forge::outcome(&paid) == forge::outcome_cs()) 100 else 40), 1);
    let empty = forge::apply_rune(block(stats()), block(stats()), block(stats()), 8, 1, 0, &mut rng);
    assert!(forge::lost_amounts(&empty) == stats() && forge::new_puits(&empty) == 0, 2);
    seed = seed + 1;
  };
}

#[test]
fun overmage_failure_can_reduce_the_target_and_loss_cannot_underflow_sink() {
  let mut current = stats();
  *current.borrow_mut(2) = 1;
  let mut rng = 4;
  let result = forge::apply_rune(block(current), block(stats()), block(stats()), 2, 2, 0, &mut rng);
  assert!(forge::outcome(&result) == forge::outcome_cf(), 0);
  assert!(forge::new_stats(&result).strength() == item_stats::shift() && forge::new_puits(&result) == 0, 1);
  assert!(forge::lost_amounts(&result)[2] == 1 && forge::applied_value(&result) == 0, 2);
}

#[test]
fun crush_counts_conserve_the_lossy_pool_and_accumulate_by_stat_and_tier() {
  let mut raw = stats();
  *raw.borrow_mut(0) = 120;
  *raw.borrow_mut(2) = 400;
  *raw.borrow_mut(8) = 8;
  let mut seed = 0;
  while (seed < 25) {
    let mut rng = seed;
    let counts = forge::crush_lines(&raw, &mut rng);
    assert!(counts.length() == 45, 0);
    assert!(counts[0] * 3 + counts[1] * 10 + counts[2] * 30 <= 30, 1);
    assert!(counts[6] + counts[7] * 3 + counts[8] * 10 == 100, 2);
    assert!(counts[24] == 2 && counts[25] == 0 && counts[26] == 0, 3);
    let mut total = forge::zero_counts();
    forge::add_counts(&mut total, &counts);
    forge::add_counts(&mut total, &counts);
    let mut i = 0;
    while (i < counts.length()) { assert!(total[i] == 2 * counts[i], 4); i = i + 1; };
    seed = seed + 1;
  };
  let mut rng = 5;
  let mut tiny = stats();
  *tiny.borrow_mut(0) = 1;
  assert!(forge::crush_lines(&tiny, &mut rng) == forge::zero_counts(), 5);
}

#[test]
fun stochastic_rounding_preserves_exact_divisions_and_remainder_bounds() {
  let mut rng = 7;
  assert!(forge::stochastic_round(12, 4, &mut rng) == 3 && rng == 7, 0);
  let mut down = false;
  let mut up = false;
  let mut seed = 0;
  while (seed < 100) {
    let mut state = seed;
    let value = forge::stochastic_round(7, 4, &mut state);
    assert!(value == 1 || value == 2, 1);
    if (value == 1) down = true else up = true;
    seed = seed + 1;
  };
  assert!(down && up, 2);
}

#[test, expected_failure(vector_error, minor_status = 1, location = aresrpg_math::item_stats)]
fun scribe_refuses_an_incomplete_current_stat_block() {
  let mut rng = 1;
  forge::apply_rune(block(vector[]), block(stats()), block(stats()), 2, 1, 0, &mut rng);
}

#[test, expected_failure(vector_error, minor_status = 1, location = aresrpg_math::item_stats)]
fun scribe_refuses_an_incomplete_template_stat_block() {
  let mut rng = 1;
  forge::apply_rune(block(stats()), block(stats()), block(vector[]), 2, 1, 0, &mut rng);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_math::forge)]
fun stochastic_rounding_refuses_a_zero_denominator() {
  let mut rng = 1;
  forge::stochastic_round(1, 0, &mut rng);
}
