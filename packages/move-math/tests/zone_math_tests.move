// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::zone_math_tests;

use aresrpg_math::{city_map, world_map, zone_math};
use sui::object;

fun wheat(): world_map::ResourceRow {
  world_map::new_resource_row(b"wheat".to_string(), b"FARMER".to_string(), 0,
    b"protector".to_string(), b"rare_wheat".to_string(), vector[0], vector[0])
}

#[test]
fun city_membership_replaces_biome_membership_for_both_populations() {
  let map = world_map::empty_biome_map();
  let city = city_map::new_city(b"thebes".to_string(), 50_000, 50_000, object::id_from_address(@0x1));
  let cities = vector[city];
  let rows = vector[
    world_map::new_mob_row(b"fuwa".to_string(), 5000, vector[0], vector[]),
    world_map::new_mob_row(b"nook".to_string(), 5000, vector[], vector[0]),
  ];
  assert!(zone_math::families(rows, &map, &cities, 97, 97) == vector[b"nook".to_string()], 0);
  assert!(zone_math::families(rows, &map, &cities, 90, 90) == vector[b"fuwa".to_string()], 1);
  let groups = zone_math::mob_groups(rows, &map, &cities, 97, 97, 1, 0);
  assert!(!groups.is_empty(), 2);
  groups.do_ref!(|group| {
    zone_math::group_members(group).do_ref!(|member| {
      assert!(zone_math::member_type(member) == b"nook".to_string(), 3);
      assert!(zone_math::member_level_scalar(member) <= 100, 4);
    });
  });
  let resources = vector[wheat(), world_map::new_resource_row(b"ore".to_string(), b"MINER".to_string(), 0,
    b"protector".to_string(), b"rare_ore".to_string(), vector[0], vector[])];
  assert!(zone_math::resource_families(resources, &map, &cities, 97, 97) == vector[b"wheat".to_string()], 5);
  assert!(zone_math::resource_families(resources, &map, &cities, 90, 90).length() == 2, 6);
  let member = zone_math::new_member(b"nook".to_string(), 75);
  assert!(zone_math::member_type(&member) == b"nook".to_string() && zone_math::member_level_scalar(&member) == 75, 7);
}

#[test]
fun city_resource_bonus_preserves_rolls_and_applies_before_consumption() {
  let map = world_map::empty_biome_map();
  let cities = vector[city_map::new_city(b"thebes".to_string(), 50_000, 50_000, object::id_from_address(@0x1))];
  let rows = vector[wheat()];
  let wild = zone_math::resource_packs(rows, &map, &vector[], 97, 97, 9, &vector[]);
  let city = zone_math::resource_packs(rows, &map, &cities, 97, 97, 9, &vector[]);
  assert!(wild.length() == city.length(), 0);
  let mut index = 0;
  while (index < wild.length()) {
    assert!(zone_math::pack_index(&wild[index]) == zone_math::pack_index(&city[index]), 1);
    assert!(zone_math::pack_x(&wild[index]) == zone_math::pack_x(&city[index]), 2);
    assert!(zone_math::pack_z(&wild[index]) == zone_math::pack_z(&city[index]), 3);
    assert!(zone_math::pack_item_type(&city[index]) == b"wheat".to_string(), 4);
    assert!(zone_math::pack_nodes(&city[index]) == zone_math::pack_nodes(&wild[index]) * 3 / 2, 5);
    index = index + 1;
  };
  let total = zone_math::total_resource_nodes(rows, &map, &cities, 97, 97, 9, 0);
  let remaining = zone_math::resource_pack_at(rows, &map, &cities, 97, 97, 9, &vector[1], 0);
  assert!(zone_math::pack_nodes(&remaining) + 1 == total, 6);
  assert!(zone_math::zone_size() == 512, 7);
  let (low, high) = zone_math::level_bounds(0, 0);
  assert!(low == 75 && high == 100, 8);
}

#[test]
fun zones_with_no_matching_content_are_empty() {
  let map = world_map::empty_biome_map();
  assert!(zone_math::mob_groups(vector[], &map, &vector[], 0, 0, 1, 0).is_empty(), 0);
  assert!(zone_math::resource_packs(vector[], &map, &vector[], 0, 0, 1, &vector[]).is_empty(), 1);
  let rows = vector[world_map::new_archi_row(b"fuwa".to_string(), b"fukuo".to_string())];
  assert!(zone_math::replacement_for_roll_for_testing(&rows, b"nook".to_string(), 0) == b"nook".to_string(), 2);
}

#[test, expected_failure(abort_code = 1302, location = aresrpg_math::zone_math)]
fun missing_resource_pack_cannot_be_gathered() {
  zone_math::resource_pack_at(vector[wheat()], &world_map::empty_biome_map(), &vector[], 97, 97, 1, &vector[], 99);
}

#[test, expected_failure(abort_code = 1302, location = aresrpg_math::zone_math)]
fun exhausted_resource_pack_cannot_be_gathered() {
  zone_math::resource_pack_at(vector[wheat()], &world_map::empty_biome_map(), &vector[], 97, 97, 1, &vector[255], 0);
}

#[test, expected_failure(abort_code = 1302, location = aresrpg_math::zone_math)]
fun missing_resource_pack_cannot_report_a_total() {
  zone_math::total_resource_nodes(vector[wheat()], &world_map::empty_biome_map(), &vector[], 97, 97, 1, 99);
}

fun border_population_stays_inside_world(zone_x: u32, zone_z: u32) {
  let rows = vector[world_map::new_mob_row(b"fuwa".to_string(), 10_000, vector[0], vector[])];
  let resources = vector[world_map::new_resource_row(
    b"wheat".to_string(), b"FARMER".to_string(), 0,
    b"protector".to_string(), b"rare_wheat".to_string(), vector[0], vector[],
  )];
  let map = world_map::empty_biome_map();
  let groups = zone_math::mob_groups(rows, &map, &vector[], zone_x, zone_z, 1, 0);
  let mut index = 0;
  while (index < groups.length()) {
    assert!(zone_math::group_x(&groups[index]) < world_map::world_size(), 10);
    assert!(zone_math::group_z(&groups[index]) < world_map::world_size(), 11);
    index = index + 1;
  };
  let packs = zone_math::resource_packs(resources, &map, &vector[], zone_x, zone_z, 1, &vector[]);
  index = 0;
  while (index < packs.length()) {
    assert!(zone_math::pack_x(&packs[index]) < world_map::world_size(), 12);
    assert!(zone_math::pack_z(&packs[index]) < world_map::world_size(), 13);
    index = index + 1;
  };
}

#[test]
fun east_border_population_remains_reachable() { border_population_stays_inside_world(195, 0); }

#[test]
fun north_border_population_remains_reachable() { border_population_stays_inside_world(0, 195); }

#[test]
fun corner_population_remains_reachable() { border_population_stays_inside_world(195, 195); }

#[test]
fun border_correction_preserves_seed_indices_and_consumption() {
  let rows = vector[world_map::new_mob_row(b"fuwa".to_string(), 10_000, vector[0], vector[])];
  let resources = vector[world_map::new_resource_row(
    b"wheat".to_string(), b"FARMER".to_string(), 0,
    b"protector".to_string(), b"rare_wheat".to_string(), vector[0], vector[],
  )];
  let map = world_map::empty_biome_map();
  let all = zone_math::mob_groups(rows, &map, &vector[], 195, 0, 1, 0);
  assert!(all.length() == 54, 20);
  // The original x draw is 2_017_442_487: reduce that draw by 160, not its old modulo-512 coordinate.
  assert!(zone_math::group_x(&all[0]) == 99_927 && zone_math::group_z(&all[0]) == 378, 21);
  let remaining = zone_math::mob_groups(rows, &map, &vector[], 195, 0, 1, 1);
  assert!(remaining.length() + 1 == all.length(), 22);
  let mut index = 0;
  while (index < remaining.length()) {
    assert!(remaining[index] == all[index + 1], 23);
    index = index + 1;
  };
  let packs = zone_math::resource_packs(resources, &map, &vector[], 195, 0, 1, &vector[]);
  assert!(packs.length() == 35, 24);
  assert!(zone_math::pack_x(&packs[0]) == 99_947 && zone_math::pack_z(&packs[0]) == 139, 25);
  let partial = zone_math::resource_packs(resources, &map, &vector[], 195, 0, 1, &vector[3, 255]);
  assert!(partial.length() + 1 == packs.length(), 26);
  assert!(zone_math::pack_index(&partial[0]) == 0, 27);
  assert!(zone_math::pack_nodes(&partial[0]) + 3 == zone_math::pack_nodes(&packs[0]), 28);
  assert!(partial[1] == packs[2], 29);
  assert!(zone_math::resource_pack_at(resources, &map, &vector[], 195, 0, 1, &vector[3, 255], 0) == partial[0], 30);
}

#[test, expected_failure(abort_code = 1303, location = aresrpg_math::zone_math)]
fun out_of_world_mob_zone_is_rejected_before_generation() {
  let map = world_map::empty_biome_map();
  let _ = zone_math::mob_groups(vector[], &map, &vector[], 196, 0, 1, 0);
}

#[test, expected_failure(abort_code = 1303, location = aresrpg_math::zone_math)]
fun oversized_resource_zone_cannot_overflow_its_origin() {
  let map = world_map::empty_biome_map();
  let _ = zone_math::resource_packs(vector[], &map, &vector[], 0, 4_294_967_295, 1, &vector[]);
}

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
