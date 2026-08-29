// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::craft_batch_tests;

use aresrpg_math::{craft_batch, recipe_data};

const OUTPUT: address = @0xA;
const INPUT: address = @0xB;

#[test]
fun one_attempt_is_the_original_bernoulli_roll() {
  assert!(craft_batch::max_attempts(true) == 1_000);
  assert!(craft_batch::max_attempts(false) == 1);
  craft_batch::assert_attempts(true, 1_000);
  craft_batch::assert_attempts(false, 1);
  let (successes, gained) = craft_batch::resolve(2, 0, 1, 4_999, 0);
  assert!(successes == 1 && gained == 10);
  let (successes, gained) = craft_batch::resolve(2, 0, 1, 5_000, 0);
  assert!(successes == 0 && gained == 10);
}

#[test]
fun aggregate_probability_crosses_levels_exactly_then_rounds_once() {
  // XP 40: attempt one is level 1 at 5000 bp and reaches level 2; attempt two is 5050 bp.
  // Total 10050 bp guarantees one output and gives the second a 50 bp aggregate remainder.
  let (successes, gained) = craft_batch::resolve(2, 40, 2, 49, 0);
  assert!(successes == 2 && gained == 20);
  let (successes, gained) = craft_batch::resolve(2, 40, 2, 50, 0);
  assert!(successes == 1 && gained == 20);
}

#[test]
fun obsolete_xp_stops_inside_the_aggregate() {
  let (successes, gained) = craft_batch::resolve(2, 100_411, 2, 9_999, 0);
  assert!(successes == 1);
  assert!(gained == 10);
}

#[test]
fun one_thousand_max_level_attempts_are_one_exact_amount() {
  let (successes, gained) = craft_batch::resolve(8, 581_687, 1_000, 9_999, 0);
  assert!(successes == 990);
  assert!(gained == 1_000_000);
}

#[test]
fun fake_variance_is_symmetric_and_bounded() {
  let (below, _) = craft_batch::resolve(8, 581_687, 1_000, 9_999, 2);
  let (above, _) = craft_batch::resolve(8, 581_687, 1_000, 9_999, 3);
  assert!(below == 989);
  assert!(above == 991);
}

#[test]
fun ordered_input_quote_aggregates_once() {
  let output = object::id_from_address(OUTPUT);
  let input = object::id_from_address(INPUT);
  let data = recipe_data::new(output, vector[input], vector[3], b"BAKER".to_string());
  assert!(craft_batch::input_quantity(&data, 0, input, 1_000, 3_000) == 3_000);
}

#[test]
fun output_preflight_accepts_absent_or_safe_stackable_target() {
  let output = object::id_from_address(OUTPUT);
  craft_batch::assert_output_target(true, 1_000, output, option::none(), 0, false, false);
  craft_batch::assert_output_target(true, 1_000, output, option::some(output), 10, false, false);
  craft_batch::assert_output_target(false, 1, output, option::none(), 0, false, false);
}

#[test]
#[expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun output_preflight_refuses_a_listed_target() {
  let output = object::id_from_address(OUTPUT);
  craft_batch::assert_output_target(true, 1, output, option::some(output), 1, true, false);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun output_preflight_refuses_an_input_target() {
  let output = object::id_from_address(OUTPUT);
  craft_batch::assert_output_target(true, 1, output, option::some(output), 1, false, true);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2324, location = aresrpg_math::craft_batch)]
fun output_preflight_reserves_the_worst_case_amount() {
  let output = object::id_from_address(OUTPUT);
  craft_batch::assert_output_target(true, 1_000, output, option::some(output), 4_294_967_000, false, false);
  abort 999
}
