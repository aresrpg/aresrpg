// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure aggregate-crafting policy. Core owns kiosk facts, Sui entropy, burns, mints, events,
/// and progression writes; this module owns every static limit, quote, and deterministic roll.
module aresrpg_math::craft_batch;

use aresrpg_math::{content_rules, job_xp, recipe_data::{Self, RecipeData}};
use std::string::String;

const MAX_STACKABLE_ATTEMPTS: u16 = 1_000;
const MAX_UNIQUE_ATTEMPTS: u16 = 1;
const MAX_ITEM_AMOUNT: u64 = 4_294_967_295;

const EAttempts: u64 = 2320;
const EUnderLevel: u64 = 2305;
const EInputOrder: u64 = 2321;
const EInputShort: u64 = 2322;
const EOutputTarget: u64 = 2323;
const EOutputCapacity: u64 = 2324;

public fun assert_output(data: &RecipeData, output_template: ID) {
  assert!(recipe_data::output_template(data) == output_template, EOutputTarget);
}

public fun is_stackable(category: &String): bool { content_rules::is_stackable(category) }

public fun job(category: &String, data: &RecipeData): String {
  content_rules::craft_job_of(category).destroy_with_default(recipe_data::job(data))
}

public fun shape(
  data: &RecipeData,
  output_template: ID,
  category: &String,
  attempts: u16,
  provided_inputs: u64,
): (String, bool, u64) {
  assert_output(data, output_template);
  let stackable = is_stackable(category);
  assert_attempts(stackable, attempts);
  (job(category, data), stackable, input_count(data, provided_inputs))
}

public fun max_attempts(stackable: bool): u16 {
  if (stackable) MAX_STACKABLE_ATTEMPTS else MAX_UNIQUE_ATTEMPTS
}

public fun assert_attempts(stackable: bool, attempts: u16) {
  assert!(attempts >= 1 && attempts <= max_attempts(stackable), EAttempts);
}

public fun assert_level(data: &RecipeData, xp: u64) {
  assert!(job_xp::level_from_xp(xp) >= recipe_data::required_level(data), EUnderLevel);
}

public fun input_count(data: &RecipeData, provided: u64): u64 {
  let expected = recipe_data::input_count(data);
  assert!(provided == expected, EInputOrder);
  expected
}

public fun input_quantity(
  data: &RecipeData,
  index: u64,
  template: ID,
  attempts: u16,
  held: u64,
): u32 {
  let found = recipe_data::ingredient_index(data, template);
  assert!(found.is_some() && found.destroy_some() == index, EInputOrder);
  let need = recipe_data::input_quantity(data, index) * (attempts as u64);
  assert!(held >= need, EInputShort);
  need as u32
}

/// Validate the facts core read from an optional output target before any entropy is drawn.
public fun assert_output_target(
  stackable: bool,
  attempts: u16,
  output_template: ID,
  target_template: Option<ID>,
  target_amount: u64,
  target_listed: bool,
  target_is_input: bool,
) {
  if (!stackable) {
    assert!(attempts == 1 && target_template.is_none(), EOutputTarget);
    return
  };
  if (target_template.is_some()) {
    assert!(
      target_template.destroy_some() == output_template && !target_listed && !target_is_input,
      EOutputTarget,
    );
    assert!(target_amount + (attempts as u64) <= MAX_ITEM_AMOUNT, EOutputCapacity);
  };
}

/// Sum exact sequential attempt odds and variance across deterministic XP level bands. One
/// draw rounds expected output; a second adds bounded symmetric uniform jitter approximating
/// binomial spread. One attempt remains byte-for-byte Bernoulli.
public fun resolve(
  ingredient_count: u64,
  starting_xp: u64,
  attempts: u16,
  rounding_roll: u16,
  variance_roll: u16,
): (u16, u64) {
  let mut virtual_xp = starting_xp;
  let mut gained_xp = 0;
  let mut probability_bp = 0;
  let mut variance_bp2 = 0;
  let mut remaining = attempts as u64;
  while (remaining > 0) {
    let (level, next_xp) = job_xp::level_and_next_xp(virtual_xp);
    let xp_per_attempt = job_xp::craft_xp_at_level(ingredient_count, level);
    let in_band = if (xp_per_attempt == 0 || level == job_xp::max_level()) {
      remaining
    } else {
      let needed = next_xp - virtual_xp;
      let to_next = (needed + xp_per_attempt - 1) / xp_per_attempt;
      if (to_next < remaining) to_next else remaining
    };
    let success_bp = job_xp::craft_success_bp(level);
    probability_bp = probability_bp + in_band * success_bp;
    variance_bp2 = variance_bp2 + in_band * success_bp * (10_000 - success_bp);
    let gained = in_band * xp_per_attempt;
    virtual_xp = virtual_xp + gained;
    gained_xp = gained_xp + gained;
    remaining = remaining - in_band;
  };
  let guaranteed = probability_bp / 10_000;
  let fractional = probability_bp % 10_000;
  let rounded = guaranteed + if ((rounding_roll as u64) < fractional) 1 else 0;
  let edge = if (rounded < (attempts as u64) - rounded) rounded else (attempts as u64) - rounded;
  let raw_spread = integer_sqrt(3 * variance_bp2) / 10_000;
  let spread = if (raw_spread < edge) raw_spread else edge;
  let magnitude = if (spread == 0) 0 else ((variance_roll as u64) / 2) % (spread + 1);
  let varied = if (variance_roll % 2 == 0) rounded - magnitude else rounded + magnitude;
  (varied as u16, gained_xp)
}

fun integer_sqrt(value: u64): u64 {
  if (value < 2) return value;
  let mut root = value;
  let mut next = (root + 1) / 2;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2;
  };
  root
}
