// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::forge_rules_tests;
use aresrpg_math::{forge, item_stats::{Self, ItemStatistics}, prng, rune_catalog};

fun set_stat(stats: ItemStatistics, index: u64, value: u16): ItemStatistics {
  let mut values = stats.to_vector();
  *values.borrow_mut(index) = value;
  item_stats::from_vector(values)
}

fun total(stats: &ItemStatistics, puits: u64): u64 {
  let values = stats.to_vector();
  let mut result = puits;
  let mut index = 0;
  while (index < rune_catalog::stat_count()) {
    result = result + (values[index] as u64) * rune_catalog::stat_unit_weight(index as u8);
    index = index + 1;
  };
  result
}

#[test]
fun natural_ap_cannot_be_overmaged_but_missing_ap_can_be_restored() {
  let center = item_stats::shift();
  let natural = set_stat(item_stats::zero(), 8, center + 1);
  assert!(!forge::can_apply_rune(&natural, &natural, 8, 1), 0);
  assert!(forge::can_apply_rune(&item_stats::zero(), &natural, 8, 1), 1);
  assert!(forge::can_apply_rune(&item_stats::zero(), &item_stats::zero(), 8, 1), 2);
  let (critical, success) = forge::outcome_chances(&item_stats::zero(), &item_stats::zero(), &item_stats::zero(), 8, 1);
  assert!(critical == 10000 && success == 10000, 3);
  let mut rng = 0;
  let restored = forge::apply_rune(item_stats::zero(), natural, natural, 8, 1, 0, &mut rng);
  assert!(forge::outcome(&restored) == forge::outcome_cs(), 4);
  assert!(forge::new_stats(&restored).action() == center + 1, 5);
}

#[test]
fun combined_excess_cannot_add_a_second_heavy_exotic() {
  let center = item_stats::shift();
  let ap = set_stat(item_stats::zero(), 8, center + 1);
  assert!(!forge::can_apply_rune(&ap, &item_stats::zero(), 7, 1), 0);
  assert!(forge::can_apply_rune(&ap, &item_stats::zero(), 2, 1), 1);
  assert!(!forge::can_apply_rune(&set_stat(ap, 2, center + 1), &item_stats::zero(), 2, 1), 2);
  let maximum = set_stat(item_stats::zero(), 1, center + 40);
  assert!(!forge::can_apply_rune(&maximum, &maximum, 1, 1), 3);
  assert!(forge::can_apply_rune(&set_stat(maximum, 1, center + 39), &maximum, 1, 1), 4);
}

#[test]
fun signed_malus_repairs_use_the_natural_range_and_puits() {
  let center = item_stats::shift();
  let minimum = set_stat(item_stats::zero(), 2, center - 10);
  let maximum = set_stat(item_stats::zero(), 2, center - 5);
  let current = set_stat(item_stats::zero(), 2, center - 8);
  let mut rng = 0;
  let result = forge::apply_rune(current, minimum, maximum, 2, 1, 20, &mut rng);
  assert!(forge::outcome(&result) == forge::outcome_ns(), 0);
  assert!(forge::new_stats(&result).strength() == center - 7, 1);
  assert!(forge::new_puits(&result) == 0 && forge::applied_value(&result) == 1, 2);
  assert!(forge::can_apply_rune(&set_stat(current, 2, center), &maximum, 2, 1), 3);
}

#[test]
fun repaired_maluses_can_pay_loss_down_to_their_natural_floor() {
  let center = item_stats::shift();
  let minimum = set_stat(item_stats::zero(), 2, center - 10);
  let maximum = set_stat(set_stat(item_stats::zero(), 2, center - 5), 1, center + 5);
  let current = set_stat(item_stats::zero(), 2, center - 5);
  let mut rng = 2;
  let result = forge::apply_rune(current, minimum, maximum, 1, 1, 0, &mut rng);
  assert!(forge::outcome(&result) == forge::outcome_ns(), 0);
  assert!(forge::new_stats(&result).wisdom() == center + 1, 1);
  assert!(forge::new_stats(&result).strength() == center - 8, 2);
  assert!(forge::lost_amounts(&result)[2] == 3, 3);
}

#[test]
fun noncritical_outcomes_cannot_create_unpaid_stat_weight() {
  let center = item_stats::shift();
  let current = set_stat(set_stat(set_stat(item_stats::zero(), 2, center + 3), 1, center + 1), 4, center + 10);
  let mut seen = vector[false, false, false];
  let mut multiple = false;
  let mut seed = 0;
  while (seed < 128) {
    let mut rng = seed;
    let result = forge::apply_rune(current, item_stats::zero(), current, 2, 3, 0, &mut rng);
    let outcome = forge::outcome(&result);
    *seen.borrow_mut(outcome as u64) = true;
    let after = total(&forge::new_stats(&result), forge::new_puits(&result));
    let before = total(&current, 0);
    if (outcome == forge::outcome_cs()) assert!(after == before + 200, 0)
    else if (outcome == forge::outcome_ns()) assert!(after == before, 1)
    else assert!(after == before - 200, 2);
    let losses = forge::lost_amounts(&result);
    multiple = multiple || (losses[1] > 0 && losses[4] > 0);
    assert!(losses.length() == 15, 3);
    seed = seed + 1;
  };
  assert!(seen == vector[true, true, true] && multiple, 4);
}

#[test]
fun a_neutral_gain_pays_its_remainder_from_the_target() {
  let maximum = set_stat(item_stats::zero(), 2, item_stats::shift() + 10);
  let mut found = false;
  let mut seed = 0;
  while (seed < 32) {
    let mut rng = seed;
    let result = forge::apply_rune(item_stats::zero(), item_stats::zero(), maximum, 2, 3, 20, &mut rng);
    if (forge::outcome(&result) == forge::outcome_ns()) {
      found = true;
      assert!(forge::applied_value(&result) == 1, 0);
      assert!(forge::new_stats(&result).strength() == item_stats::shift() + 1, 1);
      assert!(forge::new_puits(&result) == 0, 2);
    };
    seed = seed + 1;
  };
  assert!(found, 3);
}

#[test]
fun every_outcome_consumes_the_same_rng_draws() {
  let current = item_stats::zero();
  let maximum = set_stat(current, 2, item_stats::shift() + 10);
  let mut seed = 0;
  while (seed < 32) {
    let mut expected = seed;
    let mut draw = 0u64;
    while (draw < 15) { let _ = prng::draw(&mut expected); draw = draw + 1; };
    let mut actual = seed;
    let _ = forge::apply_rune(current, current, maximum, 2, 1, 20, &mut actual);
    assert!(actual == expected, 0);
    seed = seed + 1;
  };
}

#[test, expected_failure(abort_code = 1, location = aresrpg_math::forge)]
fun impossible_ap_overmage_is_refused_before_an_outcome() {
  let ap = set_stat(item_stats::zero(), 8, item_stats::shift() + 1);
  let mut rng = 0;
  forge::apply_rune(ap, ap, ap, 8, 1, 0, &mut rng);
}

#[test, expected_failure(abort_code = 3, location = aresrpg_math::forge)]
fun unrepresentable_puits_growth_is_refused_before_an_outcome() {
  let maximum = set_stat(item_stats::zero(), 2, item_stats::shift() + 10);
  let mut rng = 0;
  forge::apply_rune(item_stats::zero(), item_stats::zero(), maximum, 2, 1, 0xffff_ffff_ffff_ffff, &mut rng);
}

#[test]
fun probability_ranges_cover_maluses_natural_lines_overmages_and_exotics() {
  let center = item_stats::shift();
  let stats = vector[0u8, 1, 2, 8, 9];
  let mut stat_index = 0;
  while (stat_index < stats.length()) {
    let stat = stats[stat_index];
    let mut tier = 1u8;
    while (tier <= 3) {
      if (rune_catalog::has_rune(stat, tier)) {
        let mut kind = 0u64;
        while (kind < 3) {
          let minimum = if (kind == 0) center - 20 else center;
          let maximum = if (kind == 0) center - 5 else if (kind == 1) center + 20 else center;
          let low = set_stat(item_stats::zero(), stat as u64, minimum);
          let high = set_stat(item_stats::zero(), stat as u64, maximum);
          let values = vector[center - 20, center - 5, center, center + 13, center + 16, center + 18, center + 20, center + 30];
          let mut value_index = 0;
          while (value_index < values.length()) {
            let value = values[value_index];
            let current = set_stat(item_stats::zero(), stat as u64, value);
            let (critical, success) = forge::outcome_chances(&current, &low, &high, stat, tier);
            assert!(critical <= success && success <= 1000000, 0);
            assert!(critical % 10000 == 0 && success % 10000 == 0, 1);
            value_index = value_index + 1;
          };
          kind = kind + 1;
        };
      };
      tier = tier + 1;
    };
    stat_index = stat_index + 1;
  };
  assert!(!forge::can_apply_rune(&item_stats::zero(), &item_stats::zero(), 8, 2), 2);
  let excess = set_stat(item_stats::zero(), 8, center + 2);
  let maximum = set_stat(item_stats::zero(), 2, center + 10);
  assert!(forge::can_apply_rune(&excess, &maximum, 2, 1), 3);
}

// These entrypoints use identical input state and instructions, except the seed literal.
// Native VM statistics must report equal gas across all three outcomes.
fun fixed_work(seed: u64) {
  let center = item_stats::shift();
  let current = set_stat(set_stat(item_stats::zero(), 2, center + 3), 8, center + 1);
  let maximum = set_stat(current, 2, center + 10);
  let mut rng = seed;
  let _ = forge::apply_rune(current, item_stats::zero(), maximum, 2, 1, 20, &mut rng);
}
#[test]
fun fixed_work_seed_0() { fixed_work(0); }
#[test]
fun fixed_work_seed_1() { fixed_work(1); }
#[test]
fun fixed_work_seed_2() { fixed_work(2); }
#[test]
fun fixed_work_seed_4() { fixed_work(4); }
#[test]
fun fixed_work_seed_6() { fixed_work(6); }
#[test]
fun fixed_work_seed_10() { fixed_work(10); }
#[test]
fun fixed_work_seed_38() { fixed_work(38); }
#[test]
fun fixed_work_seed_359() { fixed_work(359); }
