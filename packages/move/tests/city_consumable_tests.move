// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::city_consumable_tests;

use aresrpg::{character, consumable, world};
use aresrpg_control::admin;
use aresrpg_math::city_map;
use aresrpg_seed::{registry, world_content};
use sui::{clock, event, object, test_scenario};

const OWNER: address = @0xA11CE;

#[test]
#[expected_failure(abort_code = 309, location = aresrpg::world)]
fun joining_the_current_world_is_rejected() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let mut character = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  world::join_world(&mut character, &content, &clock);
  abort 999
}

#[test]
fun a_city_destination_is_derived_from_current_world_content() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::set_cities(
    &cap,
    &mut root,
    &mut content,
    vector[city_map::new_city(
      b"thebes".to_string(), 50_512, 50_000, object::id_from_address(@0xD),
    )],
    scenario.ctx(),
  );
  let mut character = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  world::teleport_city(&mut character, &content, &b"thebes".to_string(), &clock);
  let (current_world, x, z) = world::current_checkpoint_for_testing(&character);
  assert!(current_world == b"nauvis".to_string(), 0);
  assert!(x == 50_512 && z == 50_000, 1);
  assert!(event::events_by_type<world::CharacterTeleported>().length() == 1, 2);

  transfer::public_transfer(character, OWNER);
  world_content::share(content);
  clock::destroy_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 2603, location = aresrpg::consumable)]
fun a_rooted_character_cannot_use_any_consumable_door() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let mut character = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  world::delay_checkpoint(&mut character, 1_000, &clock);
  consumable::assert_available_for_testing(&character, &clock);
  abort 999
}

#[test]
#[expected_failure(abort_code = 307, location = aresrpg::world)]
fun a_city_potion_cannot_change_worlds() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let nauvis = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let mut yakutia = world_content::create(&cap, &mut root, b"yakutia".to_string(), 20, scenario.ctx());
  world_content::set_cities(
    &cap,
    &mut root,
    &mut yakutia,
    vector[city_map::new_city(
      b"thebes".to_string(), 50_512, 50_000, object::id_from_address(@0xD),
    )],
    scenario.ctx(),
  );
  let mut character = character::test_character(b"shugo".to_string(), 20, 0, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  world::join_world(&mut character, &nauvis, &clock);
  world::teleport_city(&mut character, &yakutia, &b"thebes".to_string(), &clock);
  abort 999
}
