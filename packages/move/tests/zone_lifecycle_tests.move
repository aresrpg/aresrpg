// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Independent Zone object lifecycle: first claim, idempotent observation, consumption, and TTL reset.
#[test_only]
module aresrpg::zone_lifecycle_tests;

use aresrpg::{character, world, zone};
use aresrpg_control::admin;
use aresrpg_math::{world_map, zone_math::{MobGroup, ResourcePack}};
use aresrpg_seed::{registry, world_content};
use sui::{clock, random, test_scenario};

const OWNER: address = @0xA11CE;
const CENTER: u32 = 50_000;
const ENothingThere: u64 = 1302;
const EWrongZone: u64 = 1303;
const EWrongWorld: u64 = 1301;

fun contains_group(groups: &vector<MobGroup>, group_index: u64): bool {
  let mut index = 0;
  while (index < groups.length()) {
    if (groups[index].group_index() == group_index) return true;
    index = index + 1;
  };
  false
}

fun test_content(
  name: vector<u8>,
  resources: bool,
  ctx: &mut TxContext,
): world_content::WorldContent {
  let cap = admin::cap_for_testing(ctx);
  let mut root = registry::registry_for_testing(ctx);
  let mut content = world_content::create(&cap, &mut root, name.to_string(), 1, ctx);
  if (resources) world_content::set_resources(
    &cap,
    &mut root,
    &mut content,
    vector[world_map::new_resource_row(
      b"wheat".to_string(), b"FARMER".to_string(), 1, b"".to_string(),
      b"".to_string(), vector[0], vector[],
    )],
    ctx,
  );
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  content
}

#[test]
fun only_ttl_refresh_reseeds_and_restores_consumed_population() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(
    &cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx(),
  );
  world_content::set_mobs(
    &cap,
    &mut root,
    &mut content,
    vector[world_map::new_mob_row(b"wooling".to_string(), 10_000, vector[0], vector[])],
    scenario.ctx(),
  );
  world_content::set_resources(
    &cap,
    &mut root,
    &mut content,
    vector[world_map::new_resource_row(
      b"wheat".to_string(), b"FARMER".to_string(), 1, b"".to_string(),
      b"".to_string(), vector[0], vector[],
    )],
    scenario.ctx(),
  );
  world::create(&cap, &mut root, &content, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  transfer::public_transfer(character, OWNER);
  world_content::share(content);
  clock::share_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);

  scenario.next_tx(OWNER);
  let mut character = scenario.take_from_sender<character::Character>();
  let mut world = scenario.take_shared<world::World>();
  let clock = scenario.take_shared<clock::Clock>();
  let mut initial = random::new_generator_from_seed_for_testing(b"initial-zone");
  zone::create(&mut character, CENTER, CENTER, &mut world, &mut initial, &clock);
  transfer::public_transfer(character, OWNER);
  test_scenario::return_shared(world);
  test_scenario::return_shared(clock);

  scenario.next_tx(OWNER);
  let mut character = scenario.take_from_sender<character::Character>();
  let mut zone = scenario.take_shared<zone::Zone>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let clock = scenario.take_shared<clock::Clock>();
  let seed = zone.seed_of();
  let (level_min, level_max) = zone.level_bounds();
  assert!(level_min <= level_max, 6);
  let groups = zone.mob_groups(&content);
  let group_index = groups[0].group_index();
  zone.consume_mob_group(group_index);
  assert!(!contains_group(&zone.mob_groups(&content), group_index), 1);
  let _ = zone.resource_pack_at(&content, 0);
  zone.consume_resource_node(&content, 0);

  let mut early = random::new_generator_from_seed_for_testing(b"ignored-before-ttl");
  zone::refresh(&mut character, CENTER, CENTER, &mut zone, &mut early, &clock);
  assert!(zone.seed_of() == seed, 2);
  assert!(!contains_group(&zone.mob_groups(&content), group_index), 3);
  transfer::public_transfer(character, OWNER);
  test_scenario::return_shared(zone);
  test_scenario::return_shared(content);
  test_scenario::return_shared(clock);

  scenario.next_tx(OWNER);
  let mut character = scenario.take_from_sender<character::Character>();
  let mut zone = scenario.take_shared<zone::Zone>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let mut clock = scenario.take_shared<clock::Clock>();
  clock::increment_for_testing(&mut clock, 7_200_000);
  let mut expired = random::new_generator_from_seed_for_testing(b"expired-zone");
  zone::refresh(&mut character, CENTER, CENTER, &mut zone, &mut expired, &clock);
  assert!(zone.seed_of() != seed, 4);
  assert!(contains_group(&zone.mob_groups(&content), group_index), 5);
  character::destroy(character);
  test_scenario::return_shared(zone);
  test_scenario::return_shared(content);
  test_scenario::return_shared(clock);
  scenario.end();
}

#[test, expected_failure(abort_code = EWrongWorld, location = aresrpg::zone)]
fun first_discovery_rejects_a_character_in_another_world() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let yakutia = world_content::create(
    &cap, &mut root, b"yakutia".to_string(), 1, scenario.ctx(),
  );
  let nauvis = world_content::create(
    &cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx(),
  );
  world::create(&cap, &mut root, &nauvis, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut character, &yakutia, &clock);
  transfer::public_transfer(character, OWNER);
  world_content::share(yakutia);
  world_content::share(nauvis);
  clock::share_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);

  scenario.next_tx(OWNER);
  let mut character = scenario.take_from_sender<character::Character>();
  let mut world = scenario.take_shared<world::World>();
  let clock = scenario.take_shared<clock::Clock>();
  let mut entropy = random::new_generator_from_seed_for_testing(b"wrong-world-create");
  zone::create(&mut character, CENTER, CENTER, &mut world, &mut entropy, &clock);
  transfer::public_transfer(character, OWNER);
  test_scenario::return_shared(world);
  test_scenario::return_shared(clock);
  scenario.end();
}

#[test, expected_failure(abort_code = EWrongWorld, location = aresrpg::zone)]
fun refresh_rejects_a_character_in_another_world() {
  let mut scenario = test_scenario::begin(OWNER);
  let content = test_content(b"yakutia", false, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  let mut zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 1, scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"wrong-world-refresh");
  zone::refresh(&mut character, CENTER, CENTER, &mut zone, &mut entropy, &clock);
  zone::destroy_for_testing(zone);
  character::destroy(character);
  world_content::share(content);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test, expected_failure(abort_code = ENothingThere, location = aresrpg::zone)]
fun a_consumed_mob_group_cannot_be_taken_twice() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 1, scenario.ctx());
  zone::consume_mob_group(&mut zone, 4);
  zone::consume_mob_group(&mut zone, 4);
  zone::destroy_for_testing(zone);
  scenario.end();
}

#[test, expected_failure(abort_code = ENothingThere, location = aresrpg::zone)]
fun a_mob_group_index_cannot_escape_its_u128_bitmap() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 1, scenario.ctx());
  zone::consume_mob_group(&mut zone, 128);
  zone::destroy_for_testing(zone);
  scenario.end();
}

#[test, expected_failure(abort_code = EWrongWorld, location = aresrpg::zone)]
fun world_content_cannot_be_substituted_for_another_zone() {
  let mut scenario = test_scenario::begin(OWNER);
  let content = test_content(b"yakutia", false, scenario.ctx());
  let zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 1, scenario.ctx());
  let _ = zone::mob_groups(&zone, &content);
  zone::destroy_for_testing(zone);
  world_content::share(content);
  scenario.end();
}

#[test, expected_failure(abort_code = EWrongZone, location = aresrpg::zone)]
fun refresh_rejects_a_zone_object_for_another_coordinate() {
  let mut scenario = test_scenario::begin(OWNER);
  let content = test_content(b"nauvis", false, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  let mut zone = zone::for_testing(b"nauvis".to_string(), 0, 0, 1, scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"wrong-zone");
  zone::refresh(&mut character, CENTER, CENTER, &mut zone, &mut entropy, &clock);
  zone::destroy_for_testing(zone);
  character::destroy(character);
  world_content::share(content);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test, expected_failure(abort_code = ENothingThere, location = aresrpg::zone)]
fun a_resource_pack_cannot_be_gathered_past_its_node_count() {
  let mut scenario = test_scenario::begin(OWNER);
  let content = test_content(b"nauvis", true, scenario.ctx());
  let mut zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 1, scenario.ctx());
  let pack: ResourcePack = zone::resource_pack_at(&zone, &content, 0);
  let mut remaining = pack.pack_nodes() as u64;
  while (remaining > 0) {
    zone::consume_resource_node(&mut zone, &content, 0);
    remaining = remaining - 1;
  };
  zone::consume_resource_node(&mut zone, &content, 0);
  zone::destroy_for_testing(zone);
  world_content::share(content);
  scenario.end();
}
