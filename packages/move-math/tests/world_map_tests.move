// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::world_map_tests;

use aresrpg_math::{city_map, world_map};

#[test]
fun biome_chunks_complete_one_window_and_clamp_outside_coordinates() {
  let mut content = world_map::empty_world_content();
  assert!(world_map::biome_of_zone(content.biome_map(), 195, 195) == 0, 1);
  world_map::set_biome_map_window(&mut content, 10, 20, 3);
  world_map::append_biome_map_cells(&mut content, vector[1, 2, 3, 4]);
  world_map::append_biome_map_cells(&mut content, vector[5, 6, 7, 8, 9]);
  assert!(world_map::biome_of_zone(content.biome_map(), 0, 0) == 1, 2);
  assert!(world_map::biome_of_zone(content.biome_map(), 11, 21) == 5, 3);
  assert!(world_map::biome_of_zone(content.biome_map(), 195, 195) == 9, 4);
  assert!(world_map::biome_of_zone(content.biome_map(), 11, 195) == 8, 5);
  world_map::clear_biome_map(&mut content);
  assert!(world_map::biome_of_zone(content.biome_map(), 11, 21) == 0, 6);
  assert!(world_map::world_size() == 100_000 && world_map::world_center() == 50_000, 7);
}

#[test, expected_failure(abort_code = 311, location = aresrpg_math::world_map)]
fun partial_biome_map_cannot_be_read() {
  let map = world_map::append_biome_cells(&world_map::biome_map_window(10, 20, 2), vector[1, 2, 3]);
  world_map::biome_of_zone(&map, 10, 20);
}

#[test, expected_failure(abort_code = 311, location = aresrpg_math::world_map)]
fun biome_chunk_cannot_overfill_window() {
  let _ = world_map::append_biome_cells(&world_map::biome_map_window(0, 0, 1), vector[1, 2]);
}

#[test]
fun content_replacement_keeps_authored_resource_and_mob_metadata() {
  let mut content = world_map::empty_world_content();
  let mob = world_map::new_mob_row(b"tofu".to_string(), 10_000, vector[2], vector[3]);
  world_map::set_mobs(&mut content, vector[mob]);
  let mobs = world_map::mobs(&content);
  assert!(world_map::mob_row_type(&mobs[0]) == b"tofu".to_string(), 1);
  assert!(world_map::mob_row_weight_bp(&mobs[0]) == 10_000, 2);
  assert!(world_map::mob_row_biomes(&mobs[0]) == vector[2], 3);
  assert!(world_map::mob_row_cities(&mobs[0]) == vector[3], 4);
  let jobs = vector[b"FARMER", b"HERBALIST", b"MINER"];
  let mut rows = vector[];
  let mut index = 0;
  while (index < jobs.length()) {
    rows.push_back(world_map::new_resource_row(jobs[index].to_string(), jobs[index].to_string(), 2,
      b"protector".to_string(), b"rare".to_string(), vector[], vector[1]));
    index = index + 1;
  };
  world_map::set_resources(&mut content, rows);
  assert!(world_map::resources(&content).length() == 3, 5);
  let resource = world_map::resource_row_of(&content, b"MINER".to_string());
  assert!(world_map::resource_row_type(&resource) == b"MINER".to_string(), 6);
  assert!(world_map::resource_row_job(&resource) == b"MINER".to_string(), 7);
  assert!(world_map::resource_row_tier(&resource) == 2, 8);
  assert!(world_map::resource_row_protector(&resource) == b"protector".to_string(), 9);
  assert!(world_map::resource_row_rare(&resource) == b"rare".to_string(), 10);
  assert!(world_map::resource_row_biomes(&resource).is_empty(), 11);
  assert!(world_map::resource_row_cities(&resource) == vector[1], 12);
  let archi = world_map::new_archi_row(b"tofu".to_string(), b"architofu".to_string());
  assert!(world_map::archi_row_ordinary(&archi) == b"tofu".to_string(), 13);
  assert!(world_map::archi_row_replacement(&archi) == b"architofu".to_string(), 14);
  let city = city_map::new_city(b"Astrub".to_string(), 50_000, 50_000, sui::object::id_from_address(@0x1));
  world_map::set_cities(&mut content, vector[city]);
  assert!(world_map::cities(&content) == vector[city], 15);
  world_map::set_mobs(&mut content, vector[]);
  world_map::set_resources(&mut content, vector[]);
  world_map::set_cities(&mut content, vector[]);
  assert!(world_map::mobs(&content).is_empty() && world_map::resources(&content).is_empty(), 16);
  assert!(world_map::cities(&content).is_empty(), 17);
}

#[test, expected_failure(abort_code = 309, location = aresrpg_math::world_map)]
fun absent_resource_is_refused() {
  world_map::resource_row_of(&world_map::empty_world_content(), b"absent".to_string());
}

#[test, expected_failure(abort_code = 308, location = aresrpg_math::world_map)]
fun resource_job_must_be_a_gathering_profession() {
  world_map::new_resource_row(b"ore".to_string(), b"JEWELLER".to_string(), 1,
    b"".to_string(), b"".to_string(), vector[1], vector[]);
}

#[test, expected_failure(abort_code = 306, location = aresrpg_math::world_map)]
fun zero_mob_weight_is_refused() {
  world_map::new_mob_row(b"tofu".to_string(), 0, vector[1], vector[]);
}

#[test, expected_failure(abort_code = 306, location = aresrpg_math::world_map)]
fun excessive_mob_weight_is_refused() {
  world_map::new_mob_row(b"tofu".to_string(), 10_001, vector[1], vector[]);
}

#[test, expected_failure(abort_code = 306, location = aresrpg_math::world_map)]
fun mob_without_any_spawn_location_is_refused() {
  world_map::new_mob_row(b"tofu".to_string(), 1, vector[], vector[]);
}

#[test]
fun travel_uses_distance_and_requires_pet_at_both_ends() {
  assert!(!world_map::travel_ok(100, 100, 1, false, 100, 100, 0, false), 1);
  assert!(world_map::travel_ok(100, 100, 0, false, 100, 100, 0, false), 2);
  assert!(world_map::travel_ok(100, 100, 0, false, 111, 100, 1000, false), 3);
  assert!(!world_map::travel_ok(100, 100, 0, false, 112, 100, 1000, false), 4);
  assert!(world_map::travel_ok(100, 100, 0, false, 94, 92, 1000, false), 5);
  assert!(!world_map::travel_ok(100, 100, 0, false, 109, 109, 1000, false), 6);
  assert!(world_map::travel_ok(100, 100, 0, true, 117, 100, 1000, true), 7);
  assert!(!world_map::travel_ok(100, 100, 0, true, 117, 100, 1000, false), 8);
  assert!(!world_map::travel_ok(100, 100, 0, false, 117, 100, 1000, true), 9);
  assert!(world_map::travel_ok(0, 0, 0, false, 99_999, 99_999, 100_000_000, false), 10);
}
