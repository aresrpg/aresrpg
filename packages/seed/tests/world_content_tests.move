// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::world_content_tests;

use aresrpg_control::admin;
use aresrpg_seed::{registry, world_content::{Self, WorldContent}};
use aresrpg_math::{world_map, city_map};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

fun update_entry_level(legacy: bool, level: u16) {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  assert!(world_content::name(&content) == b"nauvis".to_string(), 0);
  assert!(world_content::entry_level(&content) == 1, 1);
  world_content::share(content);

  scenario.next_tx(OWNER);
  let mut content = scenario.take_shared<WorldContent>();
  if (legacy) world_content::remove_entry_level_for_testing(&mut content);
  assert!(world_content::entry_level(&content) == 1, 4);
  world_content::set_entry_level(&cap, &mut root, &mut content, level, scenario.ctx());
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
  world_content::set_archi_rows(&cap, &mut root, &mut content, vector[], scenario.ctx());
  assert!(world_content::archi_rows(&content).is_empty(), 3);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun published_world_updates_population_and_rebuilds_its_biome_window() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::share(content);
  scenario.next_tx(OWNER);
  let mut content = scenario.take_shared<WorldContent>();
  let id = object::id(&content);
  let mobs = vector[world_map::new_mob_row(b"fuwa".to_string(), 10000, vector[1], vector[])];
  let resources = vector[world_map::new_resource_row(b"grain".to_string(), b"FARMER".to_string(), 1, b"fuwa".to_string(), b"rare_grain".to_string(), vector[1], vector[])];
  let cities = vector[city_map::new_city(b"town".to_string(), 50000, 50000, object::id(&root))];
  world_content::set_mobs(&cap, &mut root, &mut content, mobs, scenario.ctx());
  world_content::set_resources(&cap, &mut root, &mut content, resources, scenario.ctx());
  world_content::set_cities(&cap, &mut root, &mut content, cities, scenario.ctx());
  world_content::set_biome_window(&cap, &mut root, &mut content, 10, 20, 2, scenario.ctx());
  world_content::append_biome_cells(&cap, &mut root, &mut content, vector[0, 1], scenario.ctx());
  world_content::append_biome_cells(&cap, &mut root, &mut content, vector[2, 3], scenario.ctx());
  let data = world_content::data(&content);
  assert!(world_map::mobs(data) == mobs && world_map::resources(data) == resources, 0);
  assert!(world_map::cities(data) == cities, 1);
  assert!(world_map::biome_of_zone(world_map::biome_map(data), 11, 21) == 3, 2);
  let snapshot = *data;
  world_content::clear_biome_map(&cap, &mut root, &mut content, scenario.ctx());
  assert!(*world_map::biome_map(world_content::data(&content)) == world_map::empty_biome_map(), 3);
  assert!(world_map::biome_of_zone(world_map::biome_map(&snapshot), 11, 21) == 3, 4);
  world_content::set_mobs(&cap, &mut root, &mut content, vector[], scenario.ctx());
  assert!(world_map::mobs(world_content::data(&content)).is_empty(), 5);
  assert!(world_map::resources(world_content::data(&content)) == resources, 6);
  assert!(object::id(&content) == id && registry::revision(&root) == 9, 7);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun entry_level_is_living_world_content() { update_entry_level(false, 42); }
#[test]
fun older_worlds_default_to_one_and_can_gain_an_explicit_entry_level() { update_entry_level(true, 42); }
#[test, expected_failure(abort_code = 4401, location = aresrpg_seed::world_content)]
fun rebalance_cannot_remove_the_world_entry_gate() { update_entry_level(false, 0); }
