// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::zone_math_tests;

use aresrpg_math::{world_map, zone_math};

#[test]
fun a_city_only_mob_row_needs_no_wilderness_biome() {
  let row = world_map::new_mob_row(b"nook".to_string(), 1_000, vector[], vector[0]);
  assert!(world_map::mob_row_biomes(&row).is_empty(), 0);
  assert!(world_map::mob_row_cities(&row) == vector[0], 1);
}

#[test]
#[expected_failure(abort_code = 306, location = aresrpg_math::world_map)]
fun a_mob_row_with_no_spawn_membership_is_invalid() {
  let _ = world_map::new_mob_row(b"nowhere".to_string(), 1_000, vector[], vector[]);
}

#[test]
fun group_size_reaches_the_authored_average_three_at_two_thousand_blocks() {
  assert!(zone_math::group_size_bounds_for_testing(2_000) == vector[2, 4], 0);
}

#[test]
fun the_first_outer_zone_can_already_draw_multi_mob_groups() {
  assert!(zone_math::group_size_bounds_for_testing(848) == vector[1, 2], 0);
}

#[test]
fun mob_level_bounds_move_from_minimum_to_the_upper_quarter() {
  assert!(zone_math::level_bounds_for_testing(0) == vector[0, 0], 0);
  assert!(zone_math::level_bounds_for_testing(10_000) == vector[37, 50], 1);
  assert!(zone_math::level_bounds_for_testing(20_000) == vector[75, 100], 2);
  assert!(zone_math::level_bounds_for_testing(50_000) == vector[75, 100], 3);
}

#[test]
fun city_resource_packs_hold_fifty_percent_more_nodes_without_more_pack_rolls() {
  assert!(zone_math::city_resource_nodes_for_testing(2) == 3, 0);
  assert!(zone_math::city_resource_nodes_for_testing(16) == 24, 1);
  assert!(zone_math::city_resource_nodes_for_testing(22) == 33, 2);
}

#[test]
fun archimob_rate_is_exactly_one_percent() {
  assert!(zone_math::archimob_bp_for_testing() == 100, 0);
  let rows = vector[world_map::new_archi_row(b"fuwa".to_string(), b"fukuo".to_string())];
  assert!(zone_math::replacement_for_roll_for_testing(&rows, b"fuwa".to_string(), 99) == b"fukuo".to_string(), 1);
  assert!(zone_math::replacement_for_roll_for_testing(&rows, b"fuwa".to_string(), 100) == b"fuwa".to_string(), 2);
  assert!(zone_math::replacement_for_roll_for_testing(&rows, b"ant".to_string(), 0) == b"ant".to_string(), 3);
}

#[test]
fun archimob_population_fixture_matches_the_server_twin() {
  let rows = vector[world_map::new_mob_row(b"fuwa".to_string(), 10_000, vector[0], vector[])];
  let archis = vector[world_map::new_archi_row(b"fuwa".to_string(), b"fukuo".to_string())];
  let map = world_map::empty_biome_map();
  let cities = vector[];
  let groups = zone_math::mob_groups_with_archis(rows, &archis, &map, &cities, 97, 97, 0, 0);
  assert!(groups.length() == 56, 0);
  let group = &groups[42];
  assert!(zone_math::group_index(group) == 42, 1);
  assert!(zone_math::group_x(group) == 49_816 && zone_math::group_z(group) == 50_068, 2);
  let members = zone_math::group_members(group);
  assert!(members.length() == 1, 3);
  assert!(zone_math::member_type(&members[0]) == b"fukuo".to_string(), 4);
  assert!(zone_math::member_level_scalar(&members[0]) == 0, 5);
}
