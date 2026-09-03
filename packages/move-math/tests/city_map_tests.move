// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::city_map_tests;

use aresrpg_math::city_map;
use sui::object;

#[test]
fun a_city_contains_exactly_its_center_and_eight_neighbours() {
  let city = city_map::new_city(b"thebes".to_string(), 50_512, 50_000, object::id_from_address(@0xD));
  let center_x = 50_512 / 512;
  let center_z = 50_000 / 512;
  let mut x = center_x - 2;
  let mut count = 0u64;
  while (x <= center_x + 2) {
    let mut z = center_z - 2;
    while (z <= center_z + 2) {
      if (city_map::contains_zone(&city, x, z)) count = count + 1;
      z = z + 1;
    };
    x = x + 1;
  };
  assert!(count == 9, 0);
  assert!(!city_map::contains_zone(&city, center_x + 2, center_z), 1);
}

#[test]
fun city_lookup_uses_authored_identity_not_vector_position() {
  let cities = vector[
    city_map::new_city(b"thebes".to_string(), 50_512, 50_000, object::id_from_address(@0xD)),
  ];
  let found = city_map::city_for_dungeon(&cities, object::id_from_address(@0xD));
  assert!(found.is_some() && city_map::name(found.borrow()) == b"thebes".to_string(), 0);
}

#[test]
#[expected_failure(abort_code = 3202, location = aresrpg_math::city_map)]
fun overlapping_city_footprints_are_refused() {
  let cities = vector[
    city_map::new_city(b"one".to_string(), 52_736, 48_128, object::id_from_address(@0x1)),
    city_map::new_city(b"two".to_string(), 53_248, 48_128, object::id_from_address(@0x2)),
  ];
  city_map::assert_valid(&cities);
}

#[test]
#[expected_failure(abort_code = 3203, location = aresrpg_math::city_map)]
fun city_indexes_cannot_overflow_u8() {
  let mut cities = vector[];
  let mut index = 0u64;
  while (index < 257) {
    cities.push_back(city_map::new_city(
      b"city".to_string(),
      50_512,
      50_000,
      object::id_from_address(@0xD),
    ));
    index = index + 1;
  };
  city_map::assert_valid(&cities);
}
