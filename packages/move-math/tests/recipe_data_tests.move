// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::recipe_data_tests;

use aresrpg_math::recipe_data;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

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
