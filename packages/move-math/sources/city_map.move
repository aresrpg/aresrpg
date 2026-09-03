// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Authored city identities and their one fixed footprint. Cities change population membership;
/// live ownership, taxation, structures, and zone state do not belong in this value module.
module aresrpg_math::city_map;

use std::string::String;
use sui::object::ID;

const EInvalidCityAnchor: u64 = 3201;
const EOverlappingCities: u64 = 3202;
const ETooManyCities: u64 = 3203;
const ZONE_SIZE: u32 = 512;
const WORLD_SIZE: u32 = 100_000;
const LAST_ZONE: u32 = (WORLD_SIZE - 1) / ZONE_SIZE;

public struct City has copy, drop, store {
  name: String,
  x: u32,
  z: u32,
  dungeon: ID,
}

public fun new_city(name: String, x: u32, z: u32, dungeon: ID): City {
  let center_x = x / ZONE_SIZE;
  let center_z = z / ZONE_SIZE;
  assert!(x < WORLD_SIZE && z < WORLD_SIZE, EInvalidCityAnchor);
  assert!(center_x > 0 && center_x < LAST_ZONE && center_z > 0 && center_z < LAST_ZONE, EInvalidCityAnchor);
  City { name, x, z, dungeon }
}

public fun assert_valid(cities: &vector<City>) {
  assert!(cities.length() <= 256, ETooManyCities);
  let mut left = 0;
  while (left < cities.length()) {
    let mut right = left + 1;
    while (right < cities.length()) {
      let left_x = cities[left].x / ZONE_SIZE;
      let left_z = cities[left].z / ZONE_SIZE;
      let right_x = cities[right].x / ZONE_SIZE;
      let right_z = cities[right].z / ZONE_SIZE;
      assert!(absolute_delta(left_x, right_x) > 2 || absolute_delta(left_z, right_z) > 2, EOverlappingCities);
      right = right + 1;
    };
    left = left + 1;
  };
}

public fun city_index_at(cities: &vector<City>, zone_x: u32, zone_z: u32): Option<u8> {
  let mut index = 0;
  while (index < cities.length()) {
    if (contains_zone(&cities[index], zone_x, zone_z)) return option::some(index as u8);
    index = index + 1;
  };
  option::none()
}

public fun city_for_dungeon(cities: &vector<City>, dungeon: ID): Option<City> {
  let mut index = 0;
  while (index < cities.length()) {
    if (cities[index].dungeon == dungeon) return option::some(cities[index]);
    index = index + 1;
  };
  option::none()
}

public fun city_by_name(cities: &vector<City>, name: &String): Option<City> {
  let mut index = 0;
  while (index < cities.length()) {
    if (&cities[index].name == name) return option::some(cities[index]);
    index = index + 1;
  };
  option::none()
}

public fun contains_zone(city: &City, zone_x: u32, zone_z: u32): bool {
  absolute_delta(zone_x, city.x / ZONE_SIZE) <= 1 && absolute_delta(zone_z, city.z / ZONE_SIZE) <= 1
}

public fun name(city: &City): String { city.name }

public fun x(city: &City): u32 { city.x }

public fun z(city: &City): u32 { city.z }

public fun dungeon(city: &City): ID { city.dungeon }

fun absolute_delta(left: u32, right: u32): u32 { if (left > right) left - right else right - left }
