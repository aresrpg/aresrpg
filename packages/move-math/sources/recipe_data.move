// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Immutable recipe payload and authoring validation. Object identity, freezing, custody,
/// ingredient burns, randomness, and minting remain in the game package.
module aresrpg_math::recipe_data;

use aresrpg_math::job_xp;
use std::string::String;

const ELengthMismatch: u64 = 2306;
const EEmptyRecipe: u64 = 2307;
const EZeroQuantity: u64 = 2308;
const ETooManyIngredients: u64 = 2310;
const EDuplicateIngredient: u64 = 2311;

public struct Ingredient has copy, drop, store {
  template: ID,
  quantity: u64,
}

public struct RecipeData has copy, drop, store {
  inputs: vector<Ingredient>,
  output_template: ID,
  job: String,
  required_level: u64,
}

public fun new(
  output_template: ID,
  templates: vector<ID>,
  quantities: vector<u64>,
  job: String,
): RecipeData {
  let n = templates.length();
  assert!(n == quantities.length(), ELengthMismatch);
  assert!(n > 0, EEmptyRecipe);
  assert!(n <= job_xp::max_craft_ingredients(), ETooManyIngredients);
  let mut inputs = vector[];
  let mut i = 0;
  while (i < n) {
    let quantity = quantities[i];
    assert!(quantity >= 1, EZeroQuantity);
    let mut previous = 0;
    while (previous < i) {
      assert!(templates[previous] != templates[i], EDuplicateIngredient);
      previous = previous + 1;
    };
    inputs.push_back(Ingredient { template: templates[i], quantity });
    i = i + 1;
  };
  RecipeData { inputs, output_template, job, required_level: job_xp::craft_required_level(n) }
}

public fun output_template(data: &RecipeData): ID { data.output_template }

public fun job(data: &RecipeData): String { data.job }

public fun required_level(data: &RecipeData): u64 { data.required_level }

public fun input_count(data: &RecipeData): u64 { data.inputs.length() }

public fun input_quantity(data: &RecipeData, index: u64): u64 { data.inputs[index].quantity }

public fun ingredient_index(data: &RecipeData, template: ID): Option<u64> {
  let mut i = 0;
  while (i < data.inputs.length()) {
    if (data.inputs[i].template == template) return option::some(i);
    i = i + 1;
  };
  option::none()
}
