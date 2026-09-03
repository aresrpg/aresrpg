// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::world_content_tests;

use aresrpg_control::admin;
use aresrpg_seed::{registry, world_content::{Self, WorldContent}};
use aresrpg_math::world_map;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun entry_level_is_living_world_content() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  assert!(world_content::name(&content) == b"nauvis".to_string(), 0);
  assert!(world_content::entry_level(&content) == 1, 1);
  world_content::share(content);

  scenario.next_tx(OWNER);
  let mut content = scenario.take_shared<WorldContent>();
  world_content::set_entry_level(&cap, &mut root, &mut content, 42, scenario.ctx());
  assert!(world_content::entry_level(&content) == 42, 2);
  assert!(registry::revision(&root) == 2, 3);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 4401, location = aresrpg_seed::world_content)]
fun zero_entry_level_is_not_a_world_gate() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"void".to_string(), 0, scenario.ctx());
  world_content::share(content);
  abort 999
}

#[test]
fun archimob_rows_upgrade_existing_world_content_through_a_dynamic_field() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  assert!(world_content::archi_rows(&content).is_empty(), 0);
  world_content::share(content);
  scenario.next_tx(OWNER);
  let mut content = scenario.take_shared<WorldContent>();
  world_content::set_archi_rows(
    &cap, &mut root, &mut content,
    vector[world_map::new_archi_row(b"fuwa".to_string(), b"fukuo".to_string())],
    scenario.ctx(),
  );
  let rows = world_content::archi_rows(&content);
  assert!(rows.length() == 1, 1);
  assert!(world_map::archi_row_replacement(&rows[0]) == b"fukuo".to_string(), 2);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}
