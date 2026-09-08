// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::loot_table_tests;

use aresrpg_math::loot_table;

#[test]
fun weighted_windows_exclude_zero_weight_and_preserve_reward_quantity() {
  let absent = object::id_from_address(@0xA);
  let first = object::id_from_address(@0xB);
  let second = object::id_from_address(@0xC);
  let third = object::id_from_address(@0xD);
  let rows = vector[
    loot_table::new_entry(absent, 0, 99), loot_table::new_entry(first, 2, 3),
    loot_table::new_entry(second, 1, 7), loot_table::new_entry(third, 3, 11),
  ];
  assert!(loot_table::total_weight(&vector[]) == 0, 1);
  assert!(loot_table::total_weight(&rows) == 6, 2);
  let expected = vector[first, first, second, third, third, third];
  let amounts = vector[3u32, 3, 7, 11, 11, 11];
  let mut draw = 0;
  while (draw < 6) {
    let selected = loot_table::pick(&rows, draw);
    assert!(loot_table::template(&selected) == expected[draw], 3);
    assert!(loot_table::amount(&selected) == amounts[draw], 4);
    draw = draw + 1;
  };
}
