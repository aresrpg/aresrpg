// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::recipe_rows_tests;

use aresrpg_control::admin;
use aresrpg_seed::{recipe_rows::{Self, Recipe}, registry};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun an_omitted_recipe_retires_and_the_same_identity_can_be_reactivated() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = object::id(&root);
  recipe_rows::add_recipe(
    &cap,
    &mut root,
    b"flour".to_string(),
    template,
    vector[template],
    vector[2],
    b"BAKER".to_string(),
    scenario.ctx(),
  );

  scenario.next_tx(OWNER);
  let mut recipe = scenario.take_shared<Recipe>();
  assert!(recipe_rows::is_active(&recipe), 0);
  recipe_rows::retire_recipe(&cap, &mut root, &mut recipe, scenario.ctx());
  assert!(!recipe_rows::is_active(&recipe), 1);
  recipe_rows::overwrite_recipe(
    &cap,
    &mut root,
    &mut recipe,
    vector[template],
    vector[1],
    b"BAKER".to_string(),
    scenario.ctx(),
  );
  assert!(recipe_rows::is_active(&recipe), 2);

  test_scenario::return_shared(recipe);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}
