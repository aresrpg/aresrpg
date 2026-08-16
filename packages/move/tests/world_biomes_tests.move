// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The biome spawn law (ruling 2026-08-14): a zone only ever draws mob families from the rows
/// of ITS OWN biome — `world::biome_of_zone` (the seeded map, zone granularity) is the one
/// truth `zone::families` filters on. A biome with no rows spawns nothing; a world with no
/// map reads biome 0 everywhere, so map-less worlds keep their flat spawn behavior.
#[test_only]
module aresrpg::world_biomes_tests;

use aresrpg::{world::{Self, World}, zone};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

fun seed_map(w: &mut World, x0: u32, z0: u32, side: u16, cells: vector<u8>) {
  world::set_biome_map_window(w, x0, z0, side);
  world::append_biome_map_cells(w, cells);
}

fun world_with(
  rows: vector<world::MobRow>,
  scenario: &mut test_scenario::Scenario,
): World {
  world::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let mut w = scenario.take_shared<World>();
  world::set_mobs(&mut w, rows);
  w
}

#[test]
fun zone_families_respect_the_biome_map() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(
    vector[
      world::new_mob_row(b"wooling".to_string(), 8000, vector[1]),
      world::new_mob_row(b"bonelet".to_string(), 8000, vector[2]),
    ],
    &mut scenario,
  );
  // 2×2 window at zone (0,0): west column biome 1, east column biome 2.
  seed_map(&mut w, 0, 0, 2, vector[1, 2, 1, 2]);

  assert!(zone::families(&w, 0, 0) == vector[b"wooling".to_string()], 0);
  assert!(zone::families(&w, 1, 1) == vector[b"bonelet".to_string()], 1);
  // Far outside the window the id clamps to the nearest edge cell (south-east → biome 2).
  assert!(zone::families(&w, 900, 900) == vector[b"bonelet".to_string()], 2);

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
fun a_biome_without_rows_spawns_nothing() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(vector[world::new_mob_row(b"wooling".to_string(), 8000, vector[1])], &mut scenario);
  // The whole window is biome 0 (ocean) — no row lives there.
  seed_map(&mut w, 0, 0, 1, vector[0]);

  assert!(zone::families(&w, 0, 0).is_empty(), 0);

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
fun an_empty_map_reads_biome_zero_everywhere() {
  let mut scenario = test_scenario::begin(OWNER);
  // No map seeded: the flat legacy shape — rows authored as biome 0 spawn in every zone.
  let w = world_with(vector[world::new_mob_row(b"wooling".to_string(), 8000, vector[0])], &mut scenario);

  assert!(zone::families(&w, 0, 0) == vector[b"wooling".to_string()], 0);
  assert!(zone::families(&w, 512, 700) == vector[b"wooling".to_string()], 1);

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
fun a_zone_spawns_its_biome_s_whole_list() {
  // Ruling 2026-08-14: the old 3-family per-zone cap is repealed — every authored row of the
  // zone's biome is spawnable; the config is the only limitation.
  let mut scenario = test_scenario::begin(OWNER);
  let w = world_with(
    vector[
      world::new_mob_row(b"wooling".to_string(), 8000, vector[0]),
      world::new_mob_row(b"razkin".to_string(), 8000, vector[0]),
      world::new_mob_row(b"piglet".to_string(), 8000, vector[0]),
      world::new_mob_row(b"bonelet".to_string(), 8000, vector[0]),
      world::new_mob_row(b"grainfox".to_string(), 444, vector[0]),
    ],
    &mut scenario,
  );

  assert!(zone::families(&w, 0, 0).length() == 5, 0);

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
fun zone_resources_respect_the_biome_map() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(vector[], &mut scenario);
  world::set_resources(
    &mut w,
    vector[
      world::new_resource_row(b"wheat".to_string(), b"FARMER".to_string(), 1, b"".to_string(), b"".to_string(), vector[1]),
      world::new_resource_row(b"quartz".to_string(), b"MINER".to_string(), 1, b"".to_string(), b"".to_string(), vector[1, 2]),
    ],
  );
  seed_map(&mut w, 0, 0, 2, vector[1, 2, 1, 2]);

  // wheat lives only in biome 1; quartz spans biomes 1 and 2 (one row, a biome LIST).
  assert!(zone::resource_families(&w, 0, 0) == vector[b"wheat".to_string(), b"quartz".to_string()], 0);
  assert!(zone::resource_families(&w, 1, 0) == vector[b"quartz".to_string()], 1);

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
fun zones_below_the_window_origin_clamp_to_its_first_cell() {
  // Real maps use origin (0,0), but the clamp guard must hold for ANY window: a zone
  // WEST/NORTH of a non-zero origin clamps to cell 0 without u32 underflow.
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(
    vector[
      world::new_mob_row(b"wooling".to_string(), 8000, vector[1]),
      world::new_mob_row(b"bonelet".to_string(), 8000, vector[2]),
    ],
    &mut scenario,
  );
  seed_map(&mut w, 10, 10, 2, vector[1, 2, 1, 2]);

  assert!(zone::families(&w, 0, 0) == vector[b"wooling".to_string()], 0); // below both origins
  assert!(zone::families(&w, 3, 11) == vector[b"wooling".to_string()], 1); // below x0 only
  assert!(zone::families(&w, 11, 11) == vector[b"bonelet".to_string()], 2); // inside

  test_scenario::return_shared(w);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 311, location = aresrpg::world)]
fun cells_beyond_the_window_abort_at_authoring() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(vector[], &mut scenario);
  world::set_biome_map_window(&mut w, 0, 0, 2);
  world::append_biome_map_cells(&mut w, vector[1, 2, 3, 4, 5]);
  abort 0
}

#[test]
#[expected_failure(abort_code = 311, location = aresrpg::world)]
fun a_half_filled_map_refuses_every_read() {
  // A declared window with missing cells is a half-run seeding — reads abort rather than
  // serve a wrong biome; the ceremony's window + appends share one PTB precisely for this.
  let mut scenario = test_scenario::begin(OWNER);
  let mut w = world_with(vector[world::new_mob_row(b"wooling".to_string(), 8000, vector[0])], &mut scenario);
  world::set_biome_map_window(&mut w, 0, 0, 2);
  world::append_biome_map_cells(&mut w, vector[1, 2]);
  zone::families(&w, 0, 0);
  abort 0
}

