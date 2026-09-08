// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::craft_batch_tests;

use aresrpg_math::{craft_batch, recipe_data};

const OUTPUT: address = @0xA;
const INPUT: address = @0xB;

fun recipe(): recipe_data::RecipeData {
  recipe_data::new(object::id_from_address(OUTPUT), vector[object::id_from_address(INPUT)], vector[3], b"BAKER".to_string())
}

#[test]
fun shape_uses_category_job_and_recipe_fallback_before_rolling() {
  let data = recipe();
  let output = object::id_from_address(OUTPUT);
  let (job, stackable, count) = craft_batch::shape(&data, output, &b"hat".to_string(), 1, 1);
  assert!(job == b"TAILOR".to_string() && !stackable && count == 1, 1);
  let (job, stackable, count) = craft_batch::shape(&data, output, &b"consumable".to_string(), 1000, 1);
  assert!(job == b"BAKER".to_string() && stackable && count == 1, 2);
  craft_batch::assert_level(&data, 0);
}

#[test, expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun output_substitution_is_refused() { craft_batch::assert_output(&recipe(), object::id_from_address(INPUT)); }

#[test, expected_failure(abort_code = 2320, location = aresrpg_math::craft_batch)]
fun empty_batch_is_refused() { craft_batch::assert_attempts(true, 0); }

#[test, expected_failure(abort_code = 2320, location = aresrpg_math::craft_batch)]
fun stackable_batch_cannot_exceed_one_thousand() { craft_batch::assert_attempts(true, 1001); }

#[test, expected_failure(abort_code = 2320, location = aresrpg_math::craft_batch)]
fun unique_gear_cannot_be_aggregated() { craft_batch::assert_attempts(false, 2); }

#[test, expected_failure(abort_code = 2321, location = aresrpg_math::craft_batch)]
fun missing_input_is_refused_before_randomness() { craft_batch::input_count(&recipe(), 0); }

#[test, expected_failure(abort_code = 2321, location = aresrpg_math::craft_batch)]
fun foreign_input_template_is_refused() {
  craft_batch::input_quantity(&recipe(), 0, object::id_from_address(@0xC), 1, 3);
}

#[test, expected_failure(abort_code = 2321, location = aresrpg_math::craft_batch)]
fun input_cannot_reuse_a_different_slot() {
  craft_batch::input_quantity(&recipe(), 1, object::id_from_address(INPUT), 1, 3);
}

#[test, expected_failure(abort_code = 2322, location = aresrpg_math::craft_batch)]
fun inventory_must_cover_the_entire_batch() {
  craft_batch::input_quantity(&recipe(), 0, object::id_from_address(INPUT), 1000, 2999);
}

#[test, expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun unique_output_cannot_merge_into_existing_item() {
  let output = object::id_from_address(OUTPUT);
  craft_batch::assert_output_target(false, 1, output, option::some(output), 1, false, false);
}

#[test, expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun stackable_output_cannot_merge_into_another_template() {
  craft_batch::assert_output_target(true, 1, object::id_from_address(OUTPUT), option::some(object::id_from_address(INPUT)), 1, false, false);
}

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
