// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::characteristic_costs_tests;

use aresrpg_math::characteristic_costs;

#[test]
fun exact_retro_boundaries_and_exceptions() {
  let (spent, gain) = characteristic_costs::gain_for_points(
    &b"senshi".to_string(), &b"intelligence".to_string(), 19, 3,
  );
  assert!(spent == 3 && gain == 2);
  let (cost, gain) = characteristic_costs::cost_at(&b"shugo".to_string(), &b"strength".to_string(), 50);
  assert!(cost == 3 && gain == 1);
  let (cost, _) = characteristic_costs::cost_at(&b"rojin".to_string(), &b"intelligence".to_string(), 149);
  assert!(cost == 4);
  let (cost, _) = characteristic_costs::cost_at(&b"rojin".to_string(), &b"intelligence".to_string(), 150);
  assert!(cost == 5);
  let (cost, _) = characteristic_costs::cost_at(&b"mori".to_string(), &b"strength".to_string(), 249);
  assert!(cost == 2);
  let (cost, _) = characteristic_costs::cost_at(&b"mori".to_string(), &b"strength".to_string(), 250);
  assert!(cost == 3);
  let (cost, _) = characteristic_costs::cost_at(&b"shusen".to_string(), &b"strength".to_string(), 500);
  assert!(cost == 3);
  let (spent, gain) = characteristic_costs::gain_for_points(
    &b"ikari".to_string(), &b"vitality".to_string(), 0, 3,
  );
  assert!(spent == 3 && gain == 6);
}

#[test]
fun every_threshold_edge_matches_the_client_twin() {
  let classes = vector[
    b"shugo".to_string(), b"tomoda".to_string(), b"rojin".to_string(), b"yajin".to_string(),
    b"tokei".to_string(), b"asobi".to_string(), b"iyashi".to_string(), b"senshi".to_string(),
    b"yogan".to_string(), b"mori".to_string(), b"ikari".to_string(), b"shusen".to_string(),
  ];
  let stats = vector[
    b"vitality".to_string(), b"wisdom".to_string(), b"strength".to_string(),
    b"intelligence".to_string(), b"chance".to_string(), b"agility".to_string(),
  ];
  let values = vector[
    0u32, 19, 20, 39, 40, 49, 50, 59, 60, 79, 80, 99, 100, 149, 150,
    199, 200, 229, 230, 249, 250, 299, 300, 329, 330, 349, 350, 399, 400, 500,
  ];
  let mut fingerprint = 0u64;
  let mut class_index = 0u64;
  while (class_index < classes.length()) {
    let mut stat_index = 0u64;
    while (stat_index < stats.length()) {
      let mut value_index = 0u64;
      while (value_index < values.length()) {
        let value = values[value_index];
        let (cost, gain) = characteristic_costs::cost_at(
          &classes[class_index], &stats[stat_index], value,
        );
        fingerprint = fingerprint +
          (class_index + 1) * (stat_index + 1) * ((value as u64) + 1) * ((cost as u64) * 10 + (gain as u64));
        value_index = value_index + 1;
      };
      stat_index = stat_index + 1;
    };
    class_index = class_index + 1;
  };
  assert!(fingerprint == 366_013_424);
}
