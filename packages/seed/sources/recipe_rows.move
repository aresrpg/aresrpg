// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LIVING recipe content (the door contract — registry.move): one SHARED recipe per output
/// item type, derived by `RecipeKey` under the registry root, rebalanceable through the
/// overwrite door until `freeze_forever`. `recipe_data` (math) owns the shape and its
/// validation; crafting reads live at craft time — the sanctioned rules-live surface (a
/// craft composed against the old recipe lands abort-clean and recomposes).
module aresrpg_seed::recipe_rows;

use aresrpg_math::recipe_data::{Self, RecipeData};
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, event};

const DOMAIN: vector<u8> = b"recipes";
const ERecipeRetired: u64 = 2306;

/// Keys a recipe's derived address by its OUTPUT item type — one recipe per output.
public struct RecipeKey(String) has copy, drop, store;

public struct Recipe has key {
  id: UID,
  output_type: String,
  data: RecipeData,
  active: bool,
}

public struct RecipeCreated has copy, drop {
  recipe: ID,
  output_template: ID,
  input_count: u64,
  job: String,
  required_level: u64,
}

/// Author one recipe — `recipe_data::new` (math) validates the payload.
public fun add_recipe(
  cap: &AdminCap,
  root: &mut Registry,
  output_type: String,
  output_template: ID,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
  ctx: &TxContext,
) {
  let data = recipe_data::new(output_template, input_templates, input_quantities, job);
  let recipe = Recipe {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), RecipeKey(output_type)),
    output_type,
    data,
    active: true,
  };
  event::emit(RecipeCreated {
    recipe: recipe.id.to_inner(),
    output_template,
    input_count: recipe_data::input_count(&recipe.data),
    job: recipe_data::job(&recipe.data),
    required_level: recipe_data::required_level(&recipe.data),
  });
  registry::bump(cap, root, DOMAIN.to_string(), output_type, ctx);
  transfer::share_object(recipe);
}

/// Rebalance one recipe in place — the derived address IS the output type; ingredients,
/// quantities, and the job are the tuning surface (mid-flight crafts abort clean).
public fun overwrite_recipe(
  cap: &AdminCap,
  root: &mut Registry,
  recipe: &mut Recipe,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
  ctx: &TxContext,
) {
  let output_template = recipe_data::output_template(&recipe.data);
  recipe.data = recipe_data::new(output_template, input_templates, input_quantities, job);
  recipe.active = true;
  registry::bump(cap, root, DOMAIN.to_string(), recipe.output_type, ctx);
}

/// Retire an omitted recipe without releasing its derived identity. A later overwrite of the
/// same recipe-for-output reactivates it.
public fun retire_recipe(
  cap: &AdminCap,
  root: &mut Registry,
  recipe: &mut Recipe,
  ctx: &TxContext,
) {
  recipe.active = false;
  registry::bump(cap, root, DOMAIN.to_string(), recipe.output_type, ctx);
}

/// Core's read seam — a dumb accessor, nothing else crosses the boundary.
public fun data(recipe: &Recipe): &RecipeData { &recipe.data }

public fun active_data(recipe: &Recipe): &RecipeData {
  assert!(recipe.active, ERecipeRetired);
  &recipe.data
}

public fun is_active(recipe: &Recipe): bool { recipe.active }

#[test_only]
public fun recipe_for_testing(
  output_template: ID,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
  ctx: &mut TxContext,
): Recipe {
  Recipe {
    id: object::new(ctx),
    output_type: b"test_output".to_string(),
    data: recipe_data::new(output_template, input_templates, input_quantities, job),
    active: true,
  }
}

#[test_only]
public fun destroy_for_testing(recipe: Recipe) {
  let Recipe { id, .. } = recipe;
  id.delete();
}
