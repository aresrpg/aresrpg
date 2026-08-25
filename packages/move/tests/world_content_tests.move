// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::world_content_tests;

use aresrpg::world::{Self, World};
use aresrpg_control::admin;
use aresrpg_seed::{registry, world_content::{Self, WorldContent}};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun gameplay_world_is_created_from_authored_content() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"yakutia".to_string(), 1, scenario.ctx());
  world::create(&cap, &mut root, &content, scenario.ctx());
  world_content::share(content);

  scenario.next_tx(OWNER);
  let world = scenario.take_shared<World>();
  let content = scenario.take_shared<WorldContent>();
  assert!(world.name() == b"yakutia".to_string(), 0);
  assert!(world_content::name(&content) == b"yakutia".to_string(), 1);
  test_scenario::return_shared(world);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun nauvis_is_the_character_creation_world() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world::assert_start_world(&content);
  world_content::share(content);
  scenario.next_tx(OWNER);
  let content = scenario.take_shared<WorldContent>();
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 306, location = aresrpg::world)]
fun yakutia_cannot_be_used_as_the_character_creation_world() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"yakutia".to_string(), 1, scenario.ctx());
  world::assert_start_world(&content);
  world_content::share(content);
  abort 999
}
