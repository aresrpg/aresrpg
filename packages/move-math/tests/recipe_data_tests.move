// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::recipe_data_tests;

use aresrpg_math::recipe_data;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun recipe_preserves_order_quantities_and_derived_level() {
  let output = object::id_from_address(@0xA);
  let first = object::id_from_address(@0xB);
  let second = object::id_from_address(@0xC);
  let recipe = recipe_data::new(output, vector[first, second], vector[2, 5], b"BAKER".to_string());
  assert!(recipe_data::output_template(&recipe) == output, 1);
  assert!(recipe_data::job(&recipe) == b"BAKER".to_string(), 2);
  assert!(recipe_data::required_level(&recipe) == 1, 3);
  assert!(recipe_data::input_count(&recipe) == 2, 4);
  assert!(recipe_data::input_quantity(&recipe, 0) == 2, 5);
  assert!(recipe_data::input_quantity(&recipe, 1) == 5, 6);
  assert!(recipe_data::ingredient_index(&recipe, first) == option::some(0), 7);
  assert!(recipe_data::ingredient_index(&recipe, second) == option::some(1), 8);
  assert!(recipe_data::ingredient_index(&recipe, output).is_none(), 9);
}

#[test, expected_failure(abort_code = 2306, location = aresrpg_math::recipe_data)]
fun template_and_quantity_lists_must_match() {
  let id = object::id_from_address(@0x1);
  recipe_data::new(id, vector[id], vector[], b"BAKER".to_string());
}

#[test, expected_failure(abort_code = 2307, location = aresrpg_math::recipe_data)]
fun empty_recipe_cannot_create_free_items() {
  recipe_data::new(object::id_from_address(@0x1), vector[], vector[], b"BAKER".to_string());
}

#[test, expected_failure(abort_code = 2308, location = aresrpg_math::recipe_data)]
fun zero_quantity_cannot_create_free_items() {
  let id = object::id_from_address(@0x1);
  recipe_data::new(id, vector[id], vector[0], b"BAKER".to_string());
}

#[test]
#[expected_failure(abort_code = 2310, location = aresrpg_math::recipe_data)]
fun a_recipe_cannot_exceed_eight_ingredient_slots() {
  let mut scenario = test_scenario::begin(OWNER);
  let uid = object::new(scenario.ctx());
  let id = uid.to_inner();
  uid.delete();
  let _ = recipe_data::new(
    id,
    vector[id, id, id, id, id, id, id, id, id],
    vector[1, 1, 1, 1, 1, 1, 1, 1, 1],
    b"BAKER".to_string(),
  );
  abort 999
}

#[test]
#[expected_failure(abort_code = 2311, location = aresrpg_math::recipe_data)]
fun one_ingredient_type_cannot_occupy_two_slots() {
  let mut scenario = test_scenario::begin(OWNER);
  let uid = object::new(scenario.ctx());
  let id = uid.to_inner();
  uid.delete();
  let _ = recipe_data::new(id, vector[id, id], vector[1, 1], b"BAKER".to_string());
  abort 999
}
